import { randomUUID } from "node:crypto";
import {
	mkdir,
	readdir,
	readFile,
	rename,
	rmdir,
	stat,
	unlink,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import LZString from "lz-string";
import {
	type CaptureInput,
	type CreateFolderInput,
	type CreateItemInput,
	createFolderInputSchema,
	createItemInputSchema,
	type DeleteFolderInput,
	deleteFolderInputSchema,
	type FileItemInput,
	fileItemInputSchema,
	type OrbitCanvas,
	type OrbitFolder,
	type OrbitFolderColor,
	type OrbitItem,
	type OrbitSnapshot,
	type OrbitSpace,
	orbitItemSchema,
	type UpdateFolderInput,
	type UpdateNoteInput,
	updateFolderInputSchema,
	updateNoteInputSchema,
} from "./schema";
import {
	splitVaultObjectKey,
	toVaultObjectKey,
	toVaultSlug,
} from "./vault-key";

const VAULT_FOLDERS = [
	"inbox",
	"projects",
	"areas",
	"resources",
	"events",
	"archive",
	"whiteboards",
] as const;

const PARA_VAULT: Record<"project" | "area" | "resource", string> = {
	project: "projects",
	area: "areas",
	resource: "resources",
};

const DEFAULT_FOLDER_COLOR: OrbitFolderColor = "amber";

type FolderMetadata = {
	version: 1;
	folders: Partial<
		Record<
			"project" | "area" | "resource" | "archive",
			Record<string, { color: OrbitFolderColor }>
		>
	>;
};

function getVaultRoot() {
	return path.resolve(
		process.env.ORBIT_VAULT_DIR ?? process.env.ORBIT_DATA_DIR ?? "vault",
	);
}

function normalizeDate(value: unknown, fallback: string) {
	if (value instanceof Date) return value.toISOString();
	if (typeof value === "string" && value.length > 0) return value;
	return fallback;
}

function normalizeScheduleDate(value: unknown, fallback: string) {
	if (value instanceof Date) {
		const year = value.getFullYear();
		const month = String(value.getMonth() + 1).padStart(2, "0");
		const day = String(value.getDate()).padStart(2, "0");
		const hour = String(value.getHours()).padStart(2, "0");
		const minute = String(value.getMinutes()).padStart(2, "0");
		const second = String(value.getSeconds()).padStart(2, "0");
		return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
	}
	if (typeof value === "string" && value.length > 0) return value;
	return fallback;
}

function normalizeTags(value: unknown) {
	if (Array.isArray(value)) return value.map(String).filter(Boolean);
	if (typeof value === "string") {
		return value
			.split(",")
			.map((tag) => tag.trim())
			.filter(Boolean);
	}
	return [];
}

function spaceFromPath(relativePath: string): OrbitItem["space"] {
	const root = splitVaultObjectKey(relativePath)[0];
	if (root === "projects") return "project";
	if (root === "areas") return "area";
	if (root === "resources") return "resource";
	if (root === "events") return "event";
	if (root === "archive") return "archive";
	return "inbox";
}

function folderFromPath(relativePath: string) {
	const parts = splitVaultObjectKey(relativePath);
	if (
		(parts[0] === "projects" ||
			parts[0] === "areas" ||
			parts[0] === "resources" ||
			parts[0] === "archive") &&
		parts.length >= 3
	) {
		return parts.slice(1, -1).join("/");
	}
	return undefined;
}

function normalizeFolderPath(value: string) {
	return value
		.split(/[\\/]+/)
		.map((segment) => toVaultSlug(segment))
		.filter(Boolean)
		.join("/");
}

function folderRoot(space: "project" | "area" | "resource" | "archive") {
	return space === "archive" ? "archive" : PARA_VAULT[space];
}

function assertInsideVault(vaultRoot: string, targetPath: string) {
	const root = path.resolve(vaultRoot);
	const resolved = path.resolve(targetPath);
	if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
		throw new Error("Path escapes the Orbit vault");
	}
}

function destinationDir(space: OrbitSpace, folder?: string) {
	if (space === "project" || space === "area" || space === "resource") {
		const root = PARA_VAULT[space];
		return folder ? path.join(root, folder) : root;
	}
	if (space === "event") return "events";
	if (space === "archive")
		return folder ? path.join("archive", folder) : "archive";
	return "inbox";
}

