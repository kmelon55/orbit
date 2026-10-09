import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, realpathSync, renameSync, statSync } from "node:fs";
import { open, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	type AssetRecord,
	databaseFor,
	hashFile,
	sha256,
	verifiedAssetPath,
	withDatabase,
} from "./database";
import {
	MAX_NOTE_IMAGE_BYTES,
	MAX_NOTE_VIDEO_BYTES,
	NOTE_MEDIA_ENDPOINT,
} from "./note-media";
import { optimizePng } from "./optimize-png.server";

export class NoteMediaError extends Error {
	constructor(readonly status: number) {
		super("Media request failed");
	}
}

export function noteMediaType(bytes: Buffer) {
	if (
		bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
	)
		return { extension: "png", mime: "image/png" };
	if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
		return { extension: "jpg", mime: "image/jpeg" };
	if (["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6)))
		return { extension: "gif", mime: "image/gif" };
	if (
		bytes.toString("ascii", 0, 4) === "RIFF" &&
		bytes.toString("ascii", 8, 12) === "WEBP"
	)
		return { extension: "webp", mime: "image/webp" };
	if (bytes.toString("ascii", 4, 8) === "ftyp") {
		const brand = bytes.toString("ascii", 8, 12);
		if (["avif", "avis"].includes(brand))
			return { extension: "avif", mime: "image/avif" };
		if (brand === "qt  ") return { extension: "mov", mime: "video/quicktime" };
		if (
			[
				"isom",
				"iso2",
				"iso3",
				"iso4",
				"iso5",
				"iso6",
				"mp41",
				"mp42",
				"avc1",
				"M4V ",
				"MSNV",
			].includes(brand)
		)
			return { extension: "mp4", mime: "video/mp4" };
	}
	if (
		bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) &&
		bytes.subarray(0, 64).includes(Buffer.from("webm"))
	)
		return { extension: "webm", mime: "video/webm" };
	return null;
}

/** Stream uploads to disk, then register an immutable, deduplicated attachment. */
export async function saveNoteMedia(stream: ReadableStream<Uint8Array>) {
	const root = await withDatabase(() => databaseFor().root);
	const directory = path.join(root, ".orbit", "note-media");
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	if (!realpathSync(directory).startsWith(`${realpathSync(root)}${path.sep}`))
		throw new Error("Media directory escapes the vault");
	const temporary = path.join(directory, `${randomUUID()}.upload`);
	const file = await open(temporary, "wx", 0o600);
	const reader = stream.getReader();
	const digest = createHash("sha256");
	let size = 0;
	let prefix: Buffer = Buffer.alloc(0);
	try {
		try {
			while (true) {
				const part = await reader.read();
				if (part.done) break;
				size += part.value.length;
				if (size > MAX_NOTE_VIDEO_BYTES) throw new NoteMediaError(413);
				if (prefix.length < 64)
					prefix = Buffer.concat([
						prefix,
						part.value.subarray(0, 64 - prefix.length),
					]);
				const type = prefix.length >= 64 ? noteMediaType(prefix) : null;
				if (type?.mime.startsWith("image/") && size > MAX_NOTE_IMAGE_BYTES)
					throw new NoteMediaError(413);
				digest.update(part.value);
				await file.writeFile(part.value);
			}
			await file.sync();
		} finally {
			await reader.cancel().catch(() => {});
			reader.releaseLock();
			await file.close();
		}
		const type = noteMediaType(prefix);
		if (!type) throw new NoteMediaError(415);
		if (type.mime.startsWith("image/") && size > MAX_NOTE_IMAGE_BYTES)
			throw new NoteMediaError(413);
		let hash = digest.digest("hex");
		if (type.extension === "png") {
			const original = await readFile(temporary);
			const optimized = await optimizePng(original);
			if (optimized.length < original.length) {
				await writeFile(temporary, optimized, { flush: true });
				hash = sha256(optimized);
			}
		}
		return await withDatabase(() => {
			const database = databaseFor();
			const existing = database.sql
				.prepare("SELECT * FROM assets WHERE hash=? LIMIT 1")
				.get(hash) as AssetRecord | undefined;
			if (existing && hashFile(verifiedAssetPath(database, existing)) === hash)
				return {
					url: `${NOTE_MEDIA_ENDPOINT}?path=${encodeURIComponent(existing.path)}`,
					mime: type.mime,
				};
			const filename = `${randomUUID()}.${type.extension}`;
			const key = `attachments/${filename}`;
			const source = `.orbit/note-media/${filename}`;
			renameSync(temporary, path.join(directory, filename));
			database.sql
				.prepare("INSERT INTO assets (path,source,hash) VALUES (?,?,?)")
				.run(key, source, hash);
			return {
				url: `${NOTE_MEDIA_ENDPOINT}?path=${encodeURIComponent(key)}`,
				mime: type.mime,
			};
		}, true);
	} finally {
		await rm(temporary, { force: true });
	}
}

export function getNoteMedia(key: string) {
	return withDatabase(async () => {
		const database = databaseFor();
		const asset = database.sql
			.prepare("SELECT * FROM assets WHERE path=?")
			.get(key) as AssetRecord | undefined;
		if (!asset) return null;
		const filename = verifiedAssetPath(database, asset);
		const size = statSync(filename).size;
		const file = await open(filename, "r");
		try {
			const prefix = Buffer.alloc(64);
			const { bytesRead } = await file.read(prefix, 0, 64, 0);
			const type = noteMediaType(prefix.subarray(0, bytesRead));
			if (!type) throw new NoteMediaError(415);
			return { filename, size, mime: type.mime };
		} finally {
			await file.close();
		}
	});
}
