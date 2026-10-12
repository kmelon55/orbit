import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
	loadAssistantState,
	mutateAssistant,
	mutateAssistantWithScopes,
} from "./assistant.server";
import { goalInputSchema } from "./assistant-schema";
import { closeOrbitDatabases } from "./database";
import {
	focusedGoal,
	type GoalInput,
	goalInput,
	goalPercent,
	goalWeekStart,
} from "./goals";
import { exportOrbitDirectory, importOrbitDirectory } from "./storage-transfer";
import { createOrbitItem, getOrbitItem, toggleOrbitTask } from "./store";

function fixture() {
	const previous = process.env.ORBIT_VAULT_DIR;
	const parent = mkdtempSync(path.join(os.tmpdir(), "orbit-goals-"));
	process.env.ORBIT_VAULT_DIR = path.join(parent, "vault");
	return {
		parent,
		finish() {
			closeOrbitDatabases();
			if (previous === undefined) delete process.env.ORBIT_VAULT_DIR;
			else process.env.ORBIT_VAULT_DIR = previous;
			rmSync(parent, { recursive: true, force: true });
		},
	};
}
const save = (input: GoalInput) =>
	mutateAssistant({ action: "goal", input: goalInputSchema.parse(input) });

test("focus is exclusive per level, completion clears focus, and stale edits cannot overwrite goals", async () => {
	const f = fixture();
	try {
		let state = await save({ title: "First", focused: true });
		const first = state.goals[0];
		state = await save({ title: "Second", focused: true });
		const second = focusedGoal(state.goals);
		assert.equal(second?.title, "Second");
		assert.equal(state.goals.find((g) => g.id === first.id)?.focused, false);
		await assert.rejects(
			save({ ...goalInput(first), title: "Stale overwrite" }),
			/변경/,
		);
		assert.ok(second);
		state = await save({ title: "Step A", parentId: second.id, focused: true });
		state = await save({ title: "Step B", parentId: second.id, focused: true });
		assert.equal(focusedGoal(state.goals)?.id, second.id);
		assert.equal(
			state.goals.filter((g) => g.parentId === second.id && g.focused).length,
			1,
		);
		const child = state.goals.find((g) => g.title === "Step B");
		assert.ok(child);
		await assert.rejects(
			save({ title: "Too deep", parentId: child.id }),
			/두 단계/,
		);
		await assert.rejects(
			save({ ...goalInput(second), parentId: child.id }),
			/순환/,
		);
		state = await save({ ...goalInput(second), status: "paused" });
		assert.equal(focusedGoal(state.goals), undefined);
	} finally {
		f.finish();
	}
});

test("numeric outcome is independent from tasks; plans survive restart and export/import; goal removal keeps tasks", async () => {
	const f = fixture();
	try {
		const task = await createOrbitItem({
			type: "task",
			title: "Deliver",
			body: "",
			space: "inbox",
		});
		assert.ok(task);
		let state = await save({
			title: "Customers",
			focused: true,
			successCriteria: "Paid users",
			metric: { current: 2, target: 10, unit: "people" },
			itemIds: [task.id],
			week: { start: "2026-10-11", outcome: "Three interviews" },
			today: { date: "2026-10-12", itemIds: [task.id] },
		});
		const root = state.goals[0];
		await save({ title: "Milestone", parentId: root.id });
		await toggleOrbitTask(task.id);
		closeOrbitDatabases();
		state = await loadAssistantState();
		const saved = state.goals.find((g) => g.id === root.id);
		assert.ok(saved);
		assert.equal(goalPercent(saved), 20);
		assert.equal(
			state.goals.find((g) => g.id === root.id)?.today?.itemIds[0],
			task.id,
		);
		const exported = path.join(f.parent, "export");
		await exportOrbitDirectory(exported);
		closeOrbitDatabases();
		process.env.ORBIT_VAULT_DIR = path.join(f.parent, "imported");
		await importOrbitDirectory(exported);
		assert.deepEqual((await loadAssistantState()).goals, state.goals);
		await assert.rejects(
			mutateAssistantWithScopes(
				{ action: "delete-goal", id: root.id, revision: root.revision },
				["orbit.read", "orbit.write", "orbit.apply"],
			),
			/승인/,
		);
		await mutateAssistant({
			action: "delete-goal",
			id: root.id,
			revision: root.revision,
		});
		assert.equal((await loadAssistantState()).goals.length, 0);
		assert.equal((await getOrbitItem(task.id))?.status, "done");
	} finally {
		f.finish();
	}
});

test("plans reject non-task links and excessive daily focus, and weeks start on Sunday", async () => {
	const f = fixture();
	try {
		const note = await createOrbitItem({
			type: "note",
			title: "Note",
			body: "",
			space: "inbox",
		});
		assert.ok(note);
		await assert.rejects(
			save({
				title: "Goal",
				today: { date: "2026-10-12", itemIds: [note.id] },
			}),
			/할 일/,
		);
		assert.equal(
			goalInputSchema.safeParse({
				title: "Goal",
				today: { date: "2026-10-12", itemIds: ["a", "b", "c", "d"] },
			}).success,
			false,
		);
		assert.equal(
			goalInputSchema.safeParse({
				title: "Goal",
				metric: { current: 0, target: 0, unit: "" },
			}).success,
			false,
		);
		assert.equal(goalWeekStart("2026-10-12"), "2026-10-11");
		assert.equal(goalWeekStart("2026-10-11"), "2026-10-11");
	} finally {
		f.finish();
	}
});
