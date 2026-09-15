import { randomUUID } from "node:crypto";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import matter from "gray-matter";
import LZString from "lz-string";
import { databaseFor, getVaultRoot } from "./database";
import { isInboxItem } from "./para";
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
	type MoveTreeInput,
	moveTreeInputSchema,
	type OrbitCanvas,
	type OrbitFolder,
	type OrbitFolderColor,
	type OrbitItem,
	type OrbitMutation,
	type OrbitSnapshot,
	type OrbitSpace,
	orbitFolderColorSchema,
	type UpdateFolderInput,
	type UpdateNoteInput,
	updateFolderInputSchema,
	updateNoteInputSchema,
} from "./schema";
import { planTreeMove, remapTreeOrder } from "./tree-move";
import type { MutationReceipt, UndoResult } from "./undo-events";
import { splitVaultObjectKey, toVaultSlug } from "./vault-key";

const PARA_VAULT: Record<"project" | "area" | "resource", string> = {
	project: "projects",
	area: "areas",
	resource: "resources",
};

const DEFAULT_FOLDER_COLOR: OrbitFolderColor = "lime";

type FolderMetadata = {
	treeOrder?: OrbitSnapshot["treeOrder"];
	version: 1;
	folders: Partial<
		Record<
			"project" | "area" | "resource" | "archive",
			Record<string, { color: OrbitFolderColor }>
		>
	>;
};

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

