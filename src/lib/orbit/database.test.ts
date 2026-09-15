import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import LZString from "lz-string";
import {
	closeOrbitDatabases,
	databaseFor,
	sha256,
	withDatabase,
} from "./database";
import {
	backupOrbitDirectory,
	exportOrbitDirectory,
	importOrbitDirectory,
	storageStatus,
} from "./storage-transfer";
import {
	createOrbitFolder,
	createOrbitItem,
	fileOrbitItem,
	getOrbitCanvas,
	getOrbitItem,
	getOrbitSnapshot,
	saveOrbitCanvas,
	toggleOrbitTask,
	updateOrbitFolder,
	updateOrbitNote,
} from "./store";

function fixture() {
	const previous = process.env.ORBIT_VAULT_DIR;
	const parent = mkdtempSync(path.join(os.tmpdir(), "orbit-sqlite-")),
		root = path.join(parent, "vault");
	mkdirSync(root);
	process.env.ORBIT_VAULT_DIR = root;
	return {
		root,
		parent,
		finish() {
			closeOrbitDatabases();
			if (previous === undefined) delete process.env.ORBIT_VAULT_DIR;
			else process.env.ORBIT_VAULT_DIR = previous;
			rmSync(parent, { recursive: true, force: true });
		},
	};
}
function put(root: string, key: string, value: string | Buffer) {
	const full = path.join(root, key);
	mkdirSync(path.dirname(full), { recursive: true });
	writeFileSync(full, value);
}
const note =
	"---\nid: migrated\ntitle: 한글 노트\ntype: task\nspace: project\nstatus: in_progress\ncolor: violet\ntags: [태그, second]\ndue: 2026-09-17T09:30:00\ncreated: '2024-01-02T03:04:05.000Z'\nupdated: '2025-06-07T08:09:10.000Z'\ncustom:\n  nested: [1, two]\n---\n\n  본문 공백도 보존  \n\n![asset](./photo.png)\n";

test("unchanged canvas autosaves preserve migrated source bytes, dates, and revision", async () => {
	const f = fixture();
	try {
		const document = {
			type: "excalidraw",
			version: 2,
			orbitTitle: "Original title",
			elements: [],
			appState: {},
			files: {},
		};
		const sources = {
			"whiteboards/plain.excalidraw": JSON.stringify(document, null, 2),
			"whiteboards/compressed.excalidraw.md": `---\ncustom: keep\n---\n\n\`\`\`compressed-json\n${LZString.compressToBase64(JSON.stringify(document))}\n\`\`\`\n`,
		};
		for (const [key, raw] of Object.entries(sources)) put(f.root, key, raw);
		await getOrbitSnapshot();
		for (const [key, raw] of Object.entries(sources)) {
			const before = databaseFor()
				.sql.prepare("SELECT * FROM documents WHERE path=?")
				.get(key);
			const loaded = JSON.parse((await getOrbitCanvas(key)).document);
			// Excalidraw omits Orbit's title and may reorder JSON keys on initialization.
			const unchanged = {
				files: loaded.files,
				appState: loaded.appState,
				elements: loaded.elements,
				version: loaded.version,
				type: loaded.type,
			};
			await saveOrbitCanvas(key, JSON.stringify(unchanged));
			assert.deepEqual(
				databaseFor()
					.sql.prepare("SELECT * FROM documents WHERE path=?")
					.get(key),
				before,
			);
			assert.equal(databaseFor().read(key).raw, raw);
			await saveOrbitCanvas(
				key,
				JSON.stringify({ ...unchanged, elements: [{ id: "new-shape" }] }),
			);
			assert.equal(databaseFor().read(key).canvas?.elementCount, 1);
			assert.notEqual(databaseFor().read(key).raw, raw);
		}
	} finally {
		f.finish();
	}
});

