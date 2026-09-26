import assert from "node:assert/strict";
import test from "node:test";
import { formatDayKey } from "./para";
import type { OrbitItem, OrbitSnapshot } from "./schema";
import { mergeSnapshotItems, unobservedWrites } from "./snapshot-overlay";

const note: OrbitItem = {
	id: "note",
	title: "Saved",
	body: "New content",
	tags: [],
	type: "note",
	space: "inbox",
	path: "inbox/note.md",
	created: "2026-09-25T00:00:00Z",
	updated: "2026-09-25T01:00:00Z",
};
function snapshot(items: OrbitItem[] = []): OrbitSnapshot {
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
		generatedAt: "2026-09-25T00:00:00Z",
		displayDate: {
			day: "25",
			month: "9",
			weekday: "금",
			longLabel: "2026-09-25",
		},
	};
}

test("acknowledged capture stays visible across stale refreshes and is not duplicated", () => {
	const old = snapshot();
	assert.equal(mergeSnapshotItems(old, [note]).items[0], note);
	assert.equal(mergeSnapshotItems(old, [note]).counts.inbox, 1);
	assert.deepEqual(unobservedWrites(old.items, [note]), [note]);
	const refreshed = snapshot([note]);
	assert.equal(mergeSnapshotItems(refreshed, [note]).items.length, 1);
	assert.deepEqual(unobservedWrites(refreshed.items, [note]), []);
	assert.equal(old.items.length, 0);
});

test("saved edits are available to the next tab without another server request", () => {
	const old = { ...note, body: "Old content", updated: note.created };
	const result = mergeSnapshotItems(snapshot([old]), [note]);
	assert.equal(result.items[0].body, "New content");
	assert.deepEqual(unobservedWrites([old], [note]), [note]);
	const newer = {
		...note,
		body: "Changed on another device",
		updated: "2026-09-25T02:00:00Z",
	};
	assert.equal(mergeSnapshotItems(snapshot([newer]), [note]).items[0], newer);
	assert.deepEqual(unobservedWrites([newer], [note]), []);
});

test("concurrent captures merge independently and fresh task/event results reach Today", () => {
	const day = formatDayKey();
	const task: OrbitItem = {
		...note,
		id: "task",
		type: "task",
		status: "open",
		due: day,
	};
	const event: OrbitItem = {
		...note,
		id: "event",
		type: "event",
		space: "event",
		start: `${day}T09:00:00`,
	};
	const result = mergeSnapshotItems(snapshot([note]), [note, task, event]);
	assert.equal(result.items.length, 3);
	assert.equal(result.counts.inbox, 1);
	assert.equal(result.counts.event, 1);
	assert.deepEqual(result.today.tasks, [task]);
	assert.deepEqual(result.today.events, [event]);
	assert.deepEqual(unobservedWrites([note, event], [note, task, event]), [
		task,
	]);
});

test("no local writes preserves the server snapshot and observed writes do not resurrect deletes", () => {
	const original = snapshot([note]);
	assert.equal(mergeSnapshotItems(original, []), original);
	const remaining = unobservedWrites(original.items, [note]);
	assert.deepEqual(mergeSnapshotItems(snapshot(), remaining).items, []);
});
