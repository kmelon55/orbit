import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { closeOrbitDatabases } from "./database";
import { OptimisticItems } from "./optimistic-mutations";
import { formatDayKey } from "./para";
import {
	applyRoutineMutation,
	buildRoutineTimeline,
	emptyRoutineData,
	isRoutineDue,
	type RoutineData,
	type RoutineInput,
	type RoutineMutation,
	routineDataSchema,
	routineInputSchema,
	routineRecordKey,
	routineScheduleLabel,
	routineStatus,
	routineTimerProgress,
	routineToday,
} from "./routines";
import { mutateRoutine } from "./routines.server";
import { exportOrbitDirectory, importOrbitDirectory } from "./storage-transfer";
import { createOrbitItem, getOrbitSnapshot } from "./store";

function input(title = "독서"): RoutineInput {
	return {
		timeZone: "Asia/Seoul",
		id: randomUUID(),
		title,
		weekdays: [0, 1, 2, 3, 4, 5, 6],
		moment: "bedtime",
		time: null,
		enabled: true,
		durationMinutes: 25,
	};
}
function add(data: RoutineData, routine = input()) {
	return applyRoutineMutation(
		data,
		{ action: "save-routine", input: routine },
		"2026-10-05",
	);
}

test("routines only appear on selected dates and never accumulate missed occurrences", () => {
	const definition = {
		...input(),
		weekdays: [1, 3, 5],
		moment: "time" as const,
		time: "19:00",
	};
	const data = add(emptyRoutineData(), definition),
		routine = data.routines[0];
	assert.equal(isRoutineDue(routine, "2026-10-04"), false);
	assert.equal(isRoutineDue(routine, "2026-10-05"), true);
	assert.equal(isRoutineDue(routine, "2026-10-06"), false);
	assert.equal(isRoutineDue(routine, "2026-10-07"), true);
	assert.equal(
		isRoutineDue({ ...routine, enabled: false }, "2026-10-07"),
		false,
	);
	assert.equal(routineScheduleLabel(routine), "월·수·금 · 19:00");
	assert.equal(routineStatus(data, routine.id, "2026-10-07"), "open");
	assert.equal(Object.keys(data.records).length, 0);
});

test("completion and skipping are independent per day; retries are idempotent and configuration edits keep history", () => {
	const routine = input();
	let data = add(emptyRoutineData(), routine);
	const mutation: RoutineMutation = {
		action: "set-routine-status",
		id: routine.id,
		day: "2026-10-05",
		status: "done",
	};
	data = applyRoutineMutation(data, mutation, "2026-10-07");
	assert.deepEqual(applyRoutineMutation(data, mutation, "2026-10-07"), data);
	data = applyRoutineMutation(
		data,
		{ ...mutation, day: "2026-10-06", status: "skipped" },
		"2026-10-07",
	);
	data = applyRoutineMutation(
		data,
		{
			action: "save-routine",
			input: { ...routine, title: "독서 20분", weekdays: [1] },
		},
		"2026-10-07",
	);
	assert.equal(routineStatus(data, routine.id, "2026-10-05"), "done");
	assert.equal(routineStatus(data, routine.id, "2026-10-06"), "skipped");
	assert.equal(routineStatus(data, routine.id, "2026-10-07"), "open");
	data = applyRoutineMutation(data, {
		action: "set-routine-enabled",
		id: routine.id,
		enabled: false,
	});
	data = applyRoutineMutation(
		data,
		{ ...mutation, status: "open" },
		"2026-10-07",
	);
	assert.equal(routineStatus(data, routine.id, "2026-10-05"), "open");
	data = applyRoutineMutation(data, {
		action: "delete-routine",
		id: routine.id,
	});
	assert.equal(data.routines[0].archived, true);
	assert.equal(routineStatus(data, routine.id, "2026-10-06"), "skipped");
});

