import assert from "node:assert/strict";
import test from "node:test";
import {
	calendarRangeSelection,
	calendarSelection,
	calendarSelectionDay,
} from "./calendar-selection";

test("dragging in either direction selects the same quarter-hour range", () => {
	const forward = calendarSelection("2026-10-12", 540, 585);
	assert.deepEqual(forward, {
		start: 540,
		end: 585,
		time: "09:00",
		endAt: "2026-10-12T09:45:00",
	});
	assert.deepEqual(calendarSelection("2026-10-12", 585, 540), forward);
});

test("a short intentional drag selects at least 15 minutes", () => {
	assert.equal(calendarSelection("2026-10-12", 541, 544).end, 555);
});

test("selection clamps to the day and rolls midnight into the next date", () => {
	assert.equal(
		calendarSelection("2026-12-31", 1425, 1500).endAt,
		"2027-01-01T00:00:00",
	);
	assert.equal(calendarSelection("2026-10-12", -50, 15).time, "00:00");
	assert.equal(calendarSelection("2026-10-12", 1440, 1450).time, "23:45");
});

test("horizontal and reverse drags retain both dates and endpoint times", () => {
	const range = calendarRangeSelection("2026-10-12", 540, "2026-10-14", 600);
	assert.equal(range.date, "2026-10-12");
	assert.equal(range.time, "09:00");
	assert.equal(range.endAt, "2026-10-14T10:00:00");
	assert.deepEqual(
		calendarRangeSelection("2026-10-14", 600, "2026-10-12", 540),
		range,
	);
	assert.equal(
		calendarRangeSelection("2026-10-12", 540, "2026-10-13", 540).endAt,
		"2026-10-13T09:00:00",
	);
	assert.deepEqual(calendarSelectionDay(range, "2026-10-12"), {
		start: 540,
		end: 1440,
	});
	assert.deepEqual(calendarSelectionDay(range, "2026-10-13"), {
		start: 0,
		end: 1440,
	});
	assert.deepEqual(calendarSelectionDay(range, "2026-10-14"), {
		start: 0,
		end: 600,
	});
	assert.equal(calendarSelectionDay(range, "2026-10-15"), null);
});

test("multi-day midnight endings exclude the following day from the preview", () => {
	const range = calendarRangeSelection("2026-12-30", 1380, "2026-12-31", 1440);
	assert.equal(range.endAt, "2027-01-01T00:00:00");
	assert.deepEqual(calendarSelectionDay(range, "2026-12-31"), {
		start: 0,
		end: 1440,
	});
	assert.equal(calendarSelectionDay(range, "2027-01-01"), null);
});
