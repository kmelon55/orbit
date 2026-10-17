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
import { goalAttention, goalProjectGroups, goalTasks } from "./goal-portfolio";
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

test("project goals preserve legacy labels, measurable milestones and task links through edits and restart", async () => {
	const f = fixture();
	try {
		const task = await createOrbitItem({
			type: "task",
			title: "Complete a workout",
			body: "",
			space: "inbox",
		});
		assert.ok(task);
		let state = await save({
			title: "Build strength",
			brand: "Training",
			targetDate: "2026-12-31",
			metric: { current: 2, target: 10, unit: "sessions" },
			week: { start: "2026-10-11", outcome: "Complete the training schedule" },
		});
		const root = state.goals[0];
		state = await save({
			title: "Finish the first training block",
			parentId: root.id,
			targetDate: "2026-10-20",
			itemIds: [task.id],
		});
		assert.deepEqual(goalAttention(root, state.goals, "2026-10-16"), []);
		assert.deepEqual(
			goalTasks(root, state.goals, [task]).map((item) => item.id),
			[task.id],
		);
		await save({
			...goalInput(root),
			projectName: "몸 만들기",
			brand: undefined,
		});
		closeOrbitDatabases();
		state = await loadAssistantState();
		const updated = state.goals.find((goal) => goal.id === root.id);
		assert.ok(updated);
		assert.equal(updated.projectName, "몸 만들기");
		assert.equal(updated.brand, undefined);
		assert.deepEqual(updated.metric, root.metric);
		assert.equal(goalProjectGroups(state.goals, [])[0].name, "몸 만들기");
		assert.equal(goalProjectGroups(state.goals, [])[0].goals.length, 1);
		assert.deepEqual(goalAttention(updated, state.goals, "2026-10-23"), [
			"실행 단계 기한 지남",
			"이번 주 계획 없음",
		]);
		assert.deepEqual(
			goalAttention(
				{ ...updated, status: "paused" },
				state.goals,
				"2026-10-23",
			),
			[],
		);
	} finally {
		f.finish();
	}
});

test("project grouping preserves legacy labels and unassigned goals without crossing folder boundaries", () => {
	const makeGoal = (id: string, projectFolders: string[], brand?: string) => ({
		...goalInputSchema.parse({ title: id, projectFolders, brand }),
		id,
		revision: 1,
		createdAt: "2026-10-16",
		updatedAt: "2026-10-16",
	});
	const roots = [
		makeGoal("nested", ["Draft/launch"]),
		makeGoal("similar", ["Drafting"]),
		makeGoal("explicit", ["Draft"], "Other"),
		makeGoal("unassigned", []),
	];
	const folders = [
		{
			space: "project" as const,
			name: "Draft",
			slug: "Draft",
			depth: 0,
			count: 0,
			descendantCount: 0,
			color: "slate" as const,
		},
	];
	const before = structuredClone(roots);
	const groups = goalProjectGroups(roots, folders);
	assert.deepEqual(
		groups
			.find((group) => group.name === "Draft")
			?.goals.map((goal) => goal.id),
		["nested"],
	);
	assert.deepEqual(
		groups
			.find((group) => group.name === "Other")
			?.goals.map((goal) => goal.id),
		["explicit"],
	);
	assert.deepEqual(
		groups
			.find((group) => group.key === "unassigned")
			?.goals.map((goal) => goal.id),
		["similar", "unassigned"],
	);
	assert.deepEqual(roots, before);
});

