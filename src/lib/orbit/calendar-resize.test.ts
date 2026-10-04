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
