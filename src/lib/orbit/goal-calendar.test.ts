import assert from "node:assert/strict";
import { test } from "node:test";
import { type Goal, goalInputSchema } from "./assistant-schema";
import {
	goalCalendarDays,
	goalCalendarEntries,
	shiftGoalMonth,
} from "./goal-calendar";

test("goal calendar keeps complete Sunday weeks across leap years and year boundaries", () => {
	const february = goalCalendarDays("2024-02");
	assert.equal(february[0], "2024-01-28");
	assert.equal(february.at(-1), "2024-03-02");
	assert.ok(february.includes("2024-02-29"));
	assert.equal(february.length % 7, 0);
	assert.equal(new Set(february).size, february.length);
	assert.equal(goalCalendarDays("2026-05").length, 42);
	assert.equal(shiftGoalMonth("2026-12", 1), "2027-01");
	assert.equal(shiftGoalMonth("2026-01", -1), "2025-12");
});

test("calendar includes undated and completed milestones once across shared project groups", () => {
	const make = (id: string, extra: Partial<Goal> = {}): Goal => ({
		...goalInputSchema.parse({ title: id }),
		id,
		revision: 1,
		createdAt: "2026-10-17T00:00:00Z",
		updatedAt: "2026-10-17T00:00:00Z",
		...extra,
	});
	const root = make("root");
	const done = make("done", {
		parentId: root.id,
		status: "done",
		targetDate: "2026-10-20",
	});
	const paused = make("paused", { parentId: root.id, status: "paused" });
	const unrelated = make("other", { targetDate: "2026-10-19" });
	const all = [root, done, paused, unrelated];
	const before = JSON.stringify(all);
	const entries = goalCalendarEntries([root, root], all);
	assert.deepEqual(
		entries.map((entry) => entry.goal.id),
		["done", "root", "paused"],
	);
	assert.ok(entries.every((entry) => entry.root === root));
	assert.equal(JSON.stringify(all), before);
	assert.deepEqual(goalCalendarEntries([], all), []);
});
