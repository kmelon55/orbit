import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
	archiveOrbitItem,
	createOrbitCanvas,
	createOrbitItem,
	fileOrbitItem,
	getOrbitCanvas,
	getOrbitSnapshot,
	renameOrbitCanvas,
	saveOrbitCanvas,
} from "./store";

test("archived notes keep their folder in the unified folder browser", async () => {
	const previousVault = process.env.ORBIT_VAULT_DIR;
	const vault = await mkdtemp(path.join(os.tmpdir(), "orbit-archive-"));
	process.env.ORBIT_VAULT_DIR = vault;

	try {
		const note = await createOrbitItem({
			title: "완료한 프로젝트 메모",
			body: "보관 뒤에도 폴더를 유지한다.",
			type: "note",
			space: "project",
			folder: "출시 준비",
		});
		assert.ok(note);

		const archived = await archiveOrbitItem(note.id);
		assert.ok(archived);
		assert.equal(archived.space, "archive");
		assert.equal(archived.folder, "출시-준비");
		assert.match(archived.path, /^archive\/출시-준비\//);

		const snapshot = await getOrbitSnapshot();
		assert.deepEqual(snapshot.folders.archive, [
			{ space: "archive", slug: "출시-준비", count: 1 },
		]);
	} finally {
		if (previousVault === undefined) delete process.env.ORBIT_VAULT_DIR;
		else process.env.ORBIT_VAULT_DIR = previousVault;
		await rm(vault, { recursive: true, force: true });
	}
});

test("notes can be converted to tasks and events without losing content", async () => {
	const previousVault = process.env.ORBIT_VAULT_DIR;
	const vault = await mkdtemp(path.join(os.tmpdir(), "orbit-store-"));
	process.env.ORBIT_VAULT_DIR = vault;

	try {
		const taskNote = await createOrbitItem({
			title: "정리할 메모",
			body: "본문은 그대로 남아야 한다.",
			type: "note",
			space: "inbox",
		});
		assert.ok(taskNote);
		const task = await fileOrbitItem(taskNote.id, {
			type: "task",
			space: "inbox",
			due: "2026-08-30T09:30:00",
		});
		assert.ok(task);

		assert.equal(task.type, "task");
		assert.equal(task.space, "inbox");
		assert.equal(task.status, "open");
		assert.equal(task.due, "2026-08-30T09:30:00");
		assert.equal(task.body, "본문은 그대로 남아야 한다.");

		const eventNote = await createOrbitItem({
			title: "일정으로 만들 메모",
			body: "장소와 준비물",
			type: "note",
			space: "inbox",
		});
		assert.ok(eventNote);
		const event = await fileOrbitItem(eventNote.id, {
			type: "event",
			space: "event",
			start: "2026-08-31T14:00:00",
			end: "2026-08-31T15:00:00",
		});
		assert.ok(event);

		assert.equal(event.type, "event");
		assert.equal(event.space, "event");
		assert.equal(event.start, "2026-08-31T14:00:00");
		assert.equal(event.end, "2026-08-31T15:00:00");
		assert.equal(event.body, "장소와 준비물");

		const noteAgain = await fileOrbitItem(event.id, {
			type: "note",
			space: "inbox",
			start: null,
			end: null,
			due: null,
		});
		assert.ok(noteAgain);
		assert.equal(noteAgain.type, "note");
		assert.equal(noteAgain.start, undefined);
		assert.equal(noteAgain.end, undefined);
		assert.equal(noteAgain.due, undefined);
		assert.equal(noteAgain.body, "장소와 준비물");
	} finally {
		if (previousVault === undefined) delete process.env.ORBIT_VAULT_DIR;
		else process.env.ORBIT_VAULT_DIR = previousVault;
		await rm(vault, { recursive: true, force: true });
	}
});

test("Excalidraw files are listed and saved without changing their path", async () => {
	const previousVault = process.env.ORBIT_VAULT_DIR;
	const vault = await mkdtemp(path.join(os.tmpdir(), "orbit-canvas-"));
	process.env.ORBIT_VAULT_DIR = vault;

	try {
		await mkdir(path.join(vault, "whiteboards"), { recursive: true });
		const filePath = path.join(vault, "whiteboards", "idea.excalidraw");
		await writeFile(
			filePath,
			JSON.stringify({
				type: "excalidraw",
				version: 2,
				elements: [],
				appState: {},
				files: {},
			}),
		);

		const snapshot = await getOrbitSnapshot();
		assert.equal(snapshot.canvases[0]?.path, "whiteboards/idea.excalidraw");
		assert.equal(snapshot.canvases[0]?.elementCount, 0);

		const loaded = await getOrbitCanvas("whiteboards/idea.excalidraw");
		const nextDocument = JSON.stringify({
			type: "excalidraw",
			version: 2,
			elements: [{ id: "shape" }],
			appState: {},
			files: {},
		});
		assert.ok(loaded.document.includes("excalidraw"));
		await saveOrbitCanvas(loaded.path, nextDocument);
		assert.equal(
			JSON.parse(await readFile(filePath, "utf8")).elements.length,
			1,
		);

		const created = await createOrbitCanvas("새 보드");
		assert.equal(created.canvas.format, "excalidraw");
		assert.equal(created.canvas.elementCount, 0);
		assert.equal(created.canvas.title, "새 보드");

		const notePath = path.join(vault, "inbox", "canvas-note.md");
		await writeFile(
			notePath,
			`---\nid: canvas-note\ntitle: Canvas note\ntype: note\nspace: inbox\ncreated: 2026-08-31T00:00:00.000Z\nupdated: 2026-08-31T00:00:00.000Z\n---\n\n[Whiteboard · idea](#/canvas/whiteboards%2Fidea.excalidraw)\n`,
		);
		const renamed = await renameOrbitCanvas(
			"whiteboards/idea.excalidraw",
			"새 이름",
		);
		assert.equal(renamed.canvas.title, "새 이름");
		assert.equal(renamed.canvas.path, "whiteboards/idea.excalidraw");
		assert.equal(renamed.updatedNotes, 1);
		assert.equal(
			JSON.parse((await getOrbitCanvas(renamed.canvas.path)).document).elements
				.length,
			1,
		);
		assert.ok(
			(await readFile(notePath, "utf8")).includes(
				`[Whiteboard · 새 이름](#/canvas/${encodeURIComponent(renamed.canvas.path)})`,
			),
		);
		assert.equal(
			JSON.parse((await getOrbitCanvas("whiteboards/idea.excalidraw")).document)
				.orbitTitle,
			"새 이름",
		);
		await saveOrbitCanvas(
			renamed.canvas.path,
			JSON.stringify({
				type: "excalidraw",
				version: 2,
				elements: [{ id: "shape-after-rename" }],
				appState: {},
				files: {},
			}),
		);
		assert.equal(
			(await getOrbitSnapshot()).canvases.find(
				(canvas) => canvas.path === renamed.canvas.path,
			)?.title,
			"새 이름",
		);
	} finally {
		if (previousVault === undefined) delete process.env.ORBIT_VAULT_DIR;
		else process.env.ORBIT_VAULT_DIR = previousVault;
		await rm(vault, { recursive: true, force: true });
	}
});
