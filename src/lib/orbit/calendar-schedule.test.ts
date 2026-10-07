import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildWeekLayout } from "./calendar-layout";
import { resizeCalendarItem } from "./calendar-resize";
import {
	moveCalendarItem,
	taskDatePatch,
	timedRangeForDay,
	visibleDayKeys,
} from "./calendar-schedule";
import { closeOrbitDatabases } from "./database";
import { formatDayKey } from "./para";
import { orbitItemSchema } from "./schema";
import {
	createOrbitItem,
	fileOrbitItem,
	getOrbitItem,
	getOrbitSnapshot,
	toggleOrbitTask,
	undoOrbitMutation,
	withItemUndo,
} from "./store";
import { taskListDay } from "./task-filters";

const task = orbitItemSchema.parse({
	id: "task",
	title: "기능 구현",
	type: "task",
	space: "project",
	folder: "orbit",
	status: "in_progress",
	body: "설계 메모",
	due: "2026-10-07T09:00:00",
	created: "2026-10-01",
	updated: "2026-10-01",
	path: "task.md",
});

test("resizing a legacy task adds a range to the same task and retains its context", () => {
	const next = resizeCalendarItem(task, {
		date: "2026-10-07",
		mode: "time",
		time: "11:15",
	});
	assert.equal(next.id, task.id);
	assert.equal(next.type, "task");
	assert.equal(next.start, task.due);
	assert.equal(next.end, "2026-10-07T11:15:00");
	assert.equal(next.folder, task.folder);
	assert.equal(next.status, "in_progress");
	assert.equal(next.body, task.body);
	assert.equal(task.start, undefined);
	assert.equal(
		resizeCalendarItem(task, { date: "2026-10-09", mode: "keep-time" }).end,
		"2026-10-09T09:30:00",
	);
	assert.deepEqual(timedRangeForDay(next, "2026-10-07"), {
		start: 540,
		end: 675,
		label: "09:00–11:15",
	});
	const shrunk = resizeCalendarItem(next, {
		date: "2026-10-07",
		mode: "time",
		time: "09:15",
	});
	assert.equal(shrunk.end, "2026-10-07T09:15:00");
	const moved = moveCalendarItem(shrunk, {
		date: "2026-10-08",
		mode: "time",
		time: "14:00",
	});
	assert.equal(moved.start, "2026-10-08T14:00:00");
	assert.equal(moved.end, "2026-10-08T14:15:00");
	assert.equal(moved.due, moved.start);
});

test("a multi-day task is one connected card and date edits move its full period", () => {
	const ranged = { ...task, start: task.due, end: "2026-10-09T17:00:00" };
	assert.deepEqual(visibleDayKeys(ranged), [
		"2026-10-07",
		"2026-10-08",
		"2026-10-09",
	]);
	const days = [
		new Date(2026, 9, 7),
		new Date(2026, 9, 8),
		new Date(2026, 9, 9),
	];
	const layout = buildWeekLayout(
		new Map(days.map((day) => [formatDayKey(day), [ranged]])),
		days,
	);
	assert.equal(layout.segments.length, 1);
	assert.equal(layout.segments[0].startColumn, 0);
	assert.equal(layout.segments[0].endColumn, 2);
	assert.equal([...layout.timedByDay.values()].flat().length, 0);
	assert.deepEqual(taskDatePatch(ranged, "2026-10-10"), {
		due: "2026-10-10T09:00:00",
		start: "2026-10-10T09:00:00",
		end: "2026-10-12T17:00:00",
	});
	assert.deepEqual(taskDatePatch(ranged, ""), {
		due: null,
		start: null,
		end: null,
	});
	const allDay = moveCalendarItem(ranged, {
		date: "2026-10-10",
		mode: "all-day",
	});
	assert.equal(allDay.start, "2026-10-10");
	assert.equal(allDay.end, "2026-10-12");
});