test("migration preserves raw bytes, unknown metadata, empty folders, ordering, canvas, and attachments; never rereads legacy files", async () => {
	const f = fixture();
	try {
		put(f.root, "projects/한글 폴더/note.md", note);
		put(f.root, "projects/한글 폴더/photo.png", Buffer.from([0, 1, 2, 255]));
		put(
			f.root,
			"whiteboards/test.excalidraw",
			JSON.stringify({
				elements: [{ id: "one" }],
				files: {},
				orbitTitle: "보드",
			}),
		);
		put(f.root, "inbox/plain.md", "plain body\n");
		put(f.root, "resources/bad.md", "---\ntype: unsupported\n---\nkeep me\n");
		mkdirSync(path.join(f.root, "areas/empty"), { recursive: true });
		const folders = {
			version: 1,
			folders: { project: { "한글 폴더": { color: "violet" } } },
			treeOrder: {
				project: { "": ["folder:한글 폴더"], "한글 폴더": ["item:migrated"] },
			},
		};
		put(f.root, ".orbit/folders.json", JSON.stringify(folders));
		const snapshot = await getOrbitSnapshot(),
			status = await storageStatus();
		assert.equal(snapshot.items.length, 2);
		assert.equal(snapshot.canvases.length, 1);
		assert.equal(snapshot.folders.project[0].color, "violet");
		assert.equal(snapshot.folders.area[0].count, 0);
		assert.deepEqual(snapshot.treeOrder, folders.treeOrder);
		assert.equal(status.migration?.documents, 4);
		assert.equal(status.migration?.assets, 1);
		assert.equal(status.migration?.warnings.length, 1);
		assert.equal(databaseFor().read("projects/한글 폴더/note.md").raw, note);
		for (const [key, hash] of Object.entries(status.migration?.hashes ?? {}))
			assert.equal(sha256(readFileSync(path.join(f.root, key))), hash);
		await updateOrbitNote("migrated", {
			title: "edited",
			body: "new body",
			tags: ["new"],
		});
		assert.match(databaseFor().byId("migrated")?.raw ?? "", /nested:/);
		assert.equal(
			readFileSync(path.join(f.root, "projects/한글 폴더/note.md"), "utf8"),
			note,
		);
		put(
			f.root,
			"projects/한글 폴더/note.md",
			note.replace("한글 노트", "stale disk edit"),
		);
		closeOrbitDatabases();
		assert.equal((await getOrbitItem("migrated"))?.title, "edited");
	} finally {
		f.finish();
	}
});

test("migration gives duplicate IDs deterministic identities without dropping or rewriting either original", async () => {
	const f = fixture();
	try {
		put(f.root, "inbox/a.md", note);
		put(f.root, "inbox/b.md", note);
		const snapshot = await getOrbitSnapshot();
		assert.equal(snapshot.items.length, 2);
		assert.equal(new Set(snapshot.items.map((item) => item.id)).size, 2);
		const report = (await storageStatus()).migration;
		assert.equal(report?.reassignedIds.length, 1);
		for (const key of ["inbox/a.md", "inbox/b.md"])
			assert.equal(databaseFor().read(key).raw, note);
		assert.ok(report);
		const remapped = report.reassignedIds[0];
		await updateOrbitNote(remapped.id, {
			title: "independent",
			body: "second",
			tags: [],
		});
		assert.equal((await getOrbitItem("migrated"))?.title, "한글 노트");
		assert.equal((await getOrbitItem(remapped.id))?.body, "second");
		const output = path.join(f.parent, "export");
		await exportOrbitDirectory(output);
		process.env.ORBIT_VAULT_DIR = output;
		assert.equal((await getOrbitSnapshot()).items.length, 2);
		assert.equal((await getOrbitItem(remapped.id))?.body, "second");
	} finally {
		f.finish();
	}
});

test("invalid folder metadata and symlinks stop migration instead of losing data", async () => {
	const f = fixture();
	try {
		put(f.root, "inbox/a.md", note);
		put(f.root, ".orbit/folders.json", "broken JSON");
		await assert.rejects(getOrbitSnapshot());
		rmSync(path.join(f.root, ".orbit/folders.json"));
		put(f.parent, "outside.md", "private");
		symlinkSync(
			path.join(f.parent, "outside.md"),
			path.join(f.root, "inbox/link.md"),
		);
		await assert.rejects(getOrbitSnapshot(), /symlinks/);
		rmSync(path.join(f.root, "inbox/link.md"));
		assert.equal((await getOrbitSnapshot()).items.length, 1);
	} finally {
		f.finish();
	}
});