async function ensureVault() {
	const root = getVaultRoot();
	await Promise.all(
		VAULT_FOLDERS.map((folder) =>
			mkdir(path.join(root, folder), { recursive: true }),
		),
	);
	return root;
}

async function findMarkdownFiles(directory: string): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true });
	const nested = await Promise.all(
		entries.map(async (entry) => {
			if (entry.name.startsWith(".")) return [];
			const entryPath = path.join(directory, entry.name);
			if (entry.isDirectory()) return findMarkdownFiles(entryPath);
			if (
				entry.isFile() &&
				entry.name.endsWith(".md") &&
				!entry.name.endsWith(".excalidraw.md")
			)
				return [entryPath];
			return [];
		}),
	);
	return nested.flat();
}

async function findCanvasFiles(directory: string): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true });
	const nested = await Promise.all(
		entries.map(async (entry) => {
			if (entry.name.startsWith(".")) return [];
			const entryPath = path.join(directory, entry.name);
			if (entry.isDirectory()) return findCanvasFiles(entryPath);
			if (
				entry.isFile() &&
				(entry.name.endsWith(".excalidraw") ||
					entry.name.endsWith(".excalidraw.md"))
			)
				return [entryPath];
			return [];
		}),
	);
	return nested.flat();
}

const COMPRESSED_CANVAS_BLOCK =
	/(```compressed-json[^\S\r\n]*\r?\n)([\s\S]*?)(\r?\n```)/i;
const JSON_CANVAS_BLOCK = /(```json[^\S\r\n]*\r?\n)([\s\S]*?)(\r?\n```)/i;

function canvasDocumentSource(raw: string, format: OrbitCanvas["format"]) {
	if (format !== "excalidraw.md") return raw;
	const compressed = raw.match(COMPRESSED_CANVAS_BLOCK)?.[2];
	if (compressed !== undefined) {
		const document = LZString.decompressFromBase64(
			compressed.replace(/[\r\n]/g, ""),
		);
		if (!document) throw new Error("Invalid compressed Excalidraw document");
		return document.slice(0, document.lastIndexOf("}") + 1);
	}
	return raw.match(JSON_CANVAS_BLOCK)?.[2] ?? raw;
}

function canvasJson(raw: string, format: OrbitCanvas["format"]) {
	const source = canvasDocumentSource(raw, format);
	const value = JSON.parse(source) as {
		elements?: unknown[];
		files?: Record<string, unknown>;
		orbitTitle?: unknown;
	};
	if (!Array.isArray(value.elements))
		throw new Error("Invalid Excalidraw document");
	return { ...value, elements: value.elements, files: value.files ?? {} };
}

function canvasFormat(filePath: string): OrbitCanvas["format"] {
	return filePath.endsWith(".excalidraw.md") ? "excalidraw.md" : "excalidraw";
}

const EMPTY_CANVAS = {
	type: "excalidraw",
	version: 2,
	source: "https://excalidraw.com",
	elements: [],
	appState: { viewBackgroundColor: "#ffffff" },
	files: {},
};

async function readOrbitCanvas(filePath: string, vaultRoot: string) {
	const [raw, fileStats] = await Promise.all([
		readFile(filePath, "utf8"),
		stat(filePath),
	]);
	const format = canvasFormat(filePath);
	const document = canvasJson(raw, format);
	const relativePath = toVaultObjectKey(vaultRoot, filePath);
	const basename = path.basename(filePath);
	const fallbackTitle = basename
		.replace(/\.excalidraw(?:\.md)?$/i, "")
		.replace(/-[0-9a-f]{8}$/i, "");
	const title =
		typeof document.orbitTitle === "string" && document.orbitTitle.trim()
			? document.orbitTitle.trim()
			: fallbackTitle;
	return {
		id: relativePath,
		title,
		path: relativePath,
		created: fileStats.birthtime.toISOString(),
		updated: fileStats.mtime.toISOString(),
		elementCount: document.elements.length,
		fileCount: Object.keys(document.files ?? {}).length,
		format,
	};
}

