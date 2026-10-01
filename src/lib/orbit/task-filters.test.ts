import assert from "node:assert/strict";
import test from "node:test";
import { formatDayKey } from "./para";
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
	assert.equal(taskListDay(item, day), day);
	assert.equal(completedOnDay({ ...item, status: "open" }, day), false);
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
