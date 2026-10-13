import assert from "node:assert/strict";
import test from "node:test";
import { calendarMoveTime, calendarResizeTime } from "./calendar-resize";
import {
	clampHourHeight,
	layoutTimedItems,
	timedCardHeight,
	zoomedScrollTop,
} from "./calendar-timed-layout";
import { orbitItemSchema } from "./schema";

function task(id: string, start: string, end: string) {
	return orbitItemSchema.parse({
		id,
		title: id,
		type: "task",
		space: "inbox",
		start: `2026-10-11T${start}:00`,
		end: `2026-10-11T${end}:00`,
		created: "2026-10-11",
		updated: "2026-10-11",
		path: `${id}.md`,
	});
}

test("scheduled card heights preserve the time ratio without a minimum height", () => {
	assert.equal(timedCardHeight(540, 555), 30);
	assert.equal(timedCardHeight(540, 570), 60);
	assert.equal(timedCardHeight(540, 600), 120);
	assert.equal(timedCardHeight(540, 541), 2);
	const [entry] = layoutTimedItems([task("a", "09:00", "09:15")], "2026-10-11");
	assert.equal(entry.start, 540);
	assert.equal(entry.end, 555);
	assert.equal(entry.label, "09:00–09:15");
});

test("consecutive 15-minute cards stay in one column with no artificial overlap", () => {
	const entries = layoutTimedItems(
		[
			task("a", "09:00", "09:15"),
			task("b", "09:15", "09:30"),
			task("c", "09:30", "09:45"),
		],
		"2026-10-11",
	);
	assert.deepEqual(
		entries.map((entry) => entry.columns),
		[1, 1, 1],
	);
	assert.deepEqual(
		entries.map((entry) => entry.column),
		[0, 0, 0],
	);
});

test("only schedules that actually overlap share columns", () => {
	const entries = layoutTimedItems(
		[
			task("a", "09:00", "09:30"),
			task("b", "09:15", "09:45"),
			task("c", "09:45", "10:00"),
		],
		"2026-10-11",
	);
	assert.deepEqual(
		entries.map((entry) => entry.columns),
		[2, 2, 1],
	);
	assert.notEqual(entries[0].column, entries[1].column);
});

test("short cards near midnight keep their exact start and end", () => {
	const entries = layoutTimedItems(
		[task("a", "23:15", "23:35"), task("b", "23:45", "23:59")],
		"2026-10-11",
	);
	assert.equal(entries[1].start, 23 * 60 + 45);
	assert.equal(entries[1].end, 23 * 60 + 59);
	assert.deepEqual(
		entries.map((entry) => entry.columns),
		[1, 1],
	);
});

test("zoom scales cards and pointer editing against the same time grid", () => {
	for (const height of [48, 80, 120, 175.5, 240]) {
		const top = 100;
		const startY = top + 9.25 * height;
		const endY = top + 10 * height;
		assert.equal(timedCardHeight(555, 600, height), endY - startY);
		assert.equal(calendarMoveTime(startY + 12, top, height, 12), "09:15");
		assert.equal(calendarResizeTime(endY, top, height), "10:00");
		assert.equal(calendarResizeTime(top + 24 * height, top, height), "24:00");
	}
});

test("zoom preserves the time under the gesture and reverses without drifting", () => {
	const original = 840;
	const offset = 180;
	for (const height of [48, 80, 175.5, 240]) {
		const next = zoomedScrollTop(original, offset, 120, height);
		assert.equal((next + offset) / height, (original + offset) / 120);
		assert.equal(zoomedScrollTop(next, offset, height, 120), original);
	}
});

test("zoom limits density and keeps scrolling within the start of the day", () => {
	assert.equal(clampHourHeight(1), 48);
	assert.equal(clampHourHeight(1000), 240);
	assert.equal(clampHourHeight(135.5), 135.5);
	assert.equal(zoomedScrollTop(0, 200, 120, 48), 0);
});

test("zoomed-out short cards keep a readable row without covering the next card", () => {
	const entries = layoutTimedItems(
		[
			task("a", "09:00", "09:15"),
			task("b", "09:15", "09:30"),
			task("c", "09:30", "09:45"),
		],
		"2026-10-11",
		48,
	);
	assert.deepEqual(
		entries.map((entry) => entry.height),
		[22, 22, 22],
	);
	assert.deepEqual(
		entries.map((entry) => entry.top),
		[432, 444, 456],
	);
	assert.deepEqual(
		entries.map((entry) => entry.column),
		[0, 1, 0],
	);
	assert.deepEqual(
		entries.map((entry) => entry.columns),
		[2, 2, 2],
	);
	assert.equal(entries[0].start, 540);
	assert.equal(entries[0].end, 555);
	assert.equal(entries[0].label, "09:00–09:15");
});

test("short cards near midnight retain the actual start position at minimum zoom", () => {
	const [entry] = layoutTimedItems(
		[task("a", "23:58", "23:59")],
		"2026-10-11",
		48,
	);
	assert.equal(entry.top, (1438 / 60) * 48);
	assert.equal(entry.height, 22);
	assert.ok(entry.top + entry.height <= 24 * 48 + 22);
});
