import assert from "node:assert/strict";
import test from "node:test";
import { moveItemLocally } from "./item-move";
import { folderOf } from "./para";
import type { OrbitItem } from "./schema";

const note: OrbitItem = {
	id: "note",
	title: "Note",
	body: "Unsaved content",
	tags: ["tag"],
	created: "2026-09-09",
	updated: "2026-09-09",
	space: "project",
	folder: "Old/Nested",
	path: "projects/Old/Nested/note.md",
	type: "note",
};

test("optimistic moves update the path fallback, including nested folder to root", () => {
	const nested = moveItemLocally(note, "project", "New/Nested");
	assert.equal(folderOf(nested), "New/Nested");
	const root = moveItemLocally(nested, "project");
	assert.equal(folderOf(root), undefined);
	assert.equal(root.path, "projects/note.md");
	assert.equal(root.id, note.id);
	assert.equal(root.body, note.body);
	assert.deepEqual(root.tags, note.tags);
	assert.equal(folderOf(note), "Old/Nested", "source snapshot stays unchanged");
});

test("optimistic destinations agree with server event and inbox rules", () => {
	const inbox = moveItemLocally(note, "inbox", "Ignored");
	assert.equal(inbox.folder, undefined);
	assert.equal(inbox.path, "inbox/note.md");
	const event = moveItemLocally(
		{ ...note, type: "event" },
		"project",
		"Ignored",
	);
	assert.equal(event.space, "event");
	assert.equal(event.path, "events/note.md");
	assert.equal(event.folder, undefined);
	const archived = moveItemLocally(event, "archive", "Past");
	assert.equal(archived.path, "archive/Past/note.md");
	assert.equal(archived.space, "archive");
});
