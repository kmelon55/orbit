import assert from "node:assert/strict";
import test from "node:test";
import { buildMonthLayout } from "./calendar-layout";
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
