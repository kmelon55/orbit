import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import LZString from "lz-string";
import { orbitFolderColorSchema } from "./schema";
import {
	archiveOrbitItem,
	createOrbitCanvas,
	createOrbitFolder,
	createOrbitItem,
	deleteOrbitFolder,
	fileOrbitItem,
	getOrbitCanvas,
	getOrbitSnapshot,
	renameOrbitCanvas,
	saveOrbitCanvas,
	toggleOrbitTask,
	updateOrbitFolder,
	updateOrbitNote,
} from "./store";

test("item colors persist across edits, rescheduling, moves, and reset", async () => {
	const previousVault = process.env.ORBIT_VAULT_DIR;
	const vault = await mkdtemp(path.join(os.tmpdir(), "orbit-item-colors-"));
	process.env.ORBIT_VAULT_DIR = vault;
	try {
		for (const type of ["task", "event"] as const) {
			for (const color of orbitFolderColorSchema.options) {
				const item = await createOrbitItem({
					title: `${type} ${color}`,
					body: "색상 보존",
					type,
					space: type === "event" ? "event" : "inbox",
					color,
				});
				assert.ok(item);
				assert.equal(item.color, color);
				assert.match(
					await readFile(path.join(vault, item.path), "utf8"),
					new RegExp(`color: ${color}`),
				);
				const edited = await updateOrbitNote(item.id, {
					title: item.title,
					body: "내용 수정",
					tags: [],
				});
				assert.equal(edited?.color, color);
				const moved = await fileOrbitItem(item.id, {
					space: type === "task" ? "project" : "event",
					folder: type === "task" ? "색상" : undefined,
					...(type === "task"
						? { due: "2026-09-10" }
						: { start: "2026-09-10T09:00:00", end: "2026-09-10T10:00:00" }),
				});
				assert.equal(moved?.color, color);
				if (type === "task") {
					assert.equal((await toggleOrbitTask(item.id))?.color, color);
				}
				const snapshot = await getOrbitSnapshot();
				assert.equal(
					snapshot.items.find((entry) => entry.id === item.id)?.color,
					color,
				);
				const recolored = await fileOrbitItem(item.id, {
					space: item.space,
					color: color === "white" ? "black" : "white",
				});
				assert.equal(recolored?.color, color === "white" ? "black" : "white");
				const reset = await fileOrbitItem(item.id, {
					space: item.space,
					color: null,
				});
				assert.ok(reset);
				assert.equal(reset.color, undefined);
				assert.doesNotMatch(
					await readFile(path.join(vault, reset.path), "utf8"),
					/^color:/m,
				);
			}
		}
		const legacy = await createOrbitItem({
			title: "기본 색상",
			body: "",
			type: "task",
			space: "inbox",
		});
		assert.ok(legacy);
		assert.equal(legacy.color, undefined);
		const filename = path.join(vault, legacy.path);
		const raw = await readFile(filename, "utf8");
		await writeFile(
			filename,
			raw.replace("---\n", "---\ncolor: unknown-external-color\n"),
		);
		assert.ok(
			(await getOrbitSnapshot()).items.some((item) => item.id === legacy.id),
			"unknown colors must not hide existing notes",
		);
	} finally {
		if (previousVault === undefined) delete process.env.ORBIT_VAULT_DIR;
		else process.env.ORBIT_VAULT_DIR = previousVault;
		await rm(vault, { recursive: true, force: true });
	}
});

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
			{
				space: "archive",
				slug: "출시-준비",
				name: "출시-준비",
				parent: undefined,
				depth: 0,
				color: "lime",
				count: 1,
				descendantCount: 1,
			},
		]);
	} finally {
		if (previousVault === undefined) delete process.env.ORBIT_VAULT_DIR;
		else process.env.ORBIT_VAULT_DIR = previousVault;
		await rm(vault, { recursive: true, force: true });
	}
});