test("invalid schedules, future completions, disabled writes and orphaned records are rejected", () => {
	const routine = input(),
		data = add(emptyRoutineData(), routine);
	assert.equal(
		routineInputSchema.safeParse({ ...routine, weekdays: [] }).success,
		false,
	);
	assert.equal(
		routineInputSchema.safeParse({ ...routine, timeZone: "invalid-zone" })
			.success,
		false,
	);
	assert.equal(
		routineToday("Asia/Seoul", new Date("2026-10-06T16:00:00Z")),
		"2026-10-07",
	);
	assert.equal(
		routineToday("UTC", new Date("2026-10-06T16:00:00Z")),
		"2026-10-06",
	);
	assert.equal(
		routineInputSchema.safeParse({ ...routine, moment: "time", time: "25:00" })
			.success,
		false,
	);
	assert.equal(
		routineInputSchema.safeParse({ ...routine, moment: "time", time: null })
			.success,
		false,
	);
	assert.throws(() =>
		applyRoutineMutation(
			data,
			{
				action: "set-routine-status",
				id: routine.id,
				day: "2026-10-08",
				status: "done",
			},
			"2026-10-07",
		),
	);
	const disabled = applyRoutineMutation(data, {
		action: "set-routine-enabled",
		id: routine.id,
		enabled: false,
	});
	assert.throws(() =>
		applyRoutineMutation(
			disabled,
			{
				action: "set-routine-status",
				id: routine.id,
				day: "2026-10-07",
				status: "done",
			},
			"2026-10-07",
		),
	);
	assert.equal(
		routineDataSchema.safeParse({
			...data,
			records: {
				bad: { routineId: randomUUID(), day: "2026-10-07", status: "done" },
			},
		}).success,
		false,
	);
});

test("saved routines survive restart, portable export/import and automatic migration while staying out of task/calendar items", async () => {
	const previous = process.env.ORBIT_VAULT_DIR,
		parent = mkdtempSync(path.join(os.tmpdir(), "orbit-routines-"));
	process.env.ORBIT_VAULT_DIR = path.join(parent, "source");
	try {
		const routine = input(),
			today = formatDayKey();
		await createOrbitItem({
			title: "Existing task",
			type: "task",
			body: "",
			space: "inbox",
		});
		await mutateRoutine({ action: "save-routine", input: routine });
		await mutateRoutine({
			action: "routine-timer",
			id: routine.id,
			day: today,
			operation: "start",
		});
		assert.ok(
			(await getOrbitSnapshot()).routineData?.timers[
				routineRecordKey(routine.id, today)
			].startedAt,
		);
		await Promise.all([
			mutateRoutine({
				action: "set-routine-status",
				id: routine.id,
				day: today,
				status: "done",
			}),
			mutateRoutine({
				action: "set-routine-enabled",
				id: routine.id,
				enabled: false,
			}),
		]);
		const saved = (await getOrbitSnapshot()).routineData;
		assert.ok(saved);
		assert.equal(
			saved.timers[routineRecordKey(routine.id, today)].startedAt,
			null,
		);
		closeOrbitDatabases();
		const snapshot = await getOrbitSnapshot();
		assert.deepEqual(snapshot.routineData, saved);
		assert.equal(snapshot.items.length, 1);
		assert.equal(snapshot.today.events.length, 0);
		await exportOrbitDirectory(path.join(parent, "export"));
		process.env.ORBIT_VAULT_DIR = path.join(parent, "target");
		await importOrbitDirectory(path.join(parent, "export"));
		assert.deepEqual((await getOrbitSnapshot()).routineData, saved);
		await importOrbitDirectory(path.join(parent, "export"));
		assert.equal((await getOrbitSnapshot()).routineData?.routines.length, 1);
		await mutateRoutine({
			action: "save-routine",
			input: { ...routine, title: "Manually changed" },
		});
		await assert.rejects(
			importOrbitDirectory(path.join(parent, "export")),
			/충돌/,
		);
		assert.equal(
			(await getOrbitSnapshot()).routineData?.routines[0].title,
			"Manually changed",
		);
		process.env.ORBIT_VAULT_DIR = path.join(parent, "export");
		assert.deepEqual((await getOrbitSnapshot()).routineData, saved);
	} finally {
		closeOrbitDatabases();
		if (previous === undefined) delete process.env.ORBIT_VAULT_DIR;
		else process.env.ORBIT_VAULT_DIR = previous;
		rmSync(parent, { recursive: true, force: true });
	}
});