async function listOrbitCanvases(vaultRoot: string) {
	const files = await findCanvasFiles(vaultRoot);
	const canvases = await Promise.all(
		files.map(async (file) => {
			try {
				return await readOrbitCanvas(file, vaultRoot);
			} catch {
				console.warn(
					`[orbit] Skipping invalid canvas: ${toVaultObjectKey(vaultRoot, file)}`,
				);
				return null;
			}
		}),
	);
	return canvases
		.filter((canvas): canvas is NonNullable<typeof canvas> => canvas !== null)
		.sort((left, right) => right.updated.localeCompare(left.updated));
}

async function listNestedFolders(
	directory: string,
	prefix = "",
): Promise<string[]> {
	try {
		const entries = await readdir(directory, { withFileTypes: true });
		const folders = entries
			.filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
			.map((entry) => entry.name)
			.sort((left, right) => left.localeCompare(right, "ko"));
		const nested = await Promise.all(
			folders.map(async (name) => {
				const slug = prefix ? `${prefix}/${name}` : name;
				return [
					slug,
					...(await listNestedFolders(path.join(directory, name), slug)),
				];
			}),
		);
		return nested.flat();
	} catch {
		return [];
	}
}

function emptyFolderMetadata(): FolderMetadata {
	return { version: 1, folders: {} };
}

async function readFolderMetadata(vaultRoot: string): Promise<FolderMetadata> {
	try {
		const raw = await readFile(
			path.join(vaultRoot, ".orbit", "folders.json"),
			"utf8",
		);
		const parsed = JSON.parse(raw) as FolderMetadata;
		return parsed.version === 1 && parsed.folders
			? parsed
			: emptyFolderMetadata();
	} catch {
		return emptyFolderMetadata();
	}
}

async function writeFolderMetadata(
	vaultRoot: string,
	metadata: FolderMetadata,
) {
	const directory = path.join(vaultRoot, ".orbit");
	await mkdir(directory, { recursive: true });
	await atomicWrite(
		path.join(directory, "folders.json"),
		`${JSON.stringify(metadata, null, 2)}\n`,
	);
}

async function readOrbitItem(filePath: string, vaultRoot: string) {
	const [raw, fileStats] = await Promise.all([
		readFile(filePath, "utf8"),
		stat(filePath),
	]);
	const parsed = matter(raw);
	const relativePath = toVaultObjectKey(vaultRoot, filePath);
	const fallbackDate = fileStats.birthtime.toISOString();
	const data = parsed.data;
	const space = spaceFromPath(relativePath);

	const result = orbitItemSchema.safeParse({
		id: data.id ?? relativePath,
		title: data.title ?? path.basename(filePath, ".md"),
		type: data.type ?? "note",
		space: data.space ?? space,
		status: data.status,
		project: data.project,
		folder: folderFromPath(relativePath),
		due: data.due ? normalizeScheduleDate(data.due, fallbackDate) : undefined,
		start: data.start
			? normalizeScheduleDate(data.start, fallbackDate)
			: undefined,
		end: data.end ? normalizeScheduleDate(data.end, fallbackDate) : undefined,
		url: data.url,
		tags: normalizeTags(data.tags),
		created: normalizeDate(data.created, fallbackDate),
		updated: normalizeDate(data.updated, fileStats.mtime.toISOString()),
		body: parsed.content.trim(),
		path: relativePath,
	});

	if (!result.success) {
		console.warn(`[orbit] Skipping invalid item: ${relativePath}`);
		return null;
	}
	return result.data;
}

export async function listOrbitItems() {
	const vaultRoot = await ensureVault();
	const files = await findMarkdownFiles(vaultRoot);
	const items = await Promise.all(
		files.map((file) => readOrbitItem(file, vaultRoot)),
	);
	return items
		.filter((item): item is OrbitItem => item !== null)
		.sort((left, right) => right.updated.localeCompare(left.updated));
}

async function findItemFile(id: string, vaultRoot: string) {
	const files = await findMarkdownFiles(vaultRoot);
	for (const filePath of files) {
		const raw = await readFile(filePath, "utf8");
		const parsed = matter(raw);
		if (
			String(parsed.data.id ?? toVaultObjectKey(vaultRoot, filePath)) === id
		) {
			return { filePath, raw, parsed };
		}
	}
	return null;
}