test("backward plans preserve legacy goals and survive restart, weekly edits, and export", async () => {
	const f = fixture();
	try {
		const legacy = (
			await save({ title: "Existing project", description: "Keep my notes" })
		).goals[0];
		const roadmap = {
			anchorDate: "2026-10-16",
			middleYears: 6 as const,
			steps: {
				decade: { outcome: "A meaningful life", reason: "My direction" },
				middle: {
					outcome: "A strong foundation",
					reason: "Supports the vision",
				},
				year: {
					outcome: "A sustainable practice",
					reason: "Build the foundation",
				},
				half: {
					outcome: "Evidence of progress",
					reason: "Check the direction",
				},
				month: {
					outcome: "First experiment",
					reason: "Learn before committing",
				},
			},
		};
		let state = await save({ title: "My mission", roadmap });
		const mission = state.goals.find((goal) => goal.roadmap);
		assert.ok(mission);
		state = await save({
			...goalInput(mission),
			week: { start: "2026-10-11", outcome: "Finish the experiment" },
		});
		await assert.rejects(
			save({ ...goalInput(mission), title: "Stale mission" }),
			/변경/,
		);
		closeOrbitDatabases();
		state = await loadAssistantState();
		assert.deepEqual(
			state.goals.find((goal) => goal.id === legacy.id),
			legacy,
		);
		assert.deepEqual(
			state.goals.find((goal) => goal.id === mission.id)?.roadmap,
			roadmap,
		);
		assert.equal(
			state.goals.find((goal) => goal.id === mission.id)?.week?.outcome,
			"Finish the experiment",
		);
		const exported = path.join(f.parent, "roadmap-export");
		await exportOrbitDirectory(exported);
		closeOrbitDatabases();
		process.env.ORBIT_VAULT_DIR = path.join(f.parent, "roadmap-import");
		await importOrbitDirectory(exported);
		assert.deepEqual((await loadAssistantState()).goals, state.goals);
	} finally {
		f.finish();
	}
});

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
		state = await save({ title: "Milestone", parentId: child.id });
		const milestone = state.goals.find((goal) => goal.parentId === child.id);
		assert.ok(milestone);
		await assert.rejects(
			save({ title: "Too deep", parentId: milestone.id }),
			/세 단계/,
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

test("moving goal trees preserves descendants and rejects a fourth level without changing saved relationships", async () => {
	const f = fixture();
	try {
		let state = await save({ title: "Overall" });
		const root = state.goals[0];
		state = await save({ title: "Project" });
		let project = state.goals.find((goal) => goal.title === "Project");
		assert.ok(project);
		state = await save({ title: "Milestone", parentId: project.id });
		const step = state.goals.find((goal) => goal.title === "Milestone");
		assert.ok(step);
		state = await save({ ...goalInput(project), parentId: root.id });
		project = state.goals.find((goal) => goal.id === project?.id);
		assert.ok(project);
		assert.equal(
			state.goals.find((goal) => goal.id === step.id)?.parentId,
			project.id,
		);
		state = await save({ title: "Other project", parentId: root.id });
		const other = state.goals.find((goal) => goal.title === "Other project");
		assert.ok(other);
		await assert.rejects(
			save({ ...goalInput(project), parentId: other.id }),
			/세 단계/,
		);
		assert.deepEqual((await loadAssistantState()).goals, state.goals);
		closeOrbitDatabases();
		assert.deepEqual((await loadAssistantState()).goals, state.goals);
	} finally {
		f.finish();
	}
});

test("milestone completion can be undone without changing the goal metric, and stale undo preserves later edits", async () => {
	const f = fixture();
	try {
		let state = await save({
			title: "Training",
			metric: { current: 2, target: 10, unit: "sessions" },
		});
		const root = state.goals[0];
		state = await save({
			title: "First block",
			parentId: root.id,
			horizon: "milestone",
			focused: true,
		});
		const original = state.goals.find((goal) => goal.parentId === root.id);
		assert.ok(original);
		state = await save({ ...goalInput(original), status: "done" });
		const completed = state.goals.find((goal) => goal.id === original.id);
		assert.ok(completed);
		assert.equal(completed.focused, false);
		state = await save({
			...goalInput(completed),
			status: original.status,
			focused: original.focused,
		});
		const restored = state.goals.find((goal) => goal.id === original.id);
		assert.ok(restored);
		assert.equal(restored.status, "active");
		assert.equal(restored.focused, true);
		assert.deepEqual(
			state.goals.find((goal) => goal.id === root.id)?.metric,
			root.metric,
		);
		state = await save({ ...goalInput(restored), title: "Updated block" });
		await assert.rejects(
			save({ ...goalInput(completed), status: "active" }),
			/변경/,
		);
		assert.equal(
			(await loadAssistantState()).goals.find((goal) => goal.id === original.id)
				?.title,
			"Updated block",
		);
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
