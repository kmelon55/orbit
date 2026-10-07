import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
	buildRoutineActivity,
	routineDayDetails,
	shiftRoutineDay,
} from "./routine-activity";
import {
	applyRoutineMutation,
	emptyRoutineData,
	type RoutineInput,
	routineRecordKey,
} from "./routines";

const now = new Date("2026-10-07T04:00:00Z");
function definition(): RoutineInput {
	return {
		id: randomUUID(),
		title: "Activity",
		weekdays: [1, 2, 3, 4, 5],
		moment: "anytime",
		time: null,
		timeZone: "Asia/Seoul",
		enabled: true,
		durationMinutes: 25,
	};
}
test("activity counts real completions, ignores skips, filters per routine and keeps rest days out of a streak", () => {
	const a = definition(),
		b = definition();
	let data = applyRoutineMutation(
		applyRoutineMutation(
			emptyRoutineData(),
			{ action: "save-routine", input: a },
			"2026-10-01",
		),
		{ action: "save-routine", input: b },
		"2026-10-01",
	);
	for (const day of ["2026-10-02", "2026-10-05", "2026-10-06"])
		data = applyRoutineMutation(
			data,
			{ action: "set-routine-status", id: a.id, day, status: "done" },
			"2026-10-07",
		);
	data = applyRoutineMutation(
		data,
		{
			action: "set-routine-status",
			id: b.id,
			day: "2026-10-06",
			status: "done",
		},
		"2026-10-07",
	);
	data = applyRoutineMutation(
		data,
		{
			action: "set-routine-status",
			id: b.id,
			day: "2026-10-07",
			status: "skipped",
		},
		"2026-10-07",
	);
	const key = routineRecordKey(a.id, "2026-10-07");
	data.timers[key] = {
		routineId: a.id,
		day: "2026-10-07",
		goalMs: 1_500_000,
		elapsedMs: 120_000,
		totalMs: 180_000,
		startedAt: null,
	};
	const all = buildRoutineActivity(data, 2026, undefined, now),
		single = buildRoutineActivity(data, 2026, a.id, now);
	assert.equal(all.completed, 4);
	assert.equal(all.activeDays, 3);
	assert.equal(all.days.find((day) => day.day === "2026-10-06")?.count, 2);
	assert.equal(all.days.find((day) => day.day === "2026-10-07")?.skipped, 1);
	assert.equal(single.currentStreak, 3);
	assert.equal(single.bestStreak, 3);
	assert.equal(single.completed, 3);
	assert.equal(single.focusMs, 180_000);
	assert.equal(single.days.filter((day) => day.available).length, 280);
	assert.equal(
		single.days.find((day) => day.day === "2026-10-08")?.available,
		false,
	);
	assert.equal(single.days[0].day, "2025-12-28");
	assert.equal(routineDayDetails(data, "2026-10-07", a.id)[0].status, "open");
	assert.deepEqual(
		buildRoutineActivity(emptyRoutineData(), 2026, undefined, now).completed,
		0,
	);
	data = applyRoutineMutation(
		data,
		{
			action: "set-routine-status",
			id: a.id,
			day: "2026-10-06",
			status: "open",
		},
		"2026-10-07",
	);
	assert.equal(buildRoutineActivity(data, 2026, a.id, now).currentStreak, 0);
	assert.equal(buildRoutineActivity(data, 2026, a.id, now).completed, 2);
});

test("annual activity covers leap years and preserves archived history", () => {
	assert.equal(shiftRoutineDay("2024-02-28", 1), "2024-02-29");
	assert.equal(shiftRoutineDay("2026-01-01", -1), "2025-12-31");
	const a = definition();
	let data = applyRoutineMutation(
		emptyRoutineData(),
		{ action: "save-routine", input: a },
		"2024-01-01",
	);
	data = applyRoutineMutation(
		data,
		{
			action: "set-routine-status",
			id: a.id,
			day: "2024-02-29",
			status: "done",
		},
		"2026-10-07",
	);
	data = applyRoutineMutation(
		data,
		{ action: "delete-routine", id: a.id },
		"2026-10-07",
	);
	const activity = buildRoutineActivity(data, 2024, a.id, now);
	assert.equal(activity.days.filter((day) => day.available).length, 366);
	assert.equal(activity.completed, 1);
	assert.equal(routineDayDetails(data, "2024-02-29")[0].status, "done");
	assert.equal(buildRoutineActivity(data, 2026, a.id, now).completed, 0);
});
