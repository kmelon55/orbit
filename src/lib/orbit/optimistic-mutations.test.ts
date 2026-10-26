import assert from "node:assert/strict";
import test from "node:test";
import { flattenFolderTree, indexFolderTree } from "./folder-tree";
import { OptimisticItems } from "./optimistic-mutations";
import type { OrbitItem, OrbitMutation, OrbitSnapshot } from "./schema";

const note: OrbitItem = {
	id: "note",
	title: "Note",
	body: "Body",
	tags: [],
	type: "note",
	space: "inbox",
	path: "inbox/note.md",
	created: "2026-01-01",
	updated: "2026-01-01",
};
function snapshot(items = [note]): OrbitSnapshot {
	return {
		items,
		canvases: [],
		today: { tasks: [], events: [] },
		folders: { project: [], area: [], resource: [], archive: [] },
		counts: {
			inbox: items.length,
			project: 0,
			area: 0,
			resource: 0,
			archive: 0,
			event: 0,
		},
		vaultPath: "/test",
		generatedAt: "2026-01-01",
		displayDate: { day: "1", month: "1", weekday: "", longLabel: "" },
	};
}

test("filing an inbox note exposes its destination tree before refresh and rolls back on failure", () => {
	const store = new OptimisticItems();
	const source = snapshot();
	const mutation: OrbitMutation = {
		action: "file-item",
		id: note.id,
		input: { space: "project", folder: "work/notes" },
	};
	store.start("move", mutation, source);
	const projected = store.project(source);
	assert.equal(projected.counts.inbox, 0);
	assert.deepEqual(
		flattenFolderTree(
			indexFolderTree(projected.items, projected.folders.project),
			new Set(),
			"",
		).map((row) => row.key),
		["folder:work", "folder:work/notes", "item:note"],
	);
	assert.deepEqual(
		projected.folders.project.map(({ count, descendantCount }) => [
			count,
			descendantCount,
		]),
		[
			[0, 1],
			[1, 1],
		],
	);
	store.reconcile(source);
	assert.equal(store.project(source).folders.project.length, 2);
	store.finish({ requestId: "move", mutation, phase: "failure" });
	assert.equal(store.project(source), source);
	assert.equal(source.items[0], note);
	assert.deepEqual(source.folders.project, []);

	store.start("retry", mutation, source);
	const saved = { ...projected.items[0], updated: "2026-01-02" };
	store.finish({
		requestId: "retry",
		mutation,
		phase: "success",
		result: saved,
	});
	store.reconcile(source);
	assert.equal(store.project(source).folders.project[1].count, 1);
	const refreshed = { ...projected, items: [saved] };
	store.reconcile(refreshed);
	assert.equal(store.project(refreshed), refreshed);
});

test("moving between folders updates both counts while preserving empty folders and metadata", () => {
	const original = {
		...note,
		space: "project" as const,
		folder: "old",
		path: "projects/old/note.md",
	};
	const source = snapshot([original]);
	source.folders.project = [
		{
			space: "project",
			slug: "old",
			name: "Old",
			depth: 0,
			color: "blue",
			count: 1,
			descendantCount: 1,
		},
	];
	source.folders.area = [
		{
			space: "area",
			slug: "new",
			name: "New",
			depth: 0,
			color: "pink",
			count: 0,
			descendantCount: 0,
		},
	];
	const store = new OptimisticItems();
	const mutation: OrbitMutation = {
		action: "file-item",
		id: note.id,
		input: { space: "area", folder: "new" },
	};
	store.start("move", mutation, source);
	const projected = store.project(source);
	assert.deepEqual(projected.folders.project, [
		{ ...source.folders.project[0], count: 0, descendantCount: 0 },
	]);
	assert.deepEqual(projected.folders.area, [
		{ ...source.folders.area[0], count: 1, descendantCount: 1 },
	]);
	store.finish({ requestId: "move", mutation, phase: "failure" });
	assert.equal(store.project(source), source);
});
test("delete is immediate, stale refresh cannot resurrect it, failure restores only that item", () => {
	const store = new OptimisticItems();
	const source = snapshot();
	const mutation: OrbitMutation = { action: "delete-item", id: note.id };
	store.start("delete", mutation, source);
	assert.equal(store.project(source).items.length, 0);
	assert.equal(store.project(source).counts.inbox, 0);
	store.reconcile(source);
	assert.equal(store.project(source).items.length, 0);
	store.finish({ requestId: "delete", mutation, phase: "failure" });
	assert.equal(store.project(source).items[0], note);
	store.start("delete2", mutation, source);
	store.finish({ requestId: "delete2", mutation, phase: "success" });
	assert.equal(store.project(source).items.length, 0);
	store.restore(note.id, note);
	assert.equal(store.project(source).items[0], note);
});
test("delete response containing the removed item never restores it across refreshes", () => {
	const store = new OptimisticItems();
	const other = { ...note, id: "other", updated: "2026-01-02" };
	const source = snapshot([other, note]);
	const mutation: OrbitMutation = { action: "delete-item", id: note.id };
	store.start("delete", mutation, source);
	store.finish({
		requestId: "delete",
		mutation,
		phase: "success",
		result: note,
	});
	store.reconcile(source);
	assert.deepEqual(store.project(source).items, [other]);
	assert.equal(store.project(source).counts.inbox, 1);
	const refreshed = snapshot([other]);
	store.reconcile(refreshed);
	assert.deepEqual(store.project(refreshed).items, [other]);
	store.restore(note.id, note);
	assert.deepEqual(store.project(refreshed).items, [other, note]);
});

