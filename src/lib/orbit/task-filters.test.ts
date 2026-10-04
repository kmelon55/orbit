import assert from "node:assert/strict";
import test from "node:test";
import { OptimisticItems } from "./optimistic-mutations";
import { formatDayKey } from "./para";
import type { OrbitSnapshot } from "./schema";
import { orbitItemSchema } from "./schema";
import {
	completedOnDay,
	isVisibleTaskEvent,
	taskListDay,
} from "./task-filters";

const day = "2026-10-01";
const completed = new Date(2026, 9, 1, 0, 30).toISOString();
const item = orbitItemSchema.parse({
	id: "task",
	title: "할 일",
	type: "task",
	space: "inbox",
	status: "done",
	due: "2026-09-29",
	completedAt: completed,
	created: "2026-09-01",
	updated: "2026-10-02",
	path: "task.md",
});
test("today completed uses the local completion date, not due date or later edits", () => {
	assert.equal(formatDayKey(new Date(completed)), day);
	assert.equal(completedOnDay(item, day), true);
	assert.equal(completedOnDay(item, "2026-10-02"), false);
	assert.equal(taskListDay(item, day), "2026-09-29");
	assert.equal(completedOnDay({ ...item, status: "open" }, day), false);
});
test("completion filtering preserves the scheduled group for past, today, future and undated tasks", () => {
	for (const due of ["2026-09-29", day, "2026-10-03T09:30:00", undefined]) {
		const task = { ...item, due };
		assert.equal(completedOnDay(task, day), true);
		assert.equal(taskListDay(task, day), due?.slice(0, 10));
		assert.equal(
			taskListDay({ ...task, status: "open", completedAt: undefined }, day),
			taskListDay(task, day),
		);
	}
});
test("optimistic completion, saved completion and rollback keep tasks in their original date group", () => {
	const today = formatDayKey();
	for (const due of ["2000-01-01", "2099-01-01T09:30:00", undefined]) {
		const task = {
			...item,
			due,
			status: "open" as const,
			completedAt: undefined,
		};
		const source: OrbitSnapshot = {
			items: [task],
			canvases: [],
			today: { tasks: [], events: [] },
			folders: { project: [], area: [], resource: [], archive: [] },
			counts: {
				inbox: 1,
				project: 0,
				area: 0,
				resource: 0,
				archive: 0,
				event: 0,
			},
			vaultPath: "/test",
			generatedAt: today,
			displayDate: { day: "", month: "", weekday: "", longLabel: "" },
		};
		const store = new OptimisticItems();
		const mutation = { action: "toggle-task" as const, id: task.id };
		store.start("toggle", mutation, source);
		const optimistic = store.project(source).items[0];
		assert.equal(optimistic.status, "done");
		assert.equal(completedOnDay(optimistic, today), true);
		assert.equal(optimistic.due, due);
		assert.equal(taskListDay(optimistic, today), due?.slice(0, 10));
		store.finish({ requestId: "toggle", mutation, phase: "failure" });
		assert.equal(store.project(source).items[0].status, "open");
		assert.equal(
			taskListDay(store.project(source).items[0], today),
			due?.slice(0, 10),
		);
		store.start("saved-toggle", mutation, source);
		store.finish({
			requestId: "saved-toggle",
			mutation,
			phase: "success",
			result: optimistic,
		});
		assert.equal(store.project(source).items[0].status, "done");
		assert.equal(
			taskListDay(store.project(source).items[0], today),
			due?.slice(0, 10),
		);
	}
});
test("legacy completed tasks fall back to updated; invalid dates are excluded", () => {
	assert.equal(
		completedOnDay(
			{ ...item, completedAt: undefined, updated: completed },
			day,
		),
		true,
	);
	assert.equal(completedOnDay({ ...item, completedAt: "invalid" }, day), false);
});
test("events include today and upcoming, excluding historical, cancelled and archived entries", () => {
	const event = {
		...item,
		type: "event" as const,
		status: undefined,
		start: "2026-09-29",
		end: "2026-10-02",
	};
	assert.equal(isVisibleTaskEvent(event, day), true);
	assert.equal(taskListDay(event, day), day);
	assert.equal(
		taskListDay({ ...event, start: "2026-10-03", end: "2026-10-04" }, day),
		"2026-10-03",
	);
	assert.equal(isVisibleTaskEvent({ ...event, end: "2026-09-30" }, day), false);
	assert.equal(
		isVisibleTaskEvent({ ...event, status: "cancelled" }, day),
		false,
	);
	assert.equal(isVisibleTaskEvent({ ...event, space: "archive" }, day), false);
	assert.equal(isVisibleTaskEvent({ ...event, start: undefined }, day), false);
});
