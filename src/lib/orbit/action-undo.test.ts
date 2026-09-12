import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { FileItemInput, OrbitMutation } from "./schema";
import {
	createOrbitItem,
	deleteOrbitItem,
	fileOrbitItem,
	getOrbitItem,
	toggleOrbitTask,
	undoOrbitMutation,
	updateOrbitNote,
	withItemUndo,
} from "./store";

test("item actions share safe, field-specific undo", async (t) => {
	const previous = process.env.ORBIT_VAULT_DIR;
	const vault = await mkdtemp(path.join(os.tmpdir(), "orbit-action-undo-"));
	process.env.ORBIT_VAULT_DIR = vault;
	const file = (id: string, input: FileItemInput) =>
		withItemUndo({ action: "file-item", id, input }, () =>
			fileOrbitItem(id, input),
		);
	try {
		await t.test(
			"completion restores in-progress and keeps later note edits",
			async () => {
				const task = await createOrbitItem({
					title: "Complete",
					type: "task",
					space: "inbox",
					body: "before",
				});
				assert.ok(task);
				await fileOrbitItem(task.id, { space: "inbox", status: "in_progress" });
				const action = await withItemUndo(
					{ action: "toggle-task", id: task.id },
					() => toggleOrbitTask(task.id),
				);
				assert.ok(action.undo);
				await updateOrbitNote(task.id, {
					title: "Edited",
					body: "after",
					tags: ["kept"],
				});
				const restored = await undoOrbitMutation(action.undo.id);
				assert.equal(restored.item?.status, "in_progress");
				assert.equal(restored.item?.title, "Edited");
				assert.equal(restored.item?.body, "after");
				await assert.rejects(undoOrbitMutation(action.undo.id), /기록/);
			},
		);
		await t.test(
			"note/task/event conversions undo in reverse with dates and unknown metadata intact",
			async () => {
				const note = await createOrbitItem({
					title: "Convert",
					type: "note",
					space: "project",
					folder: "Project",
					body: "memo",
				});
				assert.ok(note);
				const p = path.join(vault, note.path);
				await writeFile(
					p,
					(await readFile(p, "utf8")).replace(
						/^---\n/,
						"---\ncustom: preserved\n",
					),
				);
				const task = await file(note.id, {
					space: note.space,
					folder: note.folder,
					type: "task",
					due: "2026-09-14",
				});
				assert.ok(task.undo);
				const event = await file(note.id, {
					space: "event",
					type: "event",
					due: null,
					start: "2026-09-15T10:00",
					end: "2026-09-15T11:00",
				});
				assert.ok(event.undo);
				assert.equal(
					(await undoOrbitMutation(event.undo.id)).item?.due,
					"2026-09-14",
				);
				const restored = (await undoOrbitMutation(task.undo.id)).item;
				assert.ok(restored);
				assert.equal(restored.type, "note");
				assert.equal(restored.status, undefined);
				assert.equal(restored.due, undefined);
				assert.equal(restored.start, undefined);
				assert.equal(restored.path, note.path);
				assert.match(
					await readFile(path.join(vault, restored.path), "utf8"),
					/custom: preserved/,
				);
			},
		);
		await t.test(
			"date and color undo preserve independent changes and reject conflicting edits",
			async () => {
				const task = await createOrbitItem({
					title: "Date",
					type: "task",
					space: "inbox",
					body: "",
				});
				assert.ok(task);
				const date = await file(task.id, { space: "inbox", due: "2026-09-14" });
				assert.ok(date.undo);
				const color = await file(task.id, { space: "inbox", color: "blue" });
				assert.ok(color.undo);
				await undoOrbitMutation(date.undo.id);
				assert.equal((await getOrbitItem(task.id))?.color, "blue");
				assert.equal((await getOrbitItem(task.id))?.due, undefined);
				await fileOrbitItem(task.id, { space: "inbox", color: "red" });
				await assert.rejects(undoOrbitMutation(color.undo.id), /이후 변경/);
				assert.equal((await getOrbitItem(task.id))?.color, "red");
				await fileOrbitItem(task.id, { space: "inbox", color: "blue" });
				assert.equal(
					(await undoOrbitMutation(color.undo.id)).item?.color,
					undefined,
				);
			},
		);
		await t.test(
			"deletion restores the original file without overwriting path collisions",
			async () => {
				const note = await createOrbitItem({
					title: "Delete",
					type: "note",
					space: "area",
					folder: "Home",
					body: "full body",
				});
				assert.ok(note);
				const p = path.join(vault, note.path);
				const original = await readFile(p, "utf8");
				const action = await withItemUndo(
					{ action: "delete-item", id: note.id },
					() => deleteOrbitItem(note.id),
				);
				assert.ok(action.undo);
				await writeFile(p, "another file");
				await assert.rejects(undoOrbitMutation(action.undo.id), /EEXIST/);
				assert.equal(await readFile(p, "utf8"), "another file");
				await rm(p);
				await undoOrbitMutation(action.undo.id);
				assert.equal(await readFile(p, "utf8"), original);
			},
		);
		await t.test(
			"creation undo is safe and autosaves do not create receipts",
			async () => {
				const input = {
					title: "Create",
					type: "note" as const,
					space: "inbox" as const,
					body: "",
				};
				const action = await withItemUndo(
					{ action: "create-item", input },
					() => createOrbitItem(input),
				);
				assert.ok(action.undo);
				assert.ok(action.result);
				const data: OrbitMutation = {
					action: "update-note",
					id: action.result.id,
					input: { title: "Create", body: "written later", tags: [] },
				};
				const saved = await withItemUndo(data, () =>
					updateOrbitNote(data.id, data.input),
				);
				assert.equal(saved.undo, null);
				await assert.rejects(undoOrbitMutation(action.undo.id), /이후 변경/);
				await updateOrbitNote(data.id, { title: "Create", body: "", tags: [] });
				assert.equal((await undoOrbitMutation(action.undo.id)).item, null);
			},
		);
		await t.test(
			"consecutive completion requests each capture the actual prior state",
			async () => {
				const task = await createOrbitItem({
					title: "Serial",
					type: "task",
					space: "inbox",
					body: "",
				});
				assert.ok(task);
				const toggle = () =>
					withItemUndo({ action: "toggle-task", id: task.id }, () =>
						toggleOrbitTask(task.id),
					);
				const [a, b] = await Promise.all([toggle(), toggle()]);
				assert.ok(a.undo);
				assert.ok(b.undo);
				assert.equal((await undoOrbitMutation(b.undo.id)).item?.status, "done");
				assert.equal((await undoOrbitMutation(a.undo.id)).item?.status, "open");
			},
		);
	} finally {
		if (previous === undefined) delete process.env.ORBIT_VAULT_DIR;
		else process.env.ORBIT_VAULT_DIR = previous;
		await rm(vault, { recursive: true, force: true });
	}
});