test("queued edits keep the latest pending value and roll back to the preceding success", () => {
	const store = new OptimisticItems();
	const source = snapshot();
	const first: OrbitMutation = {
		action: "update-note",
		id: note.id,
		input: { title: "First", body: "One", tags: [] },
	};
	const second: OrbitMutation = {
		action: "update-note",
		id: note.id,
		input: { title: "Second", body: "Two", tags: [] },
	};
	store.start("one", first, source);
	store.start("two", second, source);
	const saved = { ...note, ...first.input, updated: "2026-01-02" };
	store.finish({
		requestId: "one",
		mutation: first,
		phase: "success",
		result: saved,
	});
	assert.equal(store.project(source).items[0].title, "Second");
	store.finish({ requestId: "two", mutation: second, phase: "failure" });
	assert.equal(store.project(source).items[0].title, "First");
	store.reconcile(snapshot([saved]));
	assert.equal(store.project(snapshot([saved])).items[0], saved);
});
test("completion does not invert again when a refresh sees the saved result before the response", () => {
	const task: OrbitItem = { ...note, type: "task", status: "open" };
	const store = new OptimisticItems();
	const mutation: OrbitMutation = { action: "toggle-task", id: task.id };
	store.start("toggle", mutation, snapshot([task]));
	assert.equal(store.project(snapshot([task])).items[0].status, "done");
	assert.equal(
		store.project(snapshot([{ ...task, status: "done" }])).items[0].status,
		"done",
	);
});
test("calendar creation appears before the request settles and reconciles to one saved item", () => {
	const store = new OptimisticItems();
	const source = snapshot([]);
	const mutation: OrbitMutation = {
		action: "create-item",
		input: {
			title: "Event",
			type: "event",
			body: "",
			space: "event",
			start: "2026-09-25T09:00:00",
		},
	};
	store.start("event", mutation, source);
	assert.equal(store.project(source).items[0].id, "orbit-pending:event");
	const saved: OrbitItem = {
		...note,
		...mutation.input,
		category: mutation.input.category ?? undefined,
		id: "saved-event",
	};
	store.finish({
		requestId: "event",
		mutation,
		phase: "success",
		result: saved,
	});
	assert.deepEqual(
		store.project(source).items.map((item) => item.id),
		[saved.id],
	);
	store.start("failed-event", mutation, source);
	store.finish({ requestId: "failed-event", mutation, phase: "failure" });
	assert.deepEqual(
		store.project(source).items.map((item) => item.id),
		[saved.id],
	);
});

test("undo immediately shows restored content even when its timestamp is older", () => {
	const store = new OptimisticItems();
	const newer = { ...note, body: "New edit", updated: "2026-01-02" };
	const source = snapshot([newer]);
	store.restore(note.id, note);
	store.reconcile(source);
	assert.equal(store.project(source).items[0].body, note.body);
	const restored = snapshot([note]);
	store.reconcile(restored);
	assert.equal(store.project(restored), restored);
});
test("folder create, nested rename, and rollback preserve child notes and source snapshot", () => {
	const store = new OptimisticItems();
	const source = snapshot([
		{
			...note,
			space: "project",
			folder: "old/child",
			path: "projects/old/child/note.md",
		},
	]);
	source.folders.project = [
		{
			space: "project",
			slug: "old",
			name: "old",
			depth: 0,
			color: "lime",
			count: 0,
			descendantCount: 1,
		},
		{
			space: "project",
			slug: "old/child",
			name: "child",
			parent: "old",
			depth: 1,
			color: "blue",
			count: 1,
			descendantCount: 1,
		},
	];
	const rename: OrbitMutation = {
		action: "update-folder",
		input: { space: "project", path: "old", name: "새 이름" },
	};
	store.start("rename", rename, source);
	assert.equal(store.project(source).items[0].folder, "새-이름/child");
	assert.equal(store.project(source).folders.project[1].parent, "새-이름");
	assert.equal(source.items[0].folder, "old/child");
	store.finish({ requestId: "rename", mutation: rename, phase: "failure" });
	assert.equal(store.project(source).items[0].folder, "old/child");
	const create: OrbitMutation = {
		action: "create-folder",
		input: { space: "project", name: "New", parent: "old" },
	};
	store.start("create", create, source);
	assert.ok(
		store
			.project(source)
			.folders.project.some((folder) => folder.slug === "old/new"),
	);
	store.finish({ requestId: "create", mutation: create, phase: "success" });
	const refreshed = store.project(source);
	store.reconcile(refreshed);
	assert.equal(store.project(refreshed).folders.project.length, 3);
});