test("optimistic writes roll back narrowly, keep the latest success over stale refreshes and do not reorder twice", async () => {
	const previous = process.env.ORBIT_VAULT_DIR,
		root = mkdtempSync(path.join(os.tmpdir(), "orbit-routine-overlay-"));
	process.env.ORBIT_VAULT_DIR = root;
	try {
		const a = input("독서"),
			b = input("운동"),
			today = formatDayKey();
		await mutateRoutine({ action: "save-routine", input: a });
		await mutateRoutine({ action: "save-routine", input: b });
		const source = await getOrbitSnapshot(),
			store = new OptimisticItems();
		const done: RoutineMutation = {
			action: "set-routine-status",
			id: a.id,
			day: today,
			status: "done",
		};
		store.start("one", done, source);
		assert.equal(
			routineStatus(
				routineDataSchema.parse(store.project(source).routineData),
				a.id,
				today,
			),
			"done",
		);
		const success = applyRoutineMutation(
			routineDataSchema.parse(source.routineData),
			done,
		);
		store.finish({
			requestId: "one",
			mutation: done,
			phase: "success",
			result: success,
		});
		const open: RoutineMutation = { ...done, status: "open" };
		store.start("two", open, source);
		store.finish({ requestId: "two", mutation: open, phase: "failure" });
		assert.equal(
			routineStatus(
				routineDataSchema.parse(store.project(source).routineData),
				a.id,
				today,
			),
			"done",
		);
		store.start("three", open, source);
		const reopened = applyRoutineMutation(success, open);
		store.finish({
			requestId: "three",
			mutation: open,
			phase: "success",
			result: reopened,
		});
		store.reconcile({ ...source, routineData: reopened });
		assert.equal(
			routineStatus(
				routineDataSchema.parse(store.project(source).routineData),
				a.id,
				today,
			),
			"open",
		);
		const move: RoutineMutation = {
			action: "move-routine",
			id: b.id,
			direction: "up",
		};
		store.start("move", move, source);
		const moved = applyRoutineMutation(reopened, move);
		store.finish({
			requestId: "move",
			mutation: move,
			phase: "success",
			result: moved,
		});
		assert.deepEqual(
			store.project(source).routineData?.routines.map((routine) => routine.id),
			[b.id, a.id],
		);
		store.reconcile({ ...source, routineData: moved });
		assert.deepEqual(
			store.project({ ...source, routineData: moved }).routineData,
			moved,
		);
		const start: RoutineMutation = {
			action: "routine-timer",
			id: a.id,
			day: today,
			operation: "start",
		};
		const started = applyRoutineMutation(moved, start);
		store.start("timer", start, { ...source, routineData: moved });
		store.finish({
			requestId: "timer",
			mutation: start,
			phase: "success",
			result: started,
		});
		const timerKey = routineRecordKey(a.id, today);
		assert.deepEqual(
			store.project({ ...source, routineData: moved }).routineData?.timers,
			started.timers,
		);
		const pause: RoutineMutation = { ...start, operation: "pause" };
		store.start("pause", pause, { ...source, routineData: started });
		store.finish({ requestId: "pause", mutation: pause, phase: "failure" });
		assert.equal(
			store.project({ ...source, routineData: moved }).routineData?.timers[
				timerKey
			].startedAt,
			started.timers[timerKey].startedAt,
		);
		const completed = applyRoutineMutation(started, done);
		store.start("timer-complete", done, { ...source, routineData: started });
		store.finish({
			requestId: "timer-complete",
			mutation: done,
			phase: "success",
			result: completed,
		});
		assert.equal(
			store.project({ ...source, routineData: moved }).routineData?.timers[
				timerKey
			].startedAt,
			null,
		);
		store.reconcile({ ...source, routineData: completed });
		assert.deepEqual(
			store.project({ ...source, routineData: completed }).routineData,
			completed,
		);
		const restarted = applyRoutineMutation(
			applyRoutineMutation(completed, open),
			start,
		);
		store.start("restart", start, { ...source, routineData: completed });
		store.finish({
			requestId: "restart",
			mutation: start,
			phase: "success",
			result: restarted,
		});
		const disable: RoutineMutation = {
			action: "set-routine-enabled",
			id: a.id,
			enabled: false,
		};
		const disabled = applyRoutineMutation(restarted, disable);
		store.start("disable", disable, { ...source, routineData: restarted });
		store.finish({
			requestId: "disable",
			mutation: disable,
			phase: "success",
			result: disabled,
		});
		const enable: RoutineMutation = { ...disable, enabled: true };
		const enabled = applyRoutineMutation(disabled, enable);
		store.start("enable", enable, { ...source, routineData: disabled });
		store.finish({
			requestId: "enable",
			mutation: enable,
			phase: "success",
			result: enabled,
		});
		assert.equal(
			store.project({ ...source, routineData: restarted }).routineData?.timers[
				timerKey
			].startedAt,
			null,
		);
	} finally {
		closeOrbitDatabases();
		if (previous === undefined) delete process.env.ORBIT_VAULT_DIR;
		else process.env.ORBIT_VAULT_DIR = previous;
		rmSync(root, { recursive: true, force: true });
	}
});