test("PARA folders support arbitrary nesting, colors, renaming, and safe deletion", async () => {
	const previousVault = process.env.ORBIT_VAULT_DIR;
	const vault = await mkdtemp(path.join(os.tmpdir(), "orbit-folders-"));
	process.env.ORBIT_VAULT_DIR = vault;

	try {
		const root = await createOrbitFolder({ space: "project", name: "업무" });
		const child = await createOrbitFolder({
			space: "project",
			name: "출시",
			parent: root.slug,
			color: "blue",
		});
		const grandchild = await createOrbitFolder({
			space: "project",
			name: "한국",
			parent: child.slug,
		});
		const note = await createOrbitItem({
			title: "체크리스트",
			body: "중첩 폴더에 저장된다.",
			type: "note",
			space: "project",
			folder: grandchild.slug,
		});
		assert.equal(note?.folder, "업무/출시/한국");
		assert.match(note?.path ?? "", /^projects\/업무\/출시\/한국\//);

		let snapshot = await getOrbitSnapshot();
		assert.deepEqual(
			snapshot.folders.project.map((folder) => ({
				slug: folder.slug,
				parent: folder.parent,
				depth: folder.depth,
				color: folder.color,
				count: folder.count,
				descendantCount: folder.descendantCount,
			})),
			[
				{
					slug: "업무",
					parent: undefined,
					depth: 0,
					color: "lime",
					count: 0,
					descendantCount: 1,
				},
				{
					slug: "업무/출시",
					parent: "업무",
					depth: 1,
					color: "blue",
					count: 0,
					descendantCount: 1,
				},
				{
					slug: "업무/출시/한국",
					parent: "업무/출시",
					depth: 2,
					color: "lime",
					count: 1,
					descendantCount: 1,
				},
			],
		);

		await updateOrbitFolder({
			space: "project",
			path: root.slug,
			name: "회사",
		});
		snapshot = await getOrbitSnapshot();
		assert.equal(snapshot.items[0]?.folder, "회사/출시/한국");
		assert.equal(
			snapshot.folders.project.find((folder) => folder.slug === "회사/출시")
				?.color,
			"blue",
		);
		await updateOrbitFolder({
			space: "project",
			path: "회사",
			color: "pink",
		});
		snapshot = await getOrbitSnapshot();
		assert.equal(
			snapshot.folders.project.find((folder) => folder.slug === "회사")?.color,
			"pink",
		);
		await assert.rejects(
			deleteOrbitFolder({ space: "project", path: "회사" }),
			/비어 있는 폴더|하위 폴더/,
		);

		const empty = await createOrbitFolder({
			space: "project",
			name: "임시",
		});
		await deleteOrbitFolder({ space: "project", path: empty.slug });
		assert.equal(
			(await getOrbitSnapshot()).folders.project.some(
				(folder) => folder.slug === empty.slug,
			),
			false,
		);
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

		const compressedPath = path.join(
			vault,
			"whiteboards",
			"obsidian.excalidraw.md",
		);
		const compressedDocument = JSON.stringify({
			type: "excalidraw",
			version: 2,
			elements: [{ id: "obsidian-shape" }],
			appState: {},
			files: {},
		});
		await writeFile(
			compressedPath,
			`---\nexcalidraw-plugin: parsed\n---\n\n# Excalidraw Data\n\n## Drawing\n\`\`\`compressed-json\n${LZString.compressToBase64(compressedDocument)}\n\`\`\`\n%%\n`,
		);
		const compressedCanvas = (await getOrbitSnapshot()).canvases.find(
			(canvas) => canvas.path === "whiteboards/obsidian.excalidraw.md",
		);
		assert.equal(compressedCanvas?.elementCount, 1);
		const loadedCompressed = await getOrbitCanvas(
			"whiteboards/obsidian.excalidraw.md",
		);
		assert.equal(JSON.parse(loadedCompressed.document).elements.length, 1);

		await saveOrbitCanvas(
			loadedCompressed.path,
			JSON.stringify({
				type: "excalidraw",
				version: 2,
				elements: [{ id: "saved-obsidian-shape" }],
				appState: {},
				files: {},
			}),
		);
		const savedCompressedMarkdown = await readFile(compressedPath, "utf8");
		assert.ok(savedCompressedMarkdown.includes("# Excalidraw Data"));
		assert.ok(savedCompressedMarkdown.includes("```compressed-json"));
		const savedPayload = savedCompressedMarkdown.match(
			/```compressed-json\s*([\s\S]*?)\s*```/,
		)?.[1];
		assert.ok(savedPayload);
		assert.equal(
			JSON.parse(
				LZString.decompressFromBase64(savedPayload.replace(/[\r\n]/g, "")),
			).elements[0].id,
			"saved-obsidian-shape",
		);
	} finally {
		if (previousVault === undefined) delete process.env.ORBIT_VAULT_DIR;
		else process.env.ORBIT_VAULT_DIR = previousVault;
		await rm(vault, { recursive: true, force: true });
	}
});