async function existingFolderPath(
	vaultRoot: string,
	space: OrbitFolder["space"],
	value: string,
) {
	if (!value) return "";
	const parts = splitVaultObjectKey(value);
	if (
		parts.some((part) => part === "." || part === ".." || part.includes("\\"))
	)
		throw new Error("Invalid folder path");
	const exact = parts.join("/");
	const directory = path.join(vaultRoot, folderRoot(space), ...parts);
	assertInsideVault(vaultRoot, directory);
	try {
		if ((await documentInfo(directory)).isDirectory()) return exact;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	return normalizeFolderPath(value);
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
	databaseFor(root);
	return root;
}
function db() {
	return databaseFor(getVaultRoot());
}
async function readDocument(filePath: string, _encoding?: string) {
	return db().read(filePath).raw;
}
async function createDirectory(
	directory: string,
	_options?: { recursive: boolean },
) {
	db().mkdir(directory);
}
async function documentInfo(filePath: string) {
	return db().info(filePath);
}
async function moveDocument(from: string, to: string) {
	db().move(from, to);
}
async function removeDocument(filePath: string) {
	db().remove(filePath);
}
async function removeDirectory(directory: string) {
	db().rmdir(directory);
}
async function findMarkdownFiles(_directory: string) {
	return db().paths("item");
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

async function readOrbitCanvas(filePath: string, _vaultRoot: string) {
	const canvas = db().read(filePath).canvas;
	if (!canvas) throw new Error("Invalid Excalidraw document");
	return canvas;
}

async function listOrbitCanvases(_vaultRoot: string) {
	return db().canvases();
}
async function listNestedFolders(directory: string, _prefix = "") {
	return db().folders(directory);
}

function emptyFolderMetadata(): FolderMetadata {
	return { version: 1, folders: {} };
}

async function readFolderMetadata(vaultRoot: string): Promise<FolderMetadata> {
	return (
		databaseFor(vaultRoot).metadata<FolderMetadata>("folders") ??
		emptyFolderMetadata()
	);
}
async function writeFolderMetadata(
	vaultRoot: string,
	metadata: FolderMetadata,
) {
	databaseFor(vaultRoot).setMetadata("folders", metadata);
}
async function readOrbitItem(filePath: string, vaultRoot: string) {
	return databaseFor(vaultRoot).read(filePath).item;
}
export async function listOrbitItems() {
	const root = await ensureVault();
	return databaseFor(root).items();
}
async function findItemFile(id: string, vaultRoot: string) {
	const record = databaseFor(vaultRoot).byId(id);
	if (!record) return null;
	const parsed = matter(record.raw);
	// A legacy duplicate ID may have been remapped during migration. Mutations use
	// the database identity while keeping the unedited original raw text intact.
	const data: Record<string, unknown> = {
		...parsed.data,
		id: record.item?.id ?? id,
	};
	return {
		filePath: path.join(vaultRoot, record.path),
		raw: record.raw,
		parsed: { ...parsed, data },
	};
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

	const [canvases, folders, metadata] = await Promise.all([
		listOrbitCanvases(vaultRoot),
		collectFolders(vaultRoot, items),
		readFolderMetadata(vaultRoot),
	]);
	return {
		items,
		canvases,
		treeOrder: metadata.treeOrder,
		today: { tasks, events },
		folders,
		counts: {
			inbox: items.filter(isInboxItem).length,
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
	const raw = await readDocument(filePath, "utf8");
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
	const current = await readDocument(filePath, "utf8");
	const currentDocument = canvasJson(current, format);
	const withMetadata = JSON.stringify({
		...nextDocument,
		...(typeof currentDocument.orbitTitle === "string"
			? { orbitTitle: currentDocument.orbitTitle }
			: {}),
	});
	// Editor initialization can emit the same scene with reordered keys or without
	// Orbit's title. Keep the original source bytes and modification date intact.
	if (isDeepStrictEqual(currentDocument, JSON.parse(withMetadata)))
		return readOrbitCanvas(filePath, vaultRoot);
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
	const raw = await readDocument(sourcePath, "utf8");
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
			const note = await readDocument(filePath, "utf8");
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
	db().write(filePath, contents);
}

async function uniqueFilePath(directory: string, filename: string) {
	const initial = path.join(directory, filename);
	try {
		await documentInfo(initial);
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
		color?: OrbitItem["color"];
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
	if (input.color) data.color = input.color;
	else delete data.color;
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
	await createDirectory(directory, { recursive: true });
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
			color: parsed.color,
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
	await createDirectory(directory, { recursive: true });
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
	const currentPath = await existingFolderPath(
		vaultRoot,
		parsed.space,
		parsed.path,
	);
	const currentParts = splitVaultObjectKey(currentPath);
	if (currentParts.length === 0) throw new Error("Folder path is required");

	let nextPath = currentPath;
	if (parsed.name || parsed.parent !== undefined) {
		const nextName = parsed.name
			? toVaultSlug(parsed.name)
			: (currentParts.at(-1) ?? currentPath);
		const parent =
			parsed.parent !== undefined
				? await existingFolderPath(vaultRoot, parsed.space, parsed.parent)
				: currentParts.slice(0, -1).join("/");
		if (parent === currentPath || parent.startsWith(`${currentPath}/`))
			throw new Error("자신의 하위 폴더로 이동할 수 없습니다.");
		nextPath = [parent, nextName].filter(Boolean).join("/");
		if (nextPath !== currentPath) {
			const root = path.join(vaultRoot, folderRoot(parsed.space));
			const source = path.join(root, ...currentParts);
			const destination = path.join(root, ...splitVaultObjectKey(nextPath));
			assertInsideVault(vaultRoot, source);
			assertInsideVault(vaultRoot, destination);
			try {
				await documentInfo(destination);
				throw new Error("같은 이름의 폴더가 이미 있습니다.");
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
			await moveDocument(source, destination);
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
	if (metadata.treeOrder?.[parsed.space] && currentPath !== nextPath) {
		metadata.treeOrder[parsed.space] = remapTreeOrder(
			metadata.treeOrder[parsed.space] ?? {},
			currentPath,
			nextPath,
		);
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
		await removeDirectory(directory);
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
	if (next.expectedLocation) {
		const relative = path
			.relative(vaultRoot, found.filePath)
			.split(path.sep)
			.join("/");
		const expected = next.expectedLocation;
		if (
			spaceFromPath(relative) !== expected.space ||
			folderFromPath(relative) !== expected.folder
		) {
			throw new Error("항목의 위치가 이후 변경되었습니다.");
		}
	}
	const title =
		next.title ?? String(current.title ?? path.basename(found.filePath, ".md"));
	const type = next.type ?? (current.type as OrbitItem["type"]) ?? "note";
	const folder = next.folder
		? (next.space === "project" ||
			next.space === "area" ||
			next.space === "resource" ||
			next.space === "archive"
				? await existingFolderPath(vaultRoot, next.space, next.folder)
				: normalizeFolderPath(next.folder)) || undefined
		: undefined;
	const space =
		type === "event" && next.space !== "archive" ? "event" : next.space;
	const relativeDir = destinationDir(space, folder);
	const directory = path.join(vaultRoot, relativeDir);
	assertInsideVault(vaultRoot, directory);
	await createDirectory(directory, { recursive: true });

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
		next.project === null
			? undefined
			: (next.project ??
				(space === "project"
					? (folder ??
						(typeof current.project === "string" ? current.project : undefined))
					: typeof current.project === "string"
						? current.project
						: undefined));
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
				color:
					next.color === null
						? undefined
						: (next.color ??
							orbitFolderColorSchema.safeParse(current.color).data),
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

	if (path.resolve(destPath) !== path.resolve(found.filePath)) {
		await removeDocument(found.filePath);
	}
	await atomicWrite(destPath, contents);
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
	await removeDocument(found.filePath);
	return item;
}

export async function getOrbitItem(id: string) {
	const vaultRoot = await ensureVault();
	const found = await findItemFile(id, vaultRoot);
	if (!found) return null;
	return readOrbitItem(found.filePath, vaultRoot);
}

// Serialize tree drops so concurrent moves cannot overwrite sibling ordering.

export function moveOrbitTreeEntry(input: MoveTreeInput) {
	const parsed = moveTreeInputSchema.parse(input);
	const vaultRoot = getVaultRoot();
	const operation = (async () => {
		if (getVaultRoot() !== vaultRoot)
			throw new Error("Vault changed during move");
		const snapshot = await getOrbitSnapshot();
		const plan = planTreeMove(
			snapshot.items.filter((item) => item.space === parsed.space),
			snapshot.folders[parsed.space],
			snapshot.treeOrder?.[parsed.space] ?? {},
			parsed,
		);
		if (plan.from && plan.to && plan.from !== plan.to)
			await updateOrbitFolder({
				space: parsed.space,
				path: plan.from,
				parent: plan.parent,
			});
		if (plan.item && (plan.item.folder ?? "") !== plan.parent)
			await fileOrbitItem(plan.item.id, {
				space: parsed.space,
				folder: plan.parent,
			});
		const metadata = await readFolderMetadata(vaultRoot);
		metadata.treeOrder = {
			...metadata.treeOrder,
			[parsed.space]: plan.order,
		};
		await writeFolderMetadata(vaultRoot, metadata);
		return { ok: true };
	})();
	return operation;
}

type ItemRevision = {
	path: string;
	contents: string;
	created: string;
	modified: string;
};
type ItemUndo = {
	vault: string;
	itemId: string;
	before: ItemRevision | null;
	after: ItemRevision | null;
};
const itemUndos = new Map<string, ItemUndo>();

function serializeItemMutation<T>(work: () => Promise<T>): Promise<T> {
	return work();
}

async function itemRevision(
	id: string,
	vault: string,
): Promise<ItemRevision | null> {
	const found = await findItemFile(id, vault);
	return found
		? {
				path: path.relative(vault, found.filePath),
				contents: await readDocument(found.filePath, "utf8"),
				created: db().read(found.filePath).created,
				modified: db().read(found.filePath).modified,
			}
		: null;
}

function changedRevisionFields(before: ItemRevision, after: ItemRevision) {
	const left = matter(before.contents);
	const right = matter(after.contents);
	const fields = [
		...new Set([...Object.keys(left.data), ...Object.keys(right.data)]),
	].filter(
		(key) =>
			key !== "updated" && !isDeepStrictEqual(left.data[key], right.data[key]),
	);
	if (left.content.trim() !== right.content.trim()) fields.push("$body");
	if (before.path !== after.path) fields.push("$path");
	return fields;
}

function itemMutationMessage(
	data: OrbitMutation,
	before: OrbitItem | null,
	after: OrbitItem | null,
) {
	if (!before) return "추가했습니다.";
	if (!after) return "삭제했습니다.";
	if (before.type !== after.type)
		return `${{ note: "노트로", task: "할 일로", event: "일정으로", link: "링크로" }[after.type]} 바꿨습니다.`;
	if (before.status !== after.status)
		return after.status === "done" ? "완료했습니다." : "미완료로 바꿨습니다.";
	if (before.space !== after.space || before.folder !== after.folder)
		return after.space === "archive" ? "보관했습니다." : "이동했습니다.";
	if (
		before.due !== after.due ||
		before.start !== after.start ||
		before.end !== after.end
	)
		return "날짜를 변경했습니다.";
	if (before.color !== after.color) return "색상을 변경했습니다.";
	return data.action === "file-item" ? "변경했습니다." : "저장했습니다.";
}

// Capture the actual persisted before/after values, shared by every item UI.
// Autosaves share the queue but stay in the text editor's own undo history.
export function withItemUndo<T>(
	data: OrbitMutation,
	work: () => Promise<T>,
): Promise<{ result: T; undo: MutationReceipt | null }> {
	const tracked = [
		"capture",
		"create-item",
		"file-item",
		"toggle-task",
		"archive-item",
		"delete-item",
	].includes(data.action);
	if (!tracked && data.action !== "update-note")
		return work().then((result) => ({ result, undo: null }));
	const vault = getVaultRoot();
	return serializeItemMutation(async () => {
		if (vault !== getVaultRoot())
			throw new Error("Vault changed during operation");
		const before =
			tracked && "id" in data ? await itemRevision(data.id, vault) : null;
		const beforeItem =
			tracked && "id" in data ? await getOrbitItem(data.id) : null;
		const result = await work();
		if (!tracked) return { result, undo: null };
		const itemId = "id" in data ? data.id : (result as OrbitItem | null)?.id;
		if (!itemId) return { result, undo: null };
		const after = await itemRevision(itemId, vault);
		if (
			(!before && !after) ||
			(before && after && !changedRevisionFields(before, after).length)
		)
			return { result, undo: null };
		const afterItem = after ? await getOrbitItem(itemId) : null;
		const id = randomUUID();
		itemUndos.set(id, { vault, itemId, before, after });
		while (itemUndos.size > 200) {
			const oldest = itemUndos.keys().next().value;
			if (oldest) itemUndos.delete(oldest);
		}
		return {
			result,
			undo: {
				id,
				itemId,
				title: afterItem?.title ?? beforeItem?.title ?? "",
				message: itemMutationMessage(data, beforeItem, afterItem),
			},
		};
	});
}

export function undoOrbitMutation(id: string): Promise<UndoResult> {
	return serializeItemMutation(async () => {
		const entry = itemUndos.get(id);
		if (!entry || entry.vault !== getVaultRoot())
			throw new Error("되돌리기 기록을 찾을 수 없습니다.");
		const { vault, itemId, before, after } = entry;
		const current = await itemRevision(itemId, vault);
		const conflict = () =>
			new Error("이후 변경된 내용이 있어 되돌릴 수 없습니다.");
		let fields: string[];
		if (!before && after) {
			if (!current || changedRevisionFields(after, current).length)
				throw conflict();
			await deleteOrbitItem(itemId);
			fields = ["$existence"];
		} else if (before && !after) {
			if (current) throw conflict();
			const destination = path.join(vault, before.path);
			assertInsideVault(vault, destination);
			// Exclusive creation never overwrites another file at the old path.
			await createDirectory(path.dirname(destination), { recursive: true });
			db().write(destination, before.contents, true, {
				created: before.created,
				modified: before.modified,
				identity: itemId,
			});
			fields = ["$existence"];
		} else if (before && after && current) {
			fields = changedRevisionFields(before, after);
			const old = matter(before.contents);
			const expected = matter(after.contents);
			const live = matter(current.contents);
			for (const field of fields) {
				if (field === "$path") {
					if (current.path !== after.path) throw conflict();
				} else if (field === "$body") {
					if (live.content.trim() !== expected.content.trim()) throw conflict();
				} else if (!isDeepStrictEqual(live.data[field], expected.data[field]))
					throw conflict();
			}
			const restored: Record<string, unknown> = {
				...live.data,
				updated: new Date().toISOString(),
			};
			for (const field of fields) {
				if (field.startsWith("$")) continue;
				if (Object.hasOwn(old.data, field)) restored[field] = old.data[field];
				else delete restored[field];
			}
			const contents = matter.stringify(
				fields.includes("$body") ? old.content : live.content,
				restored,
			);
			const destination = path.join(
				vault,
				fields.includes("$path") ? before.path : current.path,
			);
			assertInsideVault(vault, destination);
			if (destination !== path.join(vault, current.path)) {
				await createDirectory(path.dirname(destination), { recursive: true });
				await removeDocument(path.join(vault, current.path));
				db().write(destination, contents, true, {
					created: before.created,
					modified: new Date().toISOString(),
					identity: itemId,
				});
			} else
				db().write(destination, contents, false, {
					created: before.created,
					modified: new Date().toISOString(),
					identity: itemId,
				});
		} else throw conflict();
		itemUndos.delete(id);
		return { itemId, item: await getOrbitItem(itemId), fields };
	});
}
