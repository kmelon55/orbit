import assert from "node:assert/strict";
import test from "node:test";
import {
	calendarMoveTime,
	calendarResizeTime,
	resizeCalendarItem,
} from "./calendar-resize";
import { orbitItemSchema } from "./schema";

const event = orbitItemSchema.parse({
	id: "event",
	title: "회의",
	type: "event",
	space: "event",
	created: "2026-10-01",
	updated: "2026-10-01",
	path: "event.md",
	start: "2026-10-01T09:00:00",
	end: "2026-10-01T10:00:00",
});
test("resize projects growing and shrinking cards without mutating the saved item", () => {
	const grown = resizeCalendarItem(event, {
		date: "2026-10-01",
		mode: "time",
		time: "11:15",
	});
	assert.equal(grown.start, event.start);
	assert.equal(grown.end, "2026-10-01T11:15:00");
	assert.equal(event.end, "2026-10-01T10:00:00");
	assert.equal(
		resizeCalendarItem(event, {
			date: "2026-10-01",
			mode: "time",
			time: "09:30",
		}).end,
		"2026-10-01T09:30:00",
	);
});
test("resize clamps before the start and can extend across days", () => {
	assert.equal(
		resizeCalendarItem(event, {
			date: "2026-09-30",
			mode: "time",
			time: "08:00",
		}).end,
		"2026-10-01T09:30:00",
	);
	assert.equal(
		resizeCalendarItem(event, {
			date: "2026-10-02",
			mode: "time",
			time: "11:00",
		}).end,
		"2026-10-02T11:00:00",
	);
	assert.equal(
		resizeCalendarItem(event, {
			date: "2026-10-01",
			mode: "time",
			time: "24:00",
		}).end,
		"2026-10-02T00:00:00",
	);
});
test("month resizing preserves timed endings and includes all-day ending dates", () => {
	assert.equal(
		resizeCalendarItem(event, { date: "2026-10-04", mode: "keep-time" }).end,
		"2026-10-04T10:00:00",
	);
	const allDay = { ...event, start: "2026-10-01", end: "2026-10-02" };
	assert.equal(
		resizeCalendarItem(allDay, { date: "2026-10-04", mode: "keep-time" }).end,
		"2026-10-04",
	);
	assert.equal(
		resizeCalendarItem(allDay, { date: "2026-09-30", mode: "keep-time" }).end,
		"2026-10-01",
	);
});
test("pointer positions snap every 15 minutes, including midnight", () => {
	assert.equal(calendarResizeTime(100 + 11.25 * 56, 100, 56), "11:15");
	assert.equal(calendarResizeTime(90, 100, 56), "00:00");
	assert.equal(calendarResizeTime(1500, 100, 56), "24:00");
});

test("top edge grows and shrinks the start while keeping the end fixed", () => {
	for (const time of ["08:15", "09:45"]) {
		const resized = resizeCalendarItem(event, {
			date: "2026-10-01",
			mode: "time",
			time,
			resizeEdge: "start",
		});
		assert.equal(resized.start, `2026-10-01T${time}:00`);
		assert.equal(resized.end, event.end);
	}
	assert.equal(event.start, "2026-10-01T09:00:00");
	assert.equal(
		resizeCalendarItem(event, {
			date: "2026-10-01",
			mode: "time",
			time: "11:00",
			resizeEdge: "start",
		}).start,
		"2026-10-01T09:30:00",
	);
});

test("top edge supports previous days and midnight without moving the end", () => {
	const extended = resizeCalendarItem(event, {
		date: "2026-09-30",
		mode: "time",
		time: "23:30",
		resizeEdge: "start",
	});
	assert.equal(extended.start, "2026-09-30T23:30:00");
	assert.equal(extended.end, event.end);
	assert.equal(
		resizeCalendarItem(event, {
			date: "2026-09-30",
			mode: "time",
			time: "24:00",
			resizeEdge: "start",
		}).start,
		"2026-10-01T00:00:00",
	);
});

test("top edge preserves displayed default ends and keeps task due dates in sync", () => {
	const target = {
		date: "2026-10-01",
		mode: "time",
		time: "08:30",
		resizeEdge: "start",
	} as const;
	const resizedEvent = resizeCalendarItem({ ...event, end: undefined }, target);
	assert.equal(resizedEvent.start, "2026-10-01T08:30:00");
	assert.equal(resizedEvent.end, "2026-10-01T10:00:00");
	const task = {
		...event,
		type: "task" as const,
		start: undefined,
		due: event.start,
		end: undefined,
	};
	const resizedTask = resizeCalendarItem(task, target);
	assert.equal(resizedTask.start, "2026-10-01T08:30:00");
	assert.equal(resizedTask.due, resizedTask.start);
	assert.equal(resizedTask.end, "2026-10-01T09:30:00");
	assert.equal(task.start, undefined);
});

test("moving anchors the preview and destination to the grabbed point on the card", () => {
	for (const offset of [0, 12, 28, 56, 112]) {
		assert.equal(
			calendarMoveTime(100 + 9 * 56 + offset, 100, 56, offset),
			"09:00",
		);
		assert.equal(
			calendarMoveTime(100 + 10.25 * 56 + offset, 100, 56, offset),
			"10:15",
		);
	}
	assert.equal(calendarMoveTime(90, 100, 56, 20), "00:00");
	assert.equal(calendarMoveTime(1700, 100, 56, 20), "23:30");
});
