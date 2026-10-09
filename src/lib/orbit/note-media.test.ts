import assert from "node:assert/strict";
import {
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { createOrbitSessionToken, getOrbitAuthConfig } from "./auth.server";
import { closeOrbitDatabases, databaseFor } from "./database";
import { MAX_NOTE_IMAGE_BYTES, MAX_NOTE_VIDEO_BYTES } from "./note-media";
import { getNoteMedia, saveNoteMedia } from "./note-media.server";
import { handleNoteMediaRequest } from "./note-media-http.server";
import {
	backupOrbitDirectory,
	exportOrbitDirectory,
	importOrbitDirectory,
} from "./storage-transfer";
import { createOrbitItem, getOrbitItem } from "./store";

const png = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT1cAAAAASUVORK5CYII=",
	"base64",
);
const origin = "http://localhost:3000";
let directory: string;
let previous: NodeJS.ProcessEnv;
let cookie: string;
beforeEach(() => {
	previous = { ...process.env };
	directory = mkdtempSync(path.join(tmpdir(), "orbit-note-images-"));
	process.env.ORBIT_VAULT_DIR = path.join(directory, "vault");
	process.env.ORBIT_AUTH_USERNAME = "image-test";
	process.env.ORBIT_AUTH_PASSWORD = "image-test-password";
	const config = getOrbitAuthConfig();
	assert.equal(config.enabled, true);
	if (config.enabled)
		cookie = `orbit_session=${createOrbitSessionToken(config)}`;
});
afterEach(() => {
	closeOrbitDatabases();
	process.env = previous;
	rmSync(directory, { recursive: true, force: true });
});
function upload(bytes = png, extraHeaders: Record<string, string> = {}) {
	return handleNoteMediaRequest(
		new Request(`${origin}/api/orbit/media`, {
			method: "POST",
			headers: { origin, cookie, "Content-Type": "image/png", ...extraHeaders },
			body: new Uint8Array(bytes),
		}),
	);
}
function load(url: string, session = cookie) {
	return handleNoteMediaRequest(
		new Request(new URL(url, origin), { headers: { cookie: session } }),
	);
}

test("uploaded image and note survive database restart, backup, and export/import", async () => {
	const response = await upload();
	assert.equal(response.status, 201);
	const { url } = await response.json();
	assert.equal(url.startsWith("/api/orbit/media?path="), true);
	const body = `![pasted image](${url})`;
	const note = await createOrbitItem({
		title: "Image persistence",
		type: "note",
		space: "inbox",
		body,
	});
	assert.ok(note);
	closeOrbitDatabases();
	assert.equal((await getOrbitItem(note.id))?.body, body);
	let image = await load(url);
	assert.equal(image.status, 200);
	assert.equal(image.headers.get("content-type"), "image/png");
	assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
	const exported = path.join(directory, "export");
	const backup = path.join(directory, "backup");
	await exportOrbitDirectory(exported);
	await backupOrbitDirectory(backup);
	const asset = databaseFor().assets()[0];
	assert.deepEqual(readFileSync(path.join(exported, asset.path)), png);
	assert.deepEqual(readFileSync(path.join(backup, asset.source)), png);
	closeOrbitDatabases();
	process.env.ORBIT_VAULT_DIR = path.join(directory, "restored");
	await importOrbitDirectory(exported);
	assert.equal((await getOrbitItem(note.id))?.body, body);
	image = await load(url);
	assert.equal(image.status, 200);
	assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
});

test("image reads and writes require the session and reject cross-origin requests", async () => {
	assert.equal((await upload(png, { cookie: "" })).status, 401);
	assert.equal(
		(await upload(png, { origin: "https://untrusted.example" })).status,
		403,
	);
	assert.equal(
		(await upload(png, { "sec-fetch-site": "cross-site" })).status,
		403,
	);
	const { url } = await (await upload()).json();
	assert.equal((await load(url, "")).status, 401);
	assert.equal(
		(await load("/api/orbit/media?path=../../.orbit/auth.json")).status,
		404,
	);
	assert.equal((await load("/api/orbit/media?path=missing.png")).status, 404);
});

