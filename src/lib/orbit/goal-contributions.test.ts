import assert from "node:assert/strict";
import { test } from "node:test";
import { type Goal, goalInputSchema } from "./assistant-schema";
import { goalCalendarEntries } from "./goal-calendar";
import {
	goalContributions,
	goalMapRoots,
	goalProjectGroups,
	goalTasks,
	isGoalProjectOutcome,
} from "./goal-portfolio";
import { goalDepth, goalDescendants, goalRoot } from "./goals";
import type { OrbitFolder, OrbitItem } from "./schema";

const make = (id: string, extra: Partial<Goal> = {}): Goal => ({
	...goalInputSchema.parse({ title: id }),
	id,
	revision: 1,
	createdAt: "2026-10-17T00:00:00Z",
	updatedAt: "2026-10-17T00:00:00Z",
	...extra,
});
const folders: OrbitFolder[] = ["A", "B"].map((name) => ({
	space: "project",
	name,
	slug: name,
	depth: 0,
	count: 0,
	descendantCount: 0,
	color: "slate",
}));

test("legacy business milestones keep task links while project outcomes form lanes", () => {
	const root = make("business", { projectFolders: ["A", "B"] });
	const project = make("project-result", {
		parentId: root.id,
		horizon: "milestone",
		projectName: "A",
		projectFolders: ["A"],
	});
	const execution = make("first-sale", {
		parentId: project.id,
		horizon: "milestone",
	});
	const closing = make("closing", {
		parentId: root.id,
		horizon: "milestone",
		projectFolders: ["A", "B"],
		itemIds: ["closing-task"],
	});
	const goals = [root, project, execution, closing];
	const before = structuredClone(goals);
	const groups = goalProjectGroups(goals, folders);
	const lanes = goalContributions(root, goals, groups);
	assert.equal(isGoalProjectOutcome(project, goals), true);
	assert.equal(isGoalProjectOutcome(closing, goals), false);
	assert.deepEqual(
		lanes.find((lane) => lane.goals.includes(closing))?.projects,
		[],
	);
	assert.deepEqual(
		lanes
			.find((lane) => lane.goals.includes(project))
			?.projects.map((p) => p.name),
		["A"],
	);
	assert.deepEqual(
		goalTasks(closing, goals, [
			{
				id: "closing-task",
				type: "task",
				space: "inbox",
				status: "open",
			} as OrbitItem,
		]).map((task) => task.id),
		["closing-task"],
	);
	assert.deepEqual(
		goalCalendarEntries([root], goals)
			.map(({ goal }) => goal.id)
			.sort(),
		goals.map((goal) => goal.id).sort(),
	);
	assert.deepEqual(goals, before);
});

test("one overall goal has parallel project outcomes, shared stages, and a unique shared-project result", () => {
	const root = make("profit", { projectFolders: ["A", "B"] });
	const a = make("a-outcome", { parentId: root.id, projectName: "A" });
	const b = make("b-outcome", {
		parentId: root.id,
		projectFolders: ["B/launch"],
	});
	const common = make("common", { parentId: root.id });
	const joint = make("joint", {
		parentId: root.id,
		projectFolders: ["A", "B"],
	});
	const milestone = make("milestone", { parentId: a.id });
	const goals = [root, a, b, common, joint, milestone];
	const before = structuredClone(goals);
	const groups = goalProjectGroups(goals, folders);
	assert.deepEqual(
		goalMapRoots(groups).map((goal) => goal.id),
		[root.id],
	);
	const lanes = goalContributions(root, goals, groups);
	assert.deepEqual(
		lanes.flatMap((lane) => lane.goals.map((goal) => goal.id)).sort(),
		[a.id, b.id, common.id, joint.id].sort(),
	);
	assert.deepEqual(
		lanes
			.find((lane) => lane.goals.includes(joint))
			?.projects.map((project) => project.name),
		["A", "B"],
	);
	assert.deepEqual(
		lanes.find((lane) => lane.goals.includes(common))?.projects,
		[],
	);
	assert.deepEqual(
		goalDescendants(root, goals).map((goal) => goal.id),
		[a.id, b.id, common.id, joint.id, milestone.id],
	);
	assert.equal(goalDepth(milestone, goals), 3);
	assert.equal(goalRoot(milestone, goals)?.id, root.id);
	assert.equal(goalCalendarEntries([root, root], goals).length, goals.length);
	assert.ok(
		goalCalendarEntries([root], goals).every(
			(entry) => entry.root.id === root.id,
		),
	);
	assert.deepEqual(goals, before);
});

test("project filters find overall goals through project outcomes without root folder links", () => {
	const root = make("profit");
	const a = make("a", { parentId: root.id, projectName: "A" });
	const b = make("b", { parentId: root.id, projectName: "B" });
	const groups = goalProjectGroups([root, a, b], folders);
	for (const name of ["A", "B"])
		assert.deepEqual(
			groups.find((group) => group.name === name)?.goals.map((goal) => goal.id),
			[root.id],
		);
	assert.equal(goalMapRoots(groups).length, 1);
});

test("unlinked stages stay shared even when the overall goal has only one linked project", () => {
	const root = make("profit", { projectName: "A" });
	const stage = make("stage", { parentId: root.id });
	const goals = [root, stage];
	const lanes = goalContributions(
		root,
		goals,
		goalProjectGroups(goals, folders),
	);
	assert.deepEqual(
		lanes.find((lane) => lane.goals.includes(stage))?.projects,
		[],
	);
	assert.deepEqual(
		lanes.find((lane) => lane.projects[0]?.name === "A")?.goals,
		[],
	);
});

test("grandchild task links roll up while metric measurements remain independent", () => {
	const root = make("profit", {
		metric: { current: 12, target: 100, unit: "KRW" },
	});
	const outcome = make("outcome", { parentId: root.id });
	const step = make("step", {
		parentId: outcome.id,
		itemIds: ["task"],
		status: "done",
	});
	const task = {
		id: "task",
		type: "task",
		space: "inbox",
		status: "done",
	} as OrbitItem;
	assert.deepEqual(
		goalTasks(root, [root, outcome, step], [task]).map((item) => item.id),
		[task.id],
	);
	assert.equal(root.metric?.current, 12);
	assert.equal(root.status, "active");
});