test("time-based routines advance after completion, keep missed routines open and separate untimed moments", () => {
	const morning = {
		...input("Morning"),
		moment: "time" as const,
		time: "09:00",
	};
	const noon = { ...input("Noon"), moment: "time" as const, time: "12:00" };
	const evening = {
		...input("Evening"),
		moment: "time" as const,
		time: "21:00",
	};
	const moment = { ...input("Bedtime"), moment: "bedtime" as const };
	let data = [evening, moment, noon, morning].reduce(
		(current, routine) => add(current, routine),
		emptyRoutineData(),
	);
	let entries = buildRoutineTimeline(data, new Date("2026-10-07T01:00:00Z"));
	assert.deepEqual(
		entries.map((entry) => [entry.routine.id, entry.phase]),
		[
			[morning.id, "now"],
			[noon.id, "next"],
			[evening.id, "later"],
			[moment.id, "moment"],
		],
	);
	assert.equal(Object.keys(data.records).length, 0);
	data = applyRoutineMutation(
		data,
		{
			action: "set-routine-status",
			id: morning.id,
			day: "2026-10-07",
			status: "done",
		},
		"2026-10-07",
	);
	entries = buildRoutineTimeline(data, new Date("2026-10-07T04:00:00Z"));
	assert.deepEqual(
		entries.map((entry) => entry.phase),
		["done", "now", "next", "moment"],
	);
	data = applyRoutineMutation(
		data,
		{
			action: "set-routine-status",
			id: noon.id,
			day: "2026-10-07",
			status: "skipped",
		},
		"2026-10-07",
	);
	entries = buildRoutineTimeline(data, new Date("2026-10-07T14:00:00Z"));
	assert.deepEqual(
		entries.map((entry) => entry.phase),
		["done", "skipped", "now", "moment"],
	);
	const nextDay = buildRoutineTimeline(data, new Date("2026-10-07T15:05:00Z"));
	assert.equal(nextDay[0].day, "2026-10-08");
	assert.deepEqual(
		nextDay.map((entry) => entry.phase),
		["next", "later", "later", "moment"],
	);
	assert.equal(routineStatus(data, evening.id, "2026-10-07"), "open");
});

