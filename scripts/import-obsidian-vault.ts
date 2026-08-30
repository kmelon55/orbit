import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import matter from "gray-matter";
import { toVaultSlug } from "../src/lib/orbit/vault-key";

type ImportKind = "markdown" | "canvas" | "attachment";

const DEFAULT_SOURCE = "/Users/kimgyeongmo/Documents/Second-Brain";
const EXCLUDED_DIRECTORIES = new Set([".git", ".obsidian", ".space", ".makemd"]);
const ROOT_MAPPING: Record<string, string> = {
	Project: "projects",
	Area: "areas",
	Resource: "resources",
	Archive: "archive",
	Draft: "inbox/draft",
	Spaces: "resources/spaces",
	"Wish list": "resources/wish-list",
	Excalidraw: "whiteboards",
};

function usage() {
	console.log(`Usage: pnpm migrate:obsidian -- <source-vault> [--dry-run]

Copies Markdown, Excalidraw, and attachments into ORBIT_VAULT_DIR.
The source is never changed or deleted. Existing files are skipped when identical.`);
}

function parseArgs() {
	const args = process.argv.slice(2);
	if (args.includes("--help") || args.includes("-h")) {
		usage();
		process.exit(0);
	}
	return {
		source: path.resolve(args.find((arg) => !arg.startsWith("-")) ?? DEFAULT_SOURCE),
		dryRun: args.includes("--dry-run"),
	};
}

async function walk(directory: string, root: string): Promise<Array<{ filePath: string; relativePath: string; kind: ImportKind }>> {
	const entries = await readdir(directory, { withFileTypes: true });
	const results: Array<{ filePath: string; relativePath: string; kind: ImportKind }> = [];
	for (const entry of entries) {
		const filePath = path.join(directory, entry.name);
		const relativePath = path.relative(root, filePath);
		if (entry.isDirectory()) {
			if (entry.name.startsWith(".") || EXCLUDED_DIRECTORIES.has(entry.name)) continue;
			results.push(...(await walk(filePath, root)));
			continue;
		}
		if (!entry.isFile()) continue;
		const lower = entry.name.toLowerCase();
		const kind: ImportKind = lower.endsWith(".excalidraw") || lower.endsWith(".excalidraw.md")
			? "canvas"
			: lower.endsWith(".md")
				? "markdown"
				: "attachment";
		results.push({ filePath, relativePath, kind });
	}
	return results;
}

function mappedRoot(relativePath: string) {
	const parts = relativePath.split(path.sep);
	if (parts.length === 1) return { mapped: "resources/imported", rest: parts };
	const [root, ...rest] = parts;
	const mapped = ROOT_MAPPING[root ?? ""] ?? `resources/imported/${toVaultSlug(root ?? "other")}`;
	return { mapped, rest };
}

function destinationFor(relativePath: string, kind: ImportKind) {
	const { mapped, rest } = mappedRoot(relativePath);
	if (kind === "attachment") {
		return path.join("attachments", relativePath);
	}
	const targetParts = [mapped, ...rest];
	const filename = targetParts.pop() ?? "untitled";
	const extension = kind === "canvas" && filename.toLowerCase().endsWith(".excalidraw.md")
		? ".excalidraw.md"
		: filename.toLowerCase().endsWith(".md")
			? ".md"
		: path.extname(filename).toLowerCase();
	const stem = extension === ".excalidraw.md"
		? filename.slice(0, -extension.length)
		: path.basename(filename, extension);
	targetParts.push(`${toVaultSlug(stem)}${extension}`);
	return path.join(...targetParts);
}

function orbitSpace(destination: string) {
	const root = destination.split(path.sep)[0];
	if (root === "projects") return "project";
	if (root === "areas") return "area";
	if (root === "archive") return "archive";
	return "resource";
}

function stringValue(value: unknown) {
	if (value instanceof Date) return value.toISOString();
	return typeof value === "string" && value.trim() ? value : undefined;
}

