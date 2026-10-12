import assert from "node:assert/strict";
import test from "node:test";
import { layoutTimedItems, timedCardHeight } from "./calendar-timed-layout";
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
