import assert from "node:assert/strict";
import test from "node:test";
import { orbitItemSchema } from "./schema";
import { isCurrentOrUpcomingEvent } from "./task-events";

const now = new Date(2026, 8, 24, 12);
function event(start?: string, end?: string) {
	return orbitItemSchema.parse({
		id: "event",
		title: "일정",
		type: "event",
		space: "event",
		created: "2026-09-01",
		updated: "2026-09-01",
		path: "event.md",
		start,
		end,
	});
}

test("ended events disappear, including earlier today and the exact end time", () => {
	for (const end of [
		"2026-09-23T18:00:00",
		"2026-09-24T11:00:00",
		"2026-09-24T12:00:00",
	]) {
		assert.equal(
			isCurrentOrUpcomingEvent(event("2026-09-23T09:00:00", end), now),
			false,
		);
	}
});

test("ongoing multi-day events and future events remain visible", () => {
	assert.equal(
		isCurrentOrUpcomingEvent(
			event("2026-09-23T09:00:00", "2026-09-25T18:00:00"),
			now,
		),
		true,
	);
	assert.equal(
		isCurrentOrUpcomingEvent(event("2026-09-25T09:00:00"), now),
		true,
	);
});

test("all-day events include their final day and expire at local midnight", () => {
	assert.equal(isCurrentOrUpcomingEvent(event("2026-09-23"), now), false);
	assert.equal(isCurrentOrUpcomingEvent(event("2026-09-24"), now), true);
	const trip = event("2026-09-22", "2026-09-24");
	assert.equal(
		isCurrentOrUpcomingEvent(trip, new Date(2026, 8, 24, 23, 59)),
		true,
	);
	assert.equal(isCurrentOrUpcomingEvent(trip, new Date(2026, 8, 25)), false);
});

test("timed events without an end expire at their start, respecting timezone offsets", () => {
	assert.equal(
		isCurrentOrUpcomingEvent(event("2026-09-24T11:00:00"), now),
		false,
	);
	const utcNow = new Date("2026-09-24T03:00:00Z");
	assert.equal(
		isCurrentOrUpcomingEvent(event("2026-09-24T11:00:00+09:00"), utcNow),
		false,
	);
	assert.equal(
		isCurrentOrUpcomingEvent(event("2026-09-24T13:00:00+09:00"), utcNow),
		true,
	);
});

test("undated events remain accessible; archived events and overdue tasks are excluded", () => {
	assert.equal(isCurrentOrUpcomingEvent(event(), now), true);
	assert.equal(
		isCurrentOrUpcomingEvent({ ...event("2026-09-25"), space: "archive" }, now),
		false,
	);
	assert.equal(
		isCurrentOrUpcomingEvent(
			{ ...event(), type: "task", due: "2026-09-23" },
			now,
		),
		false,
	);
});
