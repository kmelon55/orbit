import assert from "node:assert/strict";
import { test } from "node:test";
import { rangeFromMinutes, scheduleMinute } from "./schedule-range";

test("an end time at midnight stores the following date instead of 24:00", () => {
	const midnight = scheduleMinute("2026-12-31");
	assert.deepEqual(rangeFromMinutes(midnight + 1425, midnight + 1440), {
		startDate: "2026-12-31",
		startTime: "23:45",
		endDate: "2027-01-01",
		endTime: "00:00",
	});
});

test("civil dates remain stable across daylight-saving dates", () => {
	const start = scheduleMinute("2026-03-07", "09:15") + 1440;
	const end = scheduleMinute("2026-03-07", "10:45") + 1440;
	assert.deepEqual(rangeFromMinutes(start, end), {
		startDate: "2026-03-08",
		startTime: "09:15",
		endDate: "2026-03-08",
		endTime: "10:45",
	});
});