function tagsValue(value: unknown) {
	if (Array.isArray(value)) return value.map(String).filter(Boolean);
	if (typeof value === "string") return value.split(",").map((tag) => tag.trim()).filter(Boolean);
	return [];
}

async function importedMarkdown(sourcePath: string, destination: string, sourceRelativePath: string) {
	const raw = await readFile(sourcePath, "utf8");
	const parsed = matter(raw);
	const fileStats = await stat(sourcePath);
	const space = orbitSpace(destination);
	const requestedType = stringValue(parsed.data.type);
	const type = requestedType === "task" || requestedType === "event" || requestedType === "link"
		? requestedType
		: "note";
	const title = stringValue(parsed.data.title) ?? path.basename(sourcePath, ".md");
	const created = stringValue(parsed.data.created) ?? stringValue(parsed.data.date) ?? fileStats.birthtime.toISOString();
	const updated = stringValue(parsed.data.updated) ?? stringValue(parsed.data.modified) ?? fileStats.mtime.toISOString();
	const frontmatter: Record<string, unknown> = {
		...parsed.data,
		id: stringValue(parsed.data.id) ?? `obsidian:${sourceRelativePath.split(path.sep).join("/")}`,
		title,
		type,
		space,
		tags: tagsValue(parsed.data.tags),
		created,
		updated,
		obsidianSource: sourceRelativePath.split(path.sep).join("/"),
	};
	if (type === "task") frontmatter.status = stringValue(parsed.data.status) ?? "open";
	else delete frontmatter.status;
	return matter.stringify(parsed.content.trim() ? `${parsed.content.trim()}\n` : "", frontmatter);
}

async function uniqueDestination(destination: string, contents: string | undefined, dryRun: boolean) {
	if (dryRun) return destination;
	try {
		const existing = await readFile(destination, contents === undefined ? undefined : "utf8");
		if (contents === undefined || existing.toString() === contents) return null;
	} catch {
		return destination;
	}
	const extension = path.extname(destination);
	const stem = extension === ".md" && destination.endsWith(".excalidraw.md")
		? destination.slice(0, -".excalidraw.md".length)
		: extension
			? destination.slice(0, -extension.length)
			: destination;
	return `${stem}-${Date.now()}${extension}`;
}

async function main() {
	const { source, dryRun } = parseArgs();
	const destinationRoot = path.resolve(process.env.ORBIT_VAULT_DIR ?? process.env.ORBIT_DATA_DIR ?? "vault");
	const sourceStats = await stat(source).catch(() => null);
	if (!sourceStats?.isDirectory()) {
		throw new Error(`Source vault does not exist or is not a directory: ${source}`);
	}

	const files = await walk(source, source);
	if (files.length === 0) {
		throw new Error(`No importable files found in ${source}. The vault may be an offline/cloud placeholder.`);
	}
	const counts = { markdown: 0, canvas: 0, attachment: 0, skipped: 0 };
	for (const file of files) {
		const relativeDestination = destinationFor(file.relativePath, file.kind);
		const target = path.join(destinationRoot, relativeDestination);
		const contents = file.kind === "markdown"
			? await importedMarkdown(file.filePath, relativeDestination, file.relativePath)
			: undefined;
		const chosen = await uniqueDestination(target, contents, dryRun);
		if (chosen === null) {
			counts.skipped += 1;
			continue;
		}
		if (!dryRun) {
			await mkdir(path.dirname(chosen), { recursive: true });
			if (contents !== undefined) await writeFile(chosen, contents, "utf8");
			else await copyFile(file.filePath, chosen);
		}
		counts[file.kind] += 1;
		console.log(`${dryRun ? "would import" : "imported"} ${file.relativePath} -> ${relativeDestination}`);
	}
	console.log(`\n${dryRun ? "Dry run" : "Migration"} complete: ${JSON.stringify(counts)}${os.EOL}`);
}

void main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