function localDateKey(date = new Date()) {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function itemDateKey(value?: string) {
	return value?.slice(0, 10);
}

async function collectFolders(
	vaultRoot: string,
	items: OrbitItem[],
): Promise<OrbitSnapshot["folders"]> {
	const spaces = ["project", "area", "resource", "archive"] as const;
	const folders = {} as OrbitSnapshot["folders"];
	const metadata = await readFolderMetadata(vaultRoot);
	for (const space of spaces) {
		const root = folderRoot(space);
		const dirNames = await listNestedFolders(path.join(vaultRoot, root));
		const counted = new Map<string, number>();
		const descendantCounted = new Map<string, number>();
		for (const name of dirNames) counted.set(name, 0);
		for (const item of items) {
			if (item.space !== space || !item.folder) continue;
			counted.set(item.folder, (counted.get(item.folder) ?? 0) + 1);
			const parts = splitVaultObjectKey(item.folder);
			for (let depth = 1; depth <= parts.length; depth += 1) {
				const ancestor = parts.slice(0, depth).join("/");
				descendantCounted.set(
					ancestor,
					(descendantCounted.get(ancestor) ?? 0) + 1,
				);
			}
		}
		const list: OrbitFolder[] = [...counted.entries()]
			.map(([slug, count]) => {
				const parts = splitVaultObjectKey(slug);
				const parent =
					parts.length > 1 ? parts.slice(0, -1).join("/") : undefined;
				return {
					space,
					slug,
					name: parts.at(-1) ?? slug,
					parent,
					depth: parts.length - 1,
					color: metadata.folders[space]?.[slug]?.color ?? DEFAULT_FOLDER_COLOR,
					count,
					descendantCount: descendantCounted.get(slug) ?? 0,
				};
			})
			.sort((left, right) => left.slug.localeCompare(right.slug, "ko"));
		folders[space] = list;
	}
	return folders;
}

export async function getOrbitSnapshot(): Promise<OrbitSnapshot> {
	const vaultRoot = await ensureVault();
	const items = await listOrbitItems();
	const now = new Date();
	const today = localDateKey(now);
	const tasks = items
		.filter(
			(item) =>
				item.type === "task" &&
				item.status !== "done" &&
				item.status !== "cancelled" &&
				(!item.due || item.due.slice(0, 10) <= today),
		)
		.sort((left, right) =>
			(left.due ?? "9999").localeCompare(right.due ?? "9999"),
		);
	const events = items
		.filter(
			(item) => item.type === "event" && itemDateKey(item.start) === today,
		)
		.sort((left, right) => (left.start ?? "").localeCompare(right.start ?? ""));

	return {
		items,
		canvases: await listOrbitCanvases(vaultRoot),
		today: { tasks, events },
		folders: await collectFolders(vaultRoot, items),
		counts: {
			inbox: items.filter((item) => item.space === "inbox").length,
			project: items.filter((item) => item.space === "project").length,
			area: items.filter((item) => item.space === "area").length,
			resource: items.filter((item) => item.space === "resource").length,
			archive: items.filter((item) => item.space === "archive").length,
			event: items.filter((item) => item.space === "event").length,
		},
		vaultPath: vaultRoot,
		generatedAt: now.toISOString(),
		displayDate: {
			day: new Intl.DateTimeFormat("en-US", { day: "2-digit" }).format(now),
			month: new Intl.DateTimeFormat("en-US", { month: "short" })
				.format(now)
				.toUpperCase(),
			weekday: new Intl.DateTimeFormat("ko-KR", { weekday: "long" }).format(
				now,
			),
			longLabel: new Intl.DateTimeFormat("en-US", {
				weekday: "long",
				month: "long",
				day: "2-digit",
			})
				.format(now)
				.toUpperCase(),
		},
	};
}

function canvasPath(vaultRoot: string, objectKey: string) {
	const parts = splitVaultObjectKey(objectKey);
	if (
		parts.length === 0 ||
		(!objectKey.endsWith(".excalidraw") &&
			!objectKey.endsWith(".excalidraw.md"))
	) {
		throw new Error("Invalid Excalidraw path");
	}
	const filePath = path.join(vaultRoot, ...parts);
	assertInsideVault(vaultRoot, filePath);
	return filePath;
}

export async function getOrbitCanvas(objectKey: string) {
	const vaultRoot = await ensureVault();
	const filePath = canvasPath(vaultRoot, objectKey);
	const raw = await readFile(filePath, "utf8");
	const format = canvasFormat(filePath);
	return { path: objectKey, document: JSON.stringify(canvasJson(raw, format)) };
}

function replaceCanvasDocument(
	raw: string,
	format: OrbitCanvas["format"],
	document: string,
) {
	if (format !== "excalidraw.md") return `${document.trim()}\n`;
	if (COMPRESSED_CANVAS_BLOCK.test(raw)) {
		const compressed = LZString.compressToBase64(document.trim())
			.match(/.{1,256}/g)
			?.join("\n\n");
		if (!compressed) throw new Error("Could not compress Excalidraw document");
		return raw.replace(
			COMPRESSED_CANVAS_BLOCK,
			(_match, opening: string, _current: string, closing: string) =>
				`${opening}${compressed}${closing}`,
		);
	}
	if (JSON_CANVAS_BLOCK.test(raw)) {
		return raw.replace(
			JSON_CANVAS_BLOCK,
			(_match, opening: string, _current: string, closing: string) =>
				`${opening}${document.trim()}${closing}`,
		);
	}
	return `${document.trim()}\n`;
}

export async function saveOrbitCanvas(objectKey: string, document: string) {
	const vaultRoot = await ensureVault();
	const filePath = canvasPath(vaultRoot, objectKey);
	const format = canvasFormat(filePath);
	const nextDocument = canvasJson(document, "excalidraw");
	const current = await readFile(filePath, "utf8");
	const currentDocument = canvasJson(current, format);
	const withMetadata = JSON.stringify({
		...nextDocument,
		...(typeof currentDocument.orbitTitle === "string"
			? { orbitTitle: currentDocument.orbitTitle }
			: {}),
	});
	await atomicWrite(
		filePath,
		replaceCanvasDocument(current, format, withMetadata),
	);
	return readOrbitCanvas(filePath, vaultRoot);
}

export async function createOrbitCanvas(title: string) {
	const vaultRoot = await ensureVault();
	const directory = path.join(vaultRoot, "whiteboards");
	const id = randomUUID();
	const filePath = await uniqueFilePath(
		directory,
		`${toVaultSlug(title)}-${id.slice(0, 8)}.excalidraw`,
	);
	const document = { ...EMPTY_CANVAS, orbitTitle: title.trim() };
	await atomicWrite(filePath, `${JSON.stringify(document, null, 2)}\n`);
	const canvas = await readOrbitCanvas(filePath, vaultRoot);
	return { canvas, document };
}

function replaceCanvasLinks(raw: string, canvasPath: string, title: string) {
	return raw.replace(
		/\[(?:Whiteboard|화이트보드)\s*·\s*[^\]\n]*\]\(#\/canvas\/([^)]+)\)/gi,
		(original, encodedPath: string) => {
			let linkedPath = encodedPath;
			try {
				linkedPath = decodeURIComponent(encodedPath);
			} catch {
				// Keep the original encoded value for comparison.
			}
			if (linkedPath !== canvasPath) return original;
			const label = title.replace(/[[\]]/g, "");
			return `[Whiteboard · ${label}](#/canvas/${encodeURIComponent(canvasPath)})`;
		},
	);
}

export async function renameOrbitCanvas(objectKey: string, title: string) {
	const vaultRoot = await ensureVault();
	const sourcePath = canvasPath(vaultRoot, objectKey);
	const format = canvasFormat(sourcePath);
	const raw = await readFile(sourcePath, "utf8");
	const document = canvasJson(raw, format);
	const nextTitle = title.trim();
	const renamedDocument = JSON.stringify({
		...document,
		orbitTitle: nextTitle,
	});
	await atomicWrite(
		sourcePath,
		replaceCanvasDocument(raw, format, renamedDocument),
	);

	const noteFiles = await findMarkdownFiles(vaultRoot);
	let updatedNotes = 0;
	await Promise.all(
		noteFiles.map(async (filePath) => {
			const note = await readFile(filePath, "utf8");
			const updated = replaceCanvasLinks(note, objectKey, nextTitle);
			if (updated === note) return;
			await atomicWrite(filePath, updated);
			updatedNotes += 1;
		}),
	);

	return {
		canvas: await readOrbitCanvas(sourcePath, vaultRoot),
		previousPath: objectKey,
		updatedNotes,
	};
}

async function atomicWrite(filePath: string, contents: string) {
	const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
	await writeFile(temporaryPath, contents, { encoding: "utf8", flag: "wx" });
	await rename(temporaryPath, filePath);
}

async function uniqueFilePath(directory: string, filename: string) {
	const initial = path.join(directory, filename);
	try {
		await stat(initial);
	} catch {
		return initial;
	}
	const ext = path.extname(filename);
	const stem = path.basename(filename, ext);
	return path.join(directory, `${stem}-${randomUUID().slice(0, 6)}${ext}`);
}

function newFilename(title: string, id: string) {
	return `${localDateKey()}-${toVaultSlug(title)}-${id.slice(0, 8)}.md`;
}

function itemFrontmatter(
	input: {
		id: string;
		title: string;
		type: OrbitItem["type"];
		space: OrbitSpace;
		status?: OrbitItem["status"];
		project?: string;
		due?: string;
		start?: string;
		end?: string;
		url?: string;
		tags: string[];
		created: string;
		updated: string;
	},
	extra: Record<string, unknown> = {},
) {
	const data: Record<string, unknown> = {
		...extra,
		id: input.id,
		title: input.title,
		type: input.type,
		space: input.space,
		tags: input.tags,
		created: input.created,
		updated: input.updated,
	};
	delete data.folder;
	delete data.path;
	delete data.body;
	if (input.status) data.status = input.status;
	else delete data.status;
	if (input.project) data.project = input.project;
	else delete data.project;
	if (input.due) data.due = input.due;
	else delete data.due;
	if (input.start) data.start = input.start;
	else delete data.start;
	if (input.end) data.end = input.end;
	else delete data.end;
	if (input.url) data.url = input.url;
	else delete data.url;
	return data;
}

export async function captureOrbitItem(input: CaptureInput) {
	return createOrbitItem({ ...input, space: "inbox" });
}

export async function createOrbitItem(input: CreateItemInput) {
	const parsed = createItemInputSchema.parse(input);
	const vaultRoot = await ensureVault();
	const now = new Date().toISOString();
	const id = randomUUID();
	const folder = parsed.folder
		? normalizeFolderPath(parsed.folder) || undefined
		: undefined;
	const relativeDir = destinationDir(parsed.space, folder);
	const directory = path.join(vaultRoot, relativeDir);
	assertInsideVault(vaultRoot, directory);
	await mkdir(directory, { recursive: true });
	const filePath = await uniqueFilePath(
		directory,
		newFilename(parsed.title, id),
	);
	assertInsideVault(vaultRoot, filePath);
	const status = parsed.type === "task" ? "open" : undefined;
	const project =
		parsed.space === "project" ? (folder ?? parsed.title) : undefined;
	const contents = matter.stringify(parsed.body ? `${parsed.body}\n` : "", {
		...itemFrontmatter({
			id,
			title: parsed.title,
			type: parsed.type,
			space: parsed.space,
			status,
			project,
			due: parsed.due,
			start: parsed.start,
			end: parsed.end,
			url: parsed.url,
			tags: [],
			created: now,
			updated: now,
		}),
	});
	await atomicWrite(filePath, contents);
	return readOrbitItem(filePath, vaultRoot);
}

export async function createOrbitFolder(input: CreateFolderInput) {
	const parsed = createFolderInputSchema.parse(input);
	const vaultRoot = await ensureVault();
	const name = toVaultSlug(parsed.name);
	const parent = parsed.parent
		? normalizeFolderPath(parsed.parent) || undefined
		: undefined;
	const slug = parent ? `${parent}/${name}` : name;
	const directory = path.join(
		vaultRoot,
		folderRoot(parsed.space),
		...splitVaultObjectKey(slug),
	);
	assertInsideVault(vaultRoot, directory);
	await mkdir(directory, { recursive: true });
	if (parsed.color) {
		const metadata = await readFolderMetadata(vaultRoot);
		const spaceMetadata = metadata.folders[parsed.space] ?? {};
		spaceMetadata[slug] = { color: parsed.color };
		metadata.folders[parsed.space] = spaceMetadata;
		await writeFolderMetadata(vaultRoot, metadata);
	}
	return {
		space: parsed.space,
		slug,
		name,
		parent,
		depth: splitVaultObjectKey(slug).length - 1,
		color: parsed.color ?? DEFAULT_FOLDER_COLOR,
		count: 0,
		descendantCount: 0,
	};
}

export async function updateOrbitFolder(input: UpdateFolderInput) {
	const parsed = updateFolderInputSchema.parse(input);
	const vaultRoot = await ensureVault();
	const currentPath = normalizeFolderPath(parsed.path);
	const currentParts = splitVaultObjectKey(currentPath);
	if (currentParts.length === 0) throw new Error("Folder path is required");

	let nextPath = currentPath;
	if (parsed.name) {
		const nextName = toVaultSlug(parsed.name);
		nextPath = [...currentParts.slice(0, -1), nextName].join("/");
		if (nextPath !== currentPath) {
			const root = path.join(vaultRoot, folderRoot(parsed.space));
			const source = path.join(root, ...currentParts);
			const destination = path.join(root, ...splitVaultObjectKey(nextPath));
			assertInsideVault(vaultRoot, source);
			assertInsideVault(vaultRoot, destination);
			await rename(source, destination);
		}
	}

	const metadata = await readFolderMetadata(vaultRoot);
	const currentMetadata = metadata.folders[parsed.space] ?? {};
	const nextMetadata: Record<string, { color: OrbitFolderColor }> = {};
	for (const [folderPath, value] of Object.entries(currentMetadata)) {
		if (
			folderPath === currentPath ||
			folderPath.startsWith(`${currentPath}/`)
		) {
			const suffix = folderPath.slice(currentPath.length);
			nextMetadata[`${nextPath}${suffix}`] = value;
		} else {
			nextMetadata[folderPath] = value;
		}
	}
	if (parsed.color) {
		nextMetadata[nextPath] = { color: parsed.color };
	}
	metadata.folders[parsed.space] = nextMetadata;
	await writeFolderMetadata(vaultRoot, metadata);

	const parts = splitVaultObjectKey(nextPath);
	return {
		space: parsed.space,
		slug: nextPath,
		name: parts.at(-1) ?? nextPath,
		parent: parts.length > 1 ? parts.slice(0, -1).join("/") : undefined,
		depth: parts.length - 1,
		color:
			parsed.color ?? nextMetadata[nextPath]?.color ?? DEFAULT_FOLDER_COLOR,
	};
}

export async function deleteOrbitFolder(input: DeleteFolderInput) {
	const parsed = deleteFolderInputSchema.parse(input);
	const vaultRoot = await ensureVault();
	const folderPath = normalizeFolderPath(parsed.path);
	if (splitVaultObjectKey(folderPath).length === 0) {
		throw new Error("Folder path is required");
	}
	const directory = path.join(
		vaultRoot,
		folderRoot(parsed.space),
		...splitVaultObjectKey(folderPath),
	);
	assertInsideVault(vaultRoot, directory);
	try {
		await rmdir(directory);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOTEMPTY") {
			throw new Error("노트나 하위 폴더가 있는 폴더는 삭제할 수 없습니다.");
		}
		throw error;
	}
	const metadata = await readFolderMetadata(vaultRoot);
	const spaceMetadata = metadata.folders[parsed.space];
	if (spaceMetadata?.[folderPath]) {
		delete spaceMetadata[folderPath];
		await writeFolderMetadata(vaultRoot, metadata);
	}
	return { space: parsed.space, path: folderPath };
}

