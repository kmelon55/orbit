import path from "node:path";
import matter from "gray-matter";
import LZString from "lz-string";
import {
	type OrbitCanvas,
	type OrbitItem,
	orbitFolderColorSchema,
	orbitItemSchema,
} from "./schema";
import { splitVaultObjectKey } from "./vault-key";

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

export function parseItem(
	raw: string,
	relativePath: string,
	created: string,
	updated: string,
	fallbackId?: string,
) {
	const parsed = matter(raw);
	const filePath = relativePath;
	const fallbackDate = created;
	const data = parsed.data;
	const space = spaceFromPath(relativePath);

	const result = orbitItemSchema.safeParse({
		id: data.id ?? fallbackId ?? relativePath,
		title: data.title ?? path.basename(filePath, ".md"),
		type: data.type ?? "note",
		space: data.space ?? space,
		status: data.status,
		color: orbitFolderColorSchema.safeParse(data.color).data,
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
		updated: normalizeDate(data.updated, updated),
		body: parsed.content.trim(),
		path: relativePath,
	});

	return result.success ? result.data : null;
}
export function parseCanvas(
	raw: string,
	relativePath: string,
	created: string,
	updated: string,
) {
	const filePath = relativePath;
	const format = canvasFormat(filePath);
	const document = canvasJson(raw, format);

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
		created: created,
		updated: updated,
		elementCount: document.elements.length,
		fileCount: Object.keys(document.files ?? {}).length,
		format,
	};
}

export function withStableIdentity(raw: string, item: OrbitItem) {
	const parsed = matter(raw);
	return parsed.data.id === item.id
		? raw
		: matter.stringify(parsed.content, {
				...parsed.data,
				id: item.id,
				created: parsed.data.created ?? item.created,
				updated: parsed.data.updated ?? item.updated,
			});
}

export function normalizeFolderMetadata<
	T extends {
		version: number;
		folders: Record<string, unknown>;
		treeOrder?: Record<string, Record<string, string[]>>;
	},
>(value: T): T {
	const copy = JSON.parse(JSON.stringify(value)) as T;
	function normalized<TValue>(
		record: Record<string, TValue>,
	): Record<string, TValue> {
		const result: Record<string, TValue> = {};
		for (const [key, entry] of Object.entries(record)) {
			const canonical = key.normalize("NFC");
			if (
				Object.hasOwn(result, canonical) &&
				JSON.stringify(result[canonical]) !== JSON.stringify(entry)
			)
				throw new Error(`Conflicting Unicode folder metadata: ${key}`);
			result[canonical] = entry;
		}
		return result;
	}
	for (const [space, folders] of Object.entries(copy.folders))
		copy.folders[space] = normalized(folders as Record<string, unknown>);
	for (const [space, order] of Object.entries(copy.treeOrder ?? {})) {
		const next = normalized(order);
		for (const [parent, entries] of Object.entries(next))
			next[parent] = entries.map((entry) =>
				entry.startsWith("folder:") ? entry.normalize("NFC") : entry,
			);
		if (copy.treeOrder) copy.treeOrder[space] = next;
	}
	return copy;
}