test("timers use persisted timestamps, pause other routines, cap at the goal and keep focus totals after reset", () => {
	const a = { ...input("Focus A"), durationMinutes: 1 },
		b = input("Focus B");
	let data = add(add(emptyRoutineData(), a), b);
	const day = "2026-10-07",
		base = new Date("2026-10-07T01:00:00Z");
	const at = (ms: number) => new Date(base.getTime() + ms);
	const change = (
		id: string,
		operation: "start" | "pause" | "reset",
		ms: number,
	) =>
		(data = applyRoutineMutation(
			data,
			{ action: "routine-timer", id, day, operation },
			day,
			at(ms),
		));
	const keyA = routineRecordKey(a.id, day),
		keyB = routineRecordKey(b.id, day);
	change(a.id, "start", 0);
	assert.equal(
		routineTimerProgress(data.timers[keyA], at(20_000)).remainingMs,
		40_000,
	);
	const serialized = routineDataSchema.parse(JSON.parse(JSON.stringify(data)));
	assert.equal(
		routineTimerProgress(serialized.timers[keyA], at(20_000)).elapsedMs,
		20_000,
	);
	assert.deepEqual(
		applyRoutineMutation(
			data,
			{ action: "routine-timer", id: a.id, day, operation: "start" },
			day,
			at(5000),
		),
		data,
	);
	change(b.id, "start", 20_000);
	assert.equal(data.timers[keyA].startedAt, null);
	assert.equal(data.timers[keyA].elapsedMs, 20_000);
	change(b.id, "pause", 30_000);
	assert.equal(data.timers[keyB].totalMs, 10_000);
	change(a.id, "start", 40_000);
	const expired = routineTimerProgress(data.timers[keyA], at(500_000));
	assert.equal(expired.elapsedMs, 60_000);
	assert.equal(expired.totalMs, 60_000);
	assert.equal(expired.running, false);
	assert.equal(routineStatus(data, a.id, day), "open");
	change(a.id, "reset", 500_000);
	assert.equal(data.timers[keyA].elapsedMs, 0);
	assert.equal(data.timers[keyA].totalMs, 60_000);
	change(a.id, "start", 501_000);
	data = applyRoutineMutation(
		data,
		{ action: "set-routine-status", id: a.id, day, status: "done" },
		day,
		at(510_000),
	);
	assert.equal(data.timers[keyA].startedAt, null);
	assert.equal(data.timers[keyA].totalMs, 69_000);
	assert.throws(() => change(a.id, "start", 511_000), /진행/);
	assert.throws(
		() =>
			applyRoutineMutation(
				data,
				{
					action: "routine-timer",
					id: b.id,
					day: "2026-10-06",
					operation: "start",
				},
				day,
				at(0),
			),
		/오늘/,
	);
});

test("legacy routine data upgrades without losing records and invalid timer data is rejected", () => {
	const data = add(emptyRoutineData());
	const legacy = {
		version: 1,
		routines: data.routines.map(({ durationMinutes, ...routine }) => routine),
		records: data.records,
	};
	const upgraded = routineDataSchema.parse(legacy);
	assert.equal(upgraded.routines[0].durationMinutes, 25);
	assert.deepEqual(upgraded.timers, {});
	const started = applyRoutineMutation(
		upgraded,
		{
			action: "routine-timer",
			id: upgraded.routines[0].id,
			day: "2026-10-07",
			operation: "start",
		},
		"2026-10-07",
		new Date("2026-10-07T01:00:00Z"),
	);
	const key = Object.keys(started.timers)[0];
	assert.equal(
		routineDataSchema.safeParse({
			...started,
			timers: { [key]: { ...started.timers[key], elapsedMs: 2_000_000 } },
		}).success,
		false,
	);
	assert.equal(
		routineDataSchema.safeParse({
			...started,
			timers: { wrong: started.timers[key] },
		}).success,
		false,
	);
	const paused = applyRoutineMutation(
		started,
		{
			action: "set-routine-enabled",
			id: upgraded.routines[0].id,
			enabled: false,
		},
		"2026-10-07",
		new Date("2026-10-07T01:01:00Z"),
	);
	assert.equal(paused.timers[key].startedAt, null);
	assert.equal(paused.timers[key].totalMs, 60_000);
	assert.throws(
		() =>
			applyRoutineMutation(
				paused,
				{
					action: "routine-timer",
					id: upgraded.routines[0].id,
					day: "2026-10-07",
					operation: "start",
				},
				"2026-10-07",
			),
		/진행/,
	);
});