export async function fileOrbitItem(id: string, input: FileItemInput) {
	const next = fileItemInputSchema.parse(input);
	const vaultRoot = await ensureVault();
	const found = await findItemFile(id, vaultRoot);
	if (!found) throw new Error(`Orbit item not found: ${id}`);

	const current = found.parsed.data as Record<string, unknown>;
	const title =
		next.title ?? String(current.title ?? path.basename(found.filePath, ".md"));
	const type = next.type ?? (current.type as OrbitItem["type"]) ?? "note";
	const folder = next.folder
		? normalizeFolderPath(next.folder) || undefined
		: undefined;
	const space =
		type === "event" && next.space !== "archive" ? "event" : next.space;
	const relativeDir = destinationDir(space, folder);
	const directory = path.join(vaultRoot, relativeDir);
	assertInsideVault(vaultRoot, directory);
	await mkdir(directory, { recursive: true });

	let destPath = path.join(directory, path.basename(found.filePath));
	if (path.resolve(destPath) !== path.resolve(found.filePath)) {
		destPath = await uniqueFilePath(directory, path.basename(found.filePath));
	}
	assertInsideVault(vaultRoot, destPath);

	const status =
		type === "task"
			? (next.status ??
				(typeof current.status === "string" ? current.status : "open"))
			: undefined;
	const project =
		space === "project"
			? (folder ??
				(typeof current.project === "string" ? current.project : undefined))
			: typeof current.project === "string"
				? current.project
				: undefined;
	const body = next.body ?? found.parsed.content.trim();
	const tags = next.tags ?? normalizeTags(current.tags);
	const contents = matter.stringify(body ? `${body}\n` : "", {
		...itemFrontmatter(
			{
				id: String(current.id ?? id),
				title,
				type,
				space,
				status: status as OrbitItem["status"],
				project,
				due:
					next.due === null
						? undefined
						: (next.due ??
							(current.due
								? normalizeScheduleDate(current.due, "")
								: undefined)),
				start:
					next.start === null
						? undefined
						: (next.start ??
							(current.start
								? normalizeScheduleDate(current.start, "")
								: undefined)),
				end:
					next.end === null
						? undefined
						: (next.end ??
							(current.end
								? normalizeScheduleDate(current.end, "")
								: undefined)),
				url:
					next.url ??
					(typeof current.url === "string" ? current.url : undefined),
				tags,
				created: normalizeDate(current.created, new Date().toISOString()),
				updated: new Date().toISOString(),
			},
			current,
		),
	});

	await atomicWrite(destPath, contents);
	if (path.resolve(destPath) !== path.resolve(found.filePath)) {
		await unlink(found.filePath);
	}
	return readOrbitItem(destPath, vaultRoot);
}

