import { randomUUID } from "node:crypto";
import {
	mkdir,
	readdir,
	readFile,
	rename,
	stat,
	unlink,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import {
	type CaptureInput,
	captureInputSchema,
	type OrbitItem,
	type OrbitSnapshot,
	orbitItemSchema,
	type UpdateNoteInput,
	updateNoteInputSchema,
} from "./schema";

const VAULT_FOLDERS = [
	"inbox",
	"projects",
	"areas",
	"resources",
	"events",
	"archive",
] as const;

function getVaultRoot() {
	return path.resolve(process.env.ORBIT_DATA_DIR ?? "data");
}

function normalizeDate(value: unknown, fallback: string) {
	if (value instanceof Date) return value.toISOString();
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
	const root = relativePath.split(path.sep)[0];
	if (root === "projects") return "project";
	if (root === "areas") return "area";
	if (root === "resources") return "resource";
	if (root === "events") return "event";
	if (root === "archive") return "archive";
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
			const entryPath = path.join(directory, entry.name);
			if (entry.isDirectory()) return findMarkdownFiles(entryPath);
			if (entry.isFile() && entry.name.endsWith(".md")) return [entryPath];
			return [];
		}),
	);
	return nested.flat();
}

async function readOrbitItem(filePath: string, vaultRoot: string) {
	const [raw, fileStats] = await Promise.all([
		readFile(filePath, "utf8"),
		stat(filePath),
	]);
	const parsed = matter(raw);
	const relativePath = path.relative(vaultRoot, filePath);
	const fallbackDate = fileStats.birthtime.toISOString();
	const data = parsed.data;

	const result = orbitItemSchema.safeParse({
		id: data.id ?? relativePath,
		title: data.title ?? path.basename(filePath, ".md"),
		type: data.type ?? "note",
		space: data.space ?? spaceFromPath(relativePath),
		status: data.status,
		project: data.project,
		due: data.due ? normalizeDate(data.due, fallbackDate) : undefined,
		start: data.start ? normalizeDate(data.start, fallbackDate) : undefined,
		end: data.end ? normalizeDate(data.end, fallbackDate) : undefined,
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

function localDateKey(date = new Date()) {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function itemDateKey(value?: string) {
	return value?.slice(0, 10);
}

export async function getOrbitSnapshot(): Promise<OrbitSnapshot> {
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
		today: { tasks, events },
		counts: {
			inbox: items.filter((item) => item.space === "inbox").length,
			projects: new Set(
				items
					.filter((item) => item.space === "project")
					.map((item) => item.project ?? item.path.split(path.sep)[1]),
			).size,
			areas: items.filter((item) => item.space === "area").length,
			resources: items.filter((item) => item.space === "resource").length,
		},
		vaultPath: getVaultRoot(),
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

function slugify(value: string) {
	return (
		value
			.toLowerCase()
			.normalize("NFKD")
			.replace(/[^\p{Letter}\p{Number}]+/gu, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 72) || "untitled"
	);
}

async function atomicWrite(filePath: string, contents: string) {
	const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
	await writeFile(temporaryPath, contents, { encoding: "utf8", flag: "wx" });
	await rename(temporaryPath, filePath);
}

export async function captureOrbitItem(input: CaptureInput) {
	const parsed = captureInputSchema.parse(input);
	const vaultRoot = await ensureVault();
	const now = new Date().toISOString();
	const id = randomUUID();
	const filename = `${localDateKey()}-${slugify(parsed.title)}-${id.slice(0, 8)}.md`;
	const filePath = path.join(vaultRoot, "inbox", filename);
	const status = parsed.type === "task" ? "open" : undefined;
	const contents = matter.stringify(parsed.body ? `${parsed.body}\n` : "", {
		id,
		title: parsed.title,
		type: parsed.type,
		space: "inbox",
		...(status ? { status } : {}),
		...(parsed.due ? { due: parsed.due } : {}),
		tags: [],
		created: now,
		updated: now,
	});
	await atomicWrite(filePath, contents);
	return readOrbitItem(filePath, vaultRoot);
}

export async function toggleOrbitTask(id: string) {
	const vaultRoot = await ensureVault();
	const files = await findMarkdownFiles(vaultRoot);
	for (const filePath of files) {
		const raw = await readFile(filePath, "utf8");
		const parsed = matter(raw);
		if (String(parsed.data.id ?? path.relative(vaultRoot, filePath)) !== id)
			continue;
		if (parsed.data.type !== "task")
			throw new Error("Only tasks can be toggled");
		const nextStatus = parsed.data.status === "done" ? "open" : "done";
		const contents = matter.stringify(parsed.content, {
			...parsed.data,
			status: nextStatus,
			updated: new Date().toISOString(),
		});
		await atomicWrite(filePath, contents);
		return readOrbitItem(filePath, vaultRoot);
	}
	throw new Error(`Orbit item not found: ${id}`);
}

export async function updateOrbitNote(id: string, input: UpdateNoteInput) {
	const next = updateNoteInputSchema.parse(input);
	const vaultRoot = await ensureVault();
	const files = await findMarkdownFiles(vaultRoot);
	for (const filePath of files) {
		const raw = await readFile(filePath, "utf8");
		const parsed = matter(raw);
		if (String(parsed.data.id ?? path.relative(vaultRoot, filePath)) !== id)
			continue;
		if (parsed.data.type !== "note")
			throw new Error("Only notes can be edited");
		const contents = matter.stringify(
			next.body ? `${next.body.trimEnd()}\n` : "",
			{
				...parsed.data,
				title: next.title,
				tags: next.tags,
				updated: new Date().toISOString(),
			},
		);
		await atomicWrite(filePath, contents);
		return readOrbitItem(filePath, vaultRoot);
	}
	throw new Error(`Orbit item not found: ${id}`);
}

export async function archiveOrbitItem(id: string) {
	const vaultRoot = await ensureVault();
	const files = await findMarkdownFiles(vaultRoot);
	for (const filePath of files) {
		const raw = await readFile(filePath, "utf8");
		const parsed = matter(raw);
		if (String(parsed.data.id ?? path.relative(vaultRoot, filePath)) !== id)
			continue;
		if (spaceFromPath(path.relative(vaultRoot, filePath)) === "archive") {
			return readOrbitItem(filePath, vaultRoot);
		}
		const archiveName = `${path.basename(filePath, ".md")}-${id.slice(0, 8)}.md`;
		const archivePath = path.join(vaultRoot, "archive", archiveName);
		const contents = matter.stringify(parsed.content, {
			...parsed.data,
			space: "archive",
			updated: new Date().toISOString(),
		});
		await atomicWrite(archivePath, contents);
		await unlink(filePath);
		return readOrbitItem(archivePath, vaultRoot);
	}
	throw new Error(`Orbit item not found: ${id}`);
}