test("missing migrated database fails closed rather than resurrecting old Markdown", async () => {
	const f = fixture();
	try {
		put(f.root, "inbox/a.md", note);
		await getOrbitSnapshot();
		closeOrbitDatabases();
		rmSync(path.join(f.root, ".orbit/orbit.sqlite"));
		await assert.rejects(getOrbitSnapshot(), /database is missing/);
	} finally {
		f.finish();
	}
});

test("portable export and reimport preserve all document bytes, timestamps, folders and assets after moves", async () => {
	const f = fixture();
	try {
		put(f.root, "projects/source/note.md", note);
		put(f.root, "projects/source/photo.png", Buffer.from([4, 5, 6]));
		put(f.root, "resources/legacy.md", "idless\n");
		await getOrbitSnapshot();
		await updateOrbitFolder({
			space: "project",
			path: "source",
			name: "renamed",
			color: "cyan",
		});
		const before = await getOrbitSnapshot(),
			output = path.join(f.parent, "export");
		await exportOrbitDirectory(output);
		assert.deepEqual(
			readFileSync(path.join(output, "projects/renamed/photo.png")),
			Buffer.from([4, 5, 6]),
		);
		assert.equal(
			readFileSync(path.join(output, "projects/renamed/note.md"), "utf8"),
			note,
		);
		const fresh = path.join(f.parent, "restored");
		mkdirSync(fresh);
		process.env.ORBIT_VAULT_DIR = fresh;
		await importOrbitDirectory(output);
		const after = await getOrbitSnapshot();
		assert.deepEqual(after.items, before.items);
		assert.deepEqual(after.folders, before.folders);
		assert.deepEqual(await importOrbitDirectory(output), {
			documents: 0,
			assets: 0,
			skipped: 3,
		});
		rmSync(output, { recursive: true });
		assert.equal(
			(await exportOrbitDirectory(path.join(f.parent, "second-export"))).assets,
			1,
		);
	} finally {
		f.finish();
	}
});

test("backup uses a consistent SQLite snapshot and can restore without original Markdown", async () => {
	const f = fixture();
	try {
		put(f.root, "inbox/a.md", note);
		await getOrbitSnapshot();
		await updateOrbitNote("migrated", {
			title: "current",
			body: "database only",
			tags: [],
		});
		const backup = path.join(f.parent, "backup");
		await backupOrbitDirectory(backup);
		process.env.ORBIT_VAULT_DIR = backup;
		assert.equal((await getOrbitItem("migrated"))?.body, "database only");
		assert.equal((await storageStatus()).integrity[0].quick_check, "ok");
	} finally {
		f.finish();
	}
});

test("a failed batch import leaves no partial notes or folders", async () => {
	const f = fixture();
	try {
		put(f.root, "inbox/original.md", note);
		await getOrbitSnapshot();
		const source = path.join(f.parent, "import");
		put(source, "projects/new/a.md", note.replace("id: migrated", "id: new"));
		put(source, "projects/new/z.md", note);
		await assert.rejects(importOrbitDirectory(source), /duplicate note ID/);
		assert.equal((await getOrbitSnapshot()).items.length, 1);
		assert.equal((await getOrbitSnapshot()).folders.project.length, 0);
	} finally {
		f.finish();
	}
});