export async function toggleOrbitTask(id: string) {
	const vaultRoot = await ensureVault();
	const found = await findItemFile(id, vaultRoot);
	if (!found) throw new Error(`Orbit item not found: ${id}`);
	if (found.parsed.data.type !== "task") {
		throw new Error("Only tasks can be toggled");
	}
	const nextStatus = found.parsed.data.status === "done" ? "open" : "done";
	const contents = matter.stringify(found.parsed.content, {
		...found.parsed.data,
		status: nextStatus,
		updated: new Date().toISOString(),
	});
	await atomicWrite(found.filePath, contents);
	return readOrbitItem(found.filePath, vaultRoot);
}

export async function updateOrbitNote(id: string, input: UpdateNoteInput) {
	const next = updateNoteInputSchema.parse(input);
	const vaultRoot = await ensureVault();
	const found = await findItemFile(id, vaultRoot);
	if (!found) throw new Error(`Orbit item not found: ${id}`);
	const currentTitle = String(found.parsed.data.title ?? "");
	const currentBody = found.parsed.content.replace(/\r\n?/g, "\n").trim();
	const nextBody = next.body.replace(/\r\n?/g, "\n").trim();
	const currentTags = normalizeTags(found.parsed.data.tags);
	if (
		currentTitle === next.title &&
		currentBody === nextBody &&
		currentTags.join("\0") === next.tags.join("\0")
	) {
		return readOrbitItem(found.filePath, vaultRoot);
	}
	const contents = matter.stringify(nextBody ? `${nextBody}\n` : "", {
		...found.parsed.data,
		title: next.title,
		tags: next.tags,
		updated: new Date().toISOString(),
	});
	await atomicWrite(found.filePath, contents);
	return readOrbitItem(found.filePath, vaultRoot);
}

export async function archiveOrbitItem(id: string) {
	const item = await getOrbitItem(id);
	return fileOrbitItem(id, { space: "archive", folder: item?.folder });
}

export async function deleteOrbitItem(id: string) {
	const vaultRoot = await ensureVault();
	const found = await findItemFile(id, vaultRoot);
	if (!found) throw new Error(`Orbit item not found: ${id}`);
	assertInsideVault(vaultRoot, found.filePath);
	if (path.extname(found.filePath) !== ".md") {
		throw new Error("Only markdown items can be deleted");
	}
	const item = await readOrbitItem(found.filePath, vaultRoot);
	await unlink(found.filePath);
	return item;
}

export async function getOrbitItem(id: string) {
	const vaultRoot = await ensureVault();
	const found = await findItemFile(id, vaultRoot);
	if (!found) return null;
	return readOrbitItem(found.filePath, vaultRoot);
}