test("all-day task endings are inclusive while timed midnight endings exclude the next day", () => {
	const allDay = {
		...task,
		due: "2026-10-07",
		start: "2026-10-07",
		end: "2026-10-09",
	};
	assert.equal(visibleDayKeys(allDay).length, 3);
	assert.equal(
		resizeCalendarItem(allDay, { date: "2026-10-06", mode: "keep-time" }).end,
		"2026-10-07",
	);
	const timed = { ...task, start: task.due, end: "2026-10-09T00:00:00" };
	assert.deepEqual(visibleDayKeys(timed), ["2026-10-07", "2026-10-08"]);
	assert.equal(taskListDay(timed, "2026-10-09"), "2026-10-08");
});

test("active task periods appear today without completion changing their group", () => {
	const ranged = { ...task, start: task.due, end: "2026-10-09T17:00:00" };
	for (const status of ["open", "in_progress", "done"] as const) {
		assert.equal(
			taskListDay({ ...ranged, status }, "2026-10-08"),
			"2026-10-08",
		);
		assert.equal(
			taskListDay({ ...ranged, status }, "2026-10-06"),
			"2026-10-07",
		);
		assert.equal(
			taskListDay({ ...ranged, status }, "2026-10-10"),
			"2026-10-09",
		);
	}
	assert.equal(taskListDay(task, "2026-10-08"), "2026-10-07");
	assert.deepEqual(taskDatePatch(task, "2026-10-10"), {
		due: "2026-10-10T09:00:00",
		start: null,
		end: null,
	});
});

test("task ranges survive saving, moving, completion, reopen and undo in SQLite", async () => {
	const previous = process.env.ORBIT_VAULT_DIR;
	const root = mkdtempSync(path.join(os.tmpdir(), "orbit-task-period-db-"));
	process.env.ORBIT_VAULT_DIR = root;
	try {
		const today = formatDayKey();
		const nextDate = new Date();
		nextDate.setDate(nextDate.getDate() + 2);
		const end = formatDayKey(nextDate);
		const saved = await createOrbitItem({
			title: "기간 작업",
			type: "task",
			body: "보존할 메모",
			space: "inbox",
			start: today,
			end,
		});
		assert.ok(saved);
		assert.ok(
			(await getOrbitSnapshot()).today.tasks.some(
				(item) => item.id === saved.id,
			),
		);
		const grown = resizeCalendarItem(saved, {
			date: "2099-10-10",
			mode: "keep-time",
		});
		const mutation = {
			action: "file-item" as const,
			id: saved.id,
			input: {
				space: saved.space,
				due: grown.due,
				start: grown.start,
				end: grown.end,
			},
		};
		const receipt = await withItemUndo(mutation, () =>
			fileOrbitItem(saved.id, mutation.input),
		);
		assert.equal((await getOrbitItem(saved.id))?.end, "2099-10-10");
		assert.ok(receipt.undo);
		await undoOrbitMutation(receipt.undo.id);
		assert.equal((await getOrbitItem(saved.id))?.end, end);
		const done = await toggleOrbitTask(saved.id);
		assert.ok(done);
		assert.equal(done.status, "done");
		assert.equal(done.start, today);
		assert.equal(done.end, end);
		assert.ok(done.completedAt);
		assert.ok(
			!(await getOrbitSnapshot()).today.tasks.some(
				(item) => item.id === saved.id,
			),
		);
		await toggleOrbitTask(saved.id);
		closeOrbitDatabases();
		const reloaded = await getOrbitItem(saved.id);
		assert.equal(reloaded?.type, "task");
		assert.equal(reloaded?.body, "보존할 메모");
		assert.equal(reloaded?.start, today);
		assert.equal(reloaded?.end, end);
		assert.equal(reloaded?.completedAt, undefined);
	} finally {
		closeOrbitDatabases();
		if (previous === undefined) delete process.env.ORBIT_VAULT_DIR;
		else process.env.ORBIT_VAULT_DIR = previous;
		rmSync(root, { recursive: true, force: true });
	}
});