test("concurrent mutations serialize, failed transactions roll back, and another connection sees committed edits", async () => {
	const f = fixture();
	try {
		const task = await createOrbitItem({
			title: "task",
			body: "",
			type: "task",
			space: "inbox",
		});
		assert.ok(task);
		await Promise.all(
			Array.from({ length: 20 }, () => toggleOrbitTask(task.id)),
		);
		assert.equal((await getOrbitItem(task.id))?.status, "open");
		await assert.rejects(
			withDatabase(async () => {
				await createOrbitFolder({ space: "area", name: "rollback" });
				await fileOrbitItem(task.id, { space: "area", folder: "rollback" });
				throw new Error("injected failure");
			}, true),
		);
		assert.equal((await getOrbitItem(task.id))?.space, "inbox");
		assert.equal((await getOrbitSnapshot()).folders.area.length, 0);
		const other = new DatabaseSync(databaseFor().filename);
		try {
			const row = other
				.prepare("SELECT item FROM documents WHERE id=?")
				.get(task.id) as { item: string };
			assert.equal(JSON.parse(row.item).status, "open");
		} finally {
			other.close();
		}
	} finally {
		f.finish();
	}
});

test("notes without IDs keep identity when a folder moves and after a subsequent edit/export", async () => {
	const f = fixture();
	try {
		put(f.root, "projects/old/plain.md", "# unchanged\n");
		const before = (await getOrbitSnapshot()).items[0];
		await updateOrbitFolder({ space: "project", path: "old", name: "new" });
		assert.equal(
			(await getOrbitItem(before.id))?.path,
			"projects/new/plain.md",
		);
		await updateOrbitNote(before.id, {
			title: "updated",
			body: "changed",
			tags: [],
		});
		assert.equal((await getOrbitItem(before.id))?.body, "changed");
		const output = path.join(f.parent, "export");
		await exportOrbitDirectory(output);
		process.env.ORBIT_VAULT_DIR = output;
		assert.equal((await getOrbitItem(before.id))?.body, "changed");
	} finally {
		f.finish();
	}
});

test("another process invalidates warmed projections and failed transaction caches never leak", async () => {
	const f = fixture();
	try {
		const item = await createOrbitItem({
			title: "before",
			body: "",
			type: "note",
			space: "inbox",
		});
		assert.ok(item);
		await getOrbitSnapshot();
		const moduleUrl = new URL("./store.ts", import.meta.url).href;
		const child = spawnSync(
			process.execPath,
			[
				"--import",
				"tsx",
				"--input-type=module",
				"-e",
				`import {updateOrbitNote} from ${JSON.stringify(moduleUrl)};await updateOrbitNote(${JSON.stringify(item.id)},{title:"other process",body:"new",tags:[]});`,
			],
			{ env: { ...process.env, ORBIT_VAULT_DIR: f.root }, encoding: "utf8" },
		);
		assert.equal(child.status, 0, child.stderr);
		assert.equal((await getOrbitSnapshot()).items[0].title, "other process");
		await assert.rejects(
			withDatabase(async () => {
				await createOrbitItem({
					title: "ghost",
					body: "",
					type: "note",
					space: "inbox",
				});
				await getOrbitSnapshot();
				throw new Error("rollback");
			}, true),
		);
		await createOrbitItem({
			title: "real",
			body: "",
			type: "note",
			space: "inbox",
		});
		const titles = (await getOrbitSnapshot()).items.map((item) => item.title);
		assert.ok(titles.includes("real"));
		assert.ok(!titles.includes("ghost"));
	} finally {
		f.finish();
	}
});

test("export identity sidecar restores unedited duplicate IDs and NFC folder metadata", async () => {
	const f = fixture();
	try {
		put(f.root, "projects/한글/a.md", note);
		put(f.root, "projects/한글/b.md", note);
		put(
			f.root,
			".orbit/folders.json",
			JSON.stringify({
				version: 1,
				folders: { project: { ["한글".normalize("NFD")]: { color: "cyan" } } },
			}),
		);
		const before = await getOrbitSnapshot();
		assert.equal(before.folders.project[0].color, "cyan");
		const exportPath = path.join(f.parent, "export");
		await exportOrbitDirectory(exportPath);
		assert.equal(
			readFileSync(path.join(exportPath, "projects/한글/b.md"), "utf8"),
			note,
		);
		process.env.ORBIT_VAULT_DIR = exportPath;
		const after = await getOrbitSnapshot();
		assert.deepEqual(after.items, before.items);
		assert.deepEqual(after.folders, before.folders);
	} finally {
		f.finish();
	}
});