test("rejects disguised SVG/HTML and oversized requests without recording assets", async () => {
	assert.equal(
		(await upload(Buffer.from('<svg onload="alert(1)"/>'))).status,
		415,
	);
	assert.equal(
		(await upload(png, { "content-length": String(MAX_NOTE_VIDEO_BYTES + 1) }))
			.status,
		413,
	);
	assert.equal(
		(await upload(Buffer.concat([png, Buffer.alloc(MAX_NOTE_IMAGE_BYTES)])))
			.status,
		413,
	);
	assert.equal(databaseFor().assets().length, 0);
});

test("does not serve registered assets whose source escapes the vault", async () => {
	const { url } = await saveNoteMedia(new Blob([new Uint8Array(png)]).stream());
	const asset = databaseFor().assets()[0];
	const full = path.join(databaseFor().root, asset.source);
	writeFileSync(path.join(directory, "outside.png"), png);
	rmSync(full);
	symlinkSync(path.join(directory, "outside.png"), full);
	await assert.rejects(
		getNoteMedia(new URL(url, origin).searchParams.get("path") ?? ""),
		/escapes the data directory/,
	);
});

test("concurrent identical uploads share one stored asset and one URL", async () => {
	const responses = await Promise.all([upload(), upload(), upload()]);
	const media = await Promise.all(responses.map((response) => response.json()));
	assert.equal(new Set(media.map((value) => value.url)).size, 1);
	assert.equal(databaseFor().assets().length, 1);
});

test("video bytes remain unchanged and authenticated byte ranges support playback and seeking", async () => {
	const video = Buffer.alloc(4096);
	video.writeUInt32BE(24, 0);
	video.write("ftypmp42", 4, "ascii");
	for (let i = 24; i < video.length; i++) video[i] = i % 251;
	const response = await upload(video, { "Content-Type": "video/mp4" });
	assert.equal(response.status, 201);
	const { url, mime } = await response.json();
	assert.equal(mime, "video/mp4");
	assert.deepEqual(Buffer.from(await (await load(url)).arrayBuffer()), video);
	for (const [range, start, end] of [
		["bytes=0-99", 0, 99],
		["bytes=4000-", 4000, 4095],
		["bytes=-16", 4080, 4095],
	] as const) {
		const part = await handleNoteMediaRequest(
			new Request(new URL(url, origin), { headers: { cookie, range } }),
		);
		assert.equal(part.status, 206);
		assert.equal(
			part.headers.get("content-range"),
			`bytes ${start}-${end}/${video.length}`,
		);
		assert.deepEqual(
			Buffer.from(await part.arrayBuffer()),
			video.subarray(start, end + 1),
		);
	}
	for (const range of [
		"bytes=9999-",
		"bytes=-0",
		"bytes=2-1",
		"bytes=0-1,3-4",
	]) {
		const result = await handleNoteMediaRequest(
			new Request(new URL(url, origin), { headers: { cookie, range } }),
		);
		assert.equal(result.status, 416);
	}
	const head = await handleNoteMediaRequest(
		new Request(new URL(url, origin), { method: "HEAD", headers: { cookie } }),
	);
	assert.equal(head.headers.get("content-length"), String(video.length));
	assert.equal((await head.arrayBuffer()).byteLength, 0);
	closeOrbitDatabases();
	assert.deepEqual(Buffer.from(await (await load(url)).arrayBuffer()), video);
});

test("interrupted uploads leave no asset record", async () => {
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(png);
			controller.error(new Error("disconnected"));
		},
	});
	await assert.rejects(saveNoteMedia(stream), /disconnected/);
	assert.equal(databaseFor().assets().length, 0);
});
