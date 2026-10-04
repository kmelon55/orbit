import assert from "node:assert/strict";
import test from "node:test";
import { buildMonthLayout, buildWeekLayout } from "./calendar-layout";
import { formatDayKey } from "./para";
import { orbitItemSchema } from "./schema";

const days = Array.from({ length: 42 }, (_, i) => new Date(2026, 7, 31 + i));
function item(id: string) {
	return orbitItemSchema.parse({
		id,
		title: id,
		type: "event",
		space: "event",
		created: "2026-09-01",
		updated: "2026-09-01",
		path: `${id}.md`,
	});
}
test("a multi-day event stays connected and only splits at the week boundary", () => {
	const event = item("trip");
	const byDay = new Map(
		days.slice(4, 10).map((day) => [formatDayKey(day), [event]]),
	);
	const { segments } = buildMonthLayout(byDay, days);
	assert.deepEqual(
		segments.map(({ row, startColumn, endColumn }) => ({
			row,
			startColumn,
			endColumn,
		})),
		[
			{ row: 0, startColumn: 4, endColumn: 6 },
			{ row: 1, startColumn: 0, endColumn: 2 },
		],
	);
});
test("busy days keep all events and allocate enough non-overlapping lanes", () => {
	const events = Array.from({ length: 8 }, (_, i) => item(`event-${i}`));
	const byDay = new Map([
		[formatDayKey(days[2]), events],
		[formatDayKey(days[3]), [events[0]]],
	]);
	const { segments, rowLaneCounts } = buildMonthLayout(byDay, days);
	assert.equal(segments.length, 8);
	assert.equal(rowLaneCounts[0], 8);
	assert.equal(new Set(segments.map((segment) => segment.lane)).size, 8);
	assert.equal(
		segments.find((segment) => segment.item.id === events[0].id)?.endColumn,
		3,
	);
});
test("adjacent schedules reuse a lane without overlapping", () => {
	const byDay = new Map([
		[formatDayKey(days[0]), [item("first")]],
		[formatDayKey(days[1]), [item("second")]],
	]);
	const { segments, rowLaneCounts } = buildMonthLayout(byDay, days);
	assert.equal(rowLaneCounts[0], 1);
	assert.ok(segments.every((segment) => segment.lane === 0));
	assert.deepEqual(
		buildMonthLayout(new Map(), days).rowLaneCounts,
		[0, 0, 0, 0, 0, 0],
	);
});

test("week view moves timed multi-day events to connected header lanes without narrowing daily appointments", () => {
	const week = days.slice(0, 7);
	const trip = {
		...item("trip"),
		start: "2026-08-30T09:00:00",
		end: "2026-09-09T18:00:00",
	};
	const project = {
		...item("project"),
		start: "2026-09-01T10:00:00",
		end: "2026-09-03T17:00:00",
	};
	const meeting = {
		...item("meeting"),
		start: "2026-09-02T13:00:00",
		end: "2026-09-02T14:00:00",
	};
	const byDay = new Map(
		week.map((day, index) => [
			formatDayKey(day),
			[
				trip,
				...(index >= 1 && index <= 3 ? [project] : []),
				...(index === 2 ? [meeting] : []),
			],
		]),
	);
	const layout = buildWeekLayout(byDay, week);
	assert.equal(layout.laneCount, 2);
	assert.deepEqual(
		layout.segments.map(({ item, startColumn, endColumn, lane }) => [
			item.id,
			startColumn,
			endColumn,
			lane,
		]),
		[
			["trip", 0, 6, 0],
			["project", 1, 3, 1],
		],
	);
	assert.deepEqual(layout.timedByDay.get("2026-09-02"), [meeting]);
	assert.equal([...layout.timedByDay.values()].flat().length, 1);
	assert.equal(layout.segments[0].item.start, "2026-08-30T09:00:00");
	assert.equal(layout.segments[0].item.end, "2026-09-09T18:00:00");
});

test("day view retains timed tasks in the timeline and clips period events to one header cell", () => {
	const day = new Date(2026, 8, 2);
	const trip = {
		...item("trip"),
		start: "2026-09-01T09:00:00",
		end: "2026-09-03T18:00:00",
	};
	const allDay = { ...item("holiday"), start: "2026-09-02", end: "2026-09-02" };
	const task = {
		...item("task"),
		type: "task" as const,
		due: "2026-09-02T15:00:00",
	};
	const layout = buildWeekLayout(
		new Map([[formatDayKey(day), [trip, allDay, task]]]),
		[day],
	);
	assert.equal(layout.segments.length, 2);
	assert.ok(
		layout.segments.every(
			({ startColumn, endColumn }) => startColumn === 0 && endColumn === 0,
		),
	);
	assert.deepEqual(layout.timedByDay.get("2026-09-02"), [task]);
	assert.equal(buildWeekLayout(new Map(), [day]).laneCount, 0);
});

test("horizontal weeks keep a period connected across week and year boundaries", () => {
	const days = Array.from(
		{ length: 21 },
		(_, index) => new Date(2026, 11, 27 + index),
	);
	const trip = {
		...item("trip"),
		start: "2026-12-30T09:00:00",
		end: "2027-01-09T18:00:00",
	};
	const byDay = new Map(
		days.slice(3, 14).map((day) => [formatDayKey(day), [trip]]),
	);
	const layout = buildWeekLayout(byDay, days);
	assert.equal(layout.segments.length, 1);
	assert.equal(layout.laneCount, 1);
	assert.deepEqual(
		layout.segments.map(({ row, startColumn, endColumn, startKey, endKey }) => [
			row,
			startColumn,
			endColumn,
			startKey,
			endKey,
		]),
		[[0, 3, 13, "2026-12-30", "2027-01-09"]],
	);
});

test("continuous month rows cover longer date ranges without a six-week limit", () => {
	const days = Array.from(
		{ length: 84 },
		(_, index) => new Date(2026, 8, 27 + index),
	);
	const trip = item("long-project");
	const byDay = new Map(days.map((day) => [formatDayKey(day), [trip]]));
	const layout = buildMonthLayout(byDay, days);
	assert.equal(layout.rowLaneCounts.length, 12);
	assert.equal(layout.segments.length, 12);
	assert.ok(layout.rowLaneCounts.every((count) => count === 1));
	const covered = layout.segments.flatMap(({ row, startColumn, endColumn }) =>
		days
			.slice(row * 7 + startColumn, row * 7 + endColumn + 1)
			.map(formatDayKey),
	);
	assert.equal(new Set(covered).size, 84);
	assert.equal(covered[0], "2026-09-27");
	assert.equal(covered.at(-1), "2026-12-19");
});
