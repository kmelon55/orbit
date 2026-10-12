import assert from "node:assert/strict";
import test from "node:test";
import { calendarRoutineItems, moveCalendarRoutine } from "./calendar-routines";
import { visibleDayKeys } from "./calendar-schedule";
import {
	applyRoutineMutation,
	emptyRoutineData,
	type Routine,
	routineRecordKey,
} from "./routines";

const routine: Routine = {
	id: "00000000-0000-4000-8000-000000000001",
	title: "Read",
	timeZone: "Asia/Seoul",
	weekdays: [1, 3, 5],
	moment: "time",
	time: "09:00",
	durationMinutes: 15,
	enabled: true,
	archived: false,
	createdDay: "2026-10-05",
};
const data = { ...emptyRoutineData(), routines: [routine] };

test("planning one occurrence keeps defaults and completion history and can be reset", () => {
	const planned = applyRoutineMutation(data, {
		action: "set-routine-schedule",
		id: routine.id,
		day: "2026-10-05",
		schedule: { start: "2026-10-05T14:00:00", end: "2026-10-05T14:45:00" },
	});
	const items = calendarRoutineItems(planned, ["2026-10-05", "2026-10-07"]);
	assert.deepEqual(
		items.map((item) => item.start),
		["2026-10-05T14:00:00", "2026-10-07T09:00:00"],
	);
	assert.equal(items[0].end, "2026-10-05T14:45:00");
	assert.deepEqual(planned.routines, data.routines);
	assert.deepEqual(planned.records, data.records);
	const reset = applyRoutineMutation(planned, {
		action: "set-routine-schedule",
		id: routine.id,
		day: "2026-10-05",
		schedule: null,
	});
	assert.equal(
		calendarRoutineItems(reset, ["2026-10-05"])[0].start,
		"2026-10-05T09:00:00",
	);
	assert.throws(() =>
		applyRoutineMutation(data, {
			action: "set-routine-schedule",
			id: routine.id,
			day: "2026-10-05",
			schedule: { start: "2026-10-05T14:00:00", end: "2026-10-05T13:00:00" },
		}),
	);
});

test("untimed routines adopt their configured duration and moved occurrences remain discoverable", () => {
	const untimed = calendarRoutineItems(
		{
			...data,
			routines: [
				{ ...routine, moment: "anytime", time: null, durationMinutes: 25 },
			],
		},
		["2026-10-05"],
	)[0];
	const moved = moveCalendarRoutine(untimed, {
		date: "2026-10-06",
		mode: "time",
		time: "10:00",
	});
	assert.equal(moved.end, "2026-10-06T10:25:00");
	assert.ok(moved.start);
	const planned = applyRoutineMutation(data, {
		action: "set-routine-schedule",
		id: routine.id,
		day: "2026-10-05",
		schedule: { start: moved.start, end: moved.end },
	});
	const [occurrence] = calendarRoutineItems(planned, ["2026-10-06"]);
	assert.equal(occurrence.routine.day, "2026-10-05");
	assert.equal(occurrence.start, "2026-10-06T10:00:00");
});

test("calendar projects only due dates, deduplicates days, and supports distant visible dates", () => {
	const items = calendarRoutineItems(data, [
		"2026-10-02",
		"2026-10-05",
		"2026-10-05",
		"2026-10-06",
		"2027-10-11",
	]);
	assert.deepEqual(
		items.map((item) => item.routine.day),
		["2026-10-05", "2027-10-11"],
	);
	assert.equal(items[0].start, "2026-10-05T09:00:00");
	assert.equal(items[0].end, "2026-10-05T09:15:00");
	assert.notEqual(items[0].id, items[1].id);
	assert.equal(items[0].routine.source.id, routine.id);
});

test("calendar completion uses the routine/day record without changing other occurrences", () => {
	const completed = applyRoutineMutation(
		data,
		{
			action: "set-routine-status",
			id: routine.id,
			day: "2026-10-05",
			status: "done",
		},
		"2026-10-07",
	);
	const items = calendarRoutineItems(completed, ["2026-10-05", "2026-10-07"]);
	assert.deepEqual(
		items.map((item) => item.status),
		["done", "open"],
	);
	assert.deepEqual(completed.routines, data.routines);
	const reopened = applyRoutineMutation(
		completed,
		{
			action: "set-routine-status",
			id: routine.id,
			day: "2026-10-05",
			status: "open",
		},
		"2026-10-07",
	);
	assert.equal(
		calendarRoutineItems(reopened, ["2026-10-05"])[0].status,
		"open",
	);
	assert.throws(() =>
		applyRoutineMutation(
			data,
			{
				action: "set-routine-status",
				id: routine.id,
				day: "2026-10-09",
				status: "done",
			},
			"2026-10-07",
		),
	);
});

test("disabled routines retain recorded days, while archived routines stay hidden", () => {
	const recorded = {
		...data,
		routines: [{ ...routine, enabled: false }],
		records: {
			[routineRecordKey(routine.id, "2026-10-05")]: {
				routineId: routine.id,
				day: "2026-10-05",
				status: "skipped" as const,
			},
		},
	};
	assert.deepEqual(
		calendarRoutineItems(recorded, ["2026-10-05", "2026-10-07"]).map(
			(item) => item.routine.status,
		),
		["skipped"],
	);
	assert.equal(
		calendarRoutineItems(
			{ ...recorded, routines: [{ ...routine, archived: true }] },
			["2026-10-05"],
		).length,
		0,
	);
});

test("untimed moments remain all-day and timed routines carry through midnight", () => {
	for (const moment of [
		"anytime",
		"morning",
		"afternoon",
		"evening",
		"bedtime",
	] as const) {
		const [item] = calendarRoutineItems(
			{ ...data, routines: [{ ...routine, moment }] },
			["2026-10-05"],
		);
		assert.equal(item.start, "2026-10-05");
		assert.equal(item.end, undefined);
	}
	const [night] = calendarRoutineItems(
		{ ...data, routines: [{ ...routine, time: "23:50", durationMinutes: 30 }] },
		["2026-10-05"],
	);
	assert.equal(night.end, "2026-10-06T00:20:00");
	assert.deepEqual(visibleDayKeys(night), ["2026-10-05", "2026-10-06"]);
});
