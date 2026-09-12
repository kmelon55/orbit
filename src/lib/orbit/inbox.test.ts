import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { itemsInSpace } from "./para";
import {
	createOrbitItem,
	fileOrbitItem,
	getOrbitSnapshot,
	toggleOrbitTask,
} from "./store";

test("undo restores only the original location, preserves later edits, and rejects a stale destination", async () => {
	const previous = process.env.ORBIT_VAULT_DIR;
	const vault = await mkdtemp(path.join(os.tmpdir(), "orbit-undo-move-"));
	process.env.ORBIT_VAULT_DIR = vault;
	try {
		const note = await createOrbitItem({
			title: "이동 취소",
			body: "original",
			type: "note",
			space: "inbox",
		});
		assert.ok(note);
		const moved = await fileOrbitItem(note.id, {
			space: "project",
			folder: "Parent/Child",
		});
		assert.ok(moved);
		await fileOrbitItem(note.id, {
			space: "project",
			folder: moved.folder,
			body: "edited after moving",
		});
		const restored = await fileOrbitItem(note.id, {
			space: note.space,
			project: null,
			expectedLocation: { space: "project", folder: moved.folder },
		});
		assert.equal(restored?.body, "edited after moving");
		assert.equal(restored?.space, "inbox");
		assert.equal(restored?.project, undefined);
		assert.equal(restored?.id, note.id);
		const changed = await fileOrbitItem(note.id, {
			space: "area",
			folder: "Changed",
		});
		await assert.rejects(
			fileOrbitItem(note.id, {
				space: "inbox",
				expectedLocation: { space: "project", folder: moved.folder },
			}),
			/위치가 이후 변경/,
		);
		assert.equal(
			(await getOrbitSnapshot()).items.find((item) => item.id === note.id)
				?.folder,
			changed?.folder,
		);
	} finally {
		if (previous === undefined) delete process.env.ORBIT_VAULT_DIR;
		else process.env.ORBIT_VAULT_DIR = previous;
		await rm(vault, { recursive: true, force: true });
	}
});

test("confirmed tasks leave Inbox, retain their identity through filing, and can become notes again", async () => {
	const previous = process.env.ORBIT_VAULT_DIR;
	const vault = await mkdtemp(path.join(os.tmpdir(), "orbit-inbox-flow-"));
	process.env.ORBIT_VAULT_DIR = vault;
	try {
		const note = await createOrbitItem({
			title: "반품 접수",
			body: "접수번호와 메모",
			type: "note",
			space: "inbox",
		});
		assert.ok(note);
		// Preserve user-defined frontmatter while converting and moving the file.
		const notePath = path.join(vault, note.path);
		await writeFile(
			notePath,
			(await readFile(notePath, "utf8")).replace(
				/^---\n/,
				"---\ncustomReceipt: receipt-42\n",
			),
		);
		assert.equal((await getOrbitSnapshot()).counts.inbox, 1);
		const task = await fileOrbitItem(note.id, { type: "task", space: "inbox" });
		assert.ok(task);
		assert.equal(task.due, undefined);
		let snapshot = await getOrbitSnapshot();
		assert.equal(snapshot.counts.inbox, 0);
		assert.deepEqual(itemsInSpace(snapshot.items, "inbox"), []);
		assert.ok(
			snapshot.items.some(
				(item) => item.id === note.id && item.type === "task",
			),
		);
		const filed = await fileOrbitItem(note.id, {
			space: "project",
			folder: "Orbit/검색 개선",
		});
		assert.ok(filed);
		assert.equal(filed.id, note.id);
		assert.equal(filed.body, note.body);
		assert.equal(filed.type, "task");
		await toggleOrbitTask(note.id);
		const detached = await fileOrbitItem(note.id, { space: "inbox" });
		assert.ok(detached);
		assert.equal(detached.folder, undefined);
		assert.equal(detached.status, "done");
		assert.match(
			await readFile(path.join(vault, detached.path), "utf8"),
			/customReceipt: receipt-42/,
		);
		snapshot = await getOrbitSnapshot();
		assert.equal(snapshot.counts.inbox, 0);
		assert.equal(
			snapshot.items.filter((item) => item.id === note.id).length,
			1,
		);
		await fileOrbitItem(note.id, { type: "note", space: "inbox" });
		assert.equal((await getOrbitSnapshot()).counts.inbox, 1);
		await fileOrbitItem(note.id, {
			type: "event",
			space: "event",
			start: "2026-09-12",
		});
		snapshot = await getOrbitSnapshot();
		assert.equal(snapshot.counts.inbox, 0);
		assert.equal(
			snapshot.items.find((item) => item.id === note.id)?.type,
			"event",
		);
	} finally {
		if (previous === undefined) delete process.env.ORBIT_VAULT_DIR;
		else process.env.ORBIT_VAULT_DIR = previous;
		await rm(vault, { recursive: true, force: true });
	}
});
