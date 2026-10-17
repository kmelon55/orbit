import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { z } from "zod";
import { createAssistantMcpServer } from "../../mcp/assistant";
import {
	loadAssistantState,
	mutateAssistant,
	mutateAssistantWithScopes,
} from "./assistant.server";
import { compactAssistantContext } from "./assistant-read.server";
import {
	goalInputSchema,
	type proposalActionSchema,
	recommendationInputSchema,
} from "./assistant-schema";
import { closeOrbitDatabases } from "./database";
import {
	goalMapProgress,
	goalProjectGroups,
	goalTasks,
} from "./goal-portfolio";
import { goalInput } from "./goals";
import { exportOrbitDirectory, importOrbitDirectory } from "./storage-transfer";
import {
	createOrbitItem,
	fileOrbitItem,
	getOrbitItem,
	listOrbitItems,
} from "./store";

function fixture() {
	const previous = process.env.ORBIT_VAULT_DIR;
	const parent = mkdtempSync(path.join(os.tmpdir(), "orbit-goal-mcp-"));
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

function decode(result: Awaited<ReturnType<Client["callTool"]>>) {
	assert.equal(result.isError, undefined, JSON.stringify(result.content));
	assert.ok(Array.isArray(result.content));
	const block = result.content.find((block) => block.type === "text");
	assert.ok(block && typeof block.text === "string");
	return JSON.parse(block.text);
}

const propose = (
	requestKey: string,
	action: z.input<typeof proposalActionSchema>,
) =>
	mutateAssistant(
		{
			action: "recommend",
			input: recommendationInputSchema.parse({
				requestKey,
				title: requestKey,
				reason: "User-reviewed plan",
				action,
			}),
		},
		"mcp",
	);

test("MCP reads goals, proposes inert changes, applies plans to the same records and replays without duplicating or overwriting", async () => {
	const f = fixture();
	const server = createAssistantMcpServer(["read", "write", "apply"], true);
	const client = new Client({ name: "goal-planning-test", version: "1" });
	const [a, b] = InMemoryTransport.createLinkedPair();
	await server.connect(a);
	await client.connect(b);
	try {
		const task = await createOrbitItem({
			type: "task",
			title: "Customer interview",
			body: "",
			space: "inbox",
			due: "2026-10-20",
		});
		assert.ok(task);
		const { tools } = await client.listTools();
		assert.match(
			JSON.stringify(
				tools.find((t) => t.name === "orbit_propose_action")?.inputSchema,
			),
			/create-goal/,
		);
		const proposed = decode(
			await client.callTool({
				name: "orbit_propose_action",
				arguments: {
					requestKey: "new-goal",
					title: "Reach 10 customers",
					reason: "Discussed with user",
					action: {
						kind: "create-goal",
						input: {
							title: "Reach 10 customers",
							description: "Keep this note",
							focused: true,
							metric: { current: 2, target: 10, unit: "people" },
							itemIds: [task.id],
							successCriteria: "10 paying customers",
						},
					},
				},
			}),
		);
		assert.equal(proposed.applied, false);
		assert.equal(proposed.applicationAvailable, true);
		assert.equal((await loadAssistantState()).goals.length, 0);
		const selection = {
			id: proposed.recommendation.id,
			revision: proposed.recommendation.revision,
		};
		const applied = decode(
			await client.callTool({
				name: "orbit_decide_recommendations",
				arguments: { decision: "apply", selections: [selection] },
			}),
		);
		const goalId = applied.results[0].resultGoalId;
		assert.ok(goalId);
		assert.equal(applied.results[0].resultItemId, undefined);
		const goal = decode(
			await client.callTool({
				name: "orbit_assistant_record",
				arguments: { kind: "goals", id: goalId },
			}),
		);
		assert.equal(goal.metric.current, 2);
		const next = decode(
			await client.callTool({
				name: "orbit_propose_action",
				arguments: {
					requestKey: "weekly-plan",
					title: "Plan interviews",
					reason: "This week's focus",
					action: {
						kind: "update-goal",
						goalId,
						expectedRevision: goal.revision,
						patch: {
							week: {
								start: "2026-10-11",
								outcome: "Interview three customers",
							},
							today: { date: "2026-10-12", itemIds: [task.id] },
						},
					},
				},
			}),
		);
		assert.equal((await loadAssistantState()).goals[0].week, undefined);
		decode(
			await client.callTool({
				name: "orbit_decide_recommendations",
				arguments: {
					decision: "apply",
					selections: [
						{
							id: next.recommendation.id,
							revision: next.recommendation.revision,
						},
					],
				},
			}),
		);
		const context = decode(
			await client.callTool({
				name: "orbit_assistant_context",
				arguments: { date: "2026-10-12" },
			}),
		);
		assert.equal(context.focusedGoalId, goalId);
		assert.equal(context.goalWeekStart, "2026-10-11");
		assert.equal(context.goals[0].week.outcome, "Interview three customers");
		assert.deepEqual(context.goals[0].today.itemIds, [task.id]);
		assert.equal(context.goals[0].metric.current, 2);
		assert.equal(context.goals[0].progress.completed, 0);
		assert.equal((await getOrbitItem(task.id))?.due, "2026-10-20");
		let state = await loadAssistantState();
		assert.equal(state.goals[0].description, "Keep this note");
		await mutateAssistant({
			action: "goal",
			input: goalInputSchema.parse({
				...goalInput(state.goals[0]),
				metric: { current: 3, target: 10, unit: "people" },
			}),
		});
		decode(
			await client.callTool({
				name: "orbit_decide_recommendations",
				arguments: { decision: "apply", selections: [selection] },
			}),
		);
		state = await loadAssistantState();
		assert.equal(state.goals.length, 1);
		assert.equal(state.goals[0].metric?.current, 3);
		assert.equal((await listOrbitItems()).length, 1);
		await exportOrbitDirectory(path.join(f.parent, "export"));
		closeOrbitDatabases();
		process.env.ORBIT_VAULT_DIR = path.join(f.parent, "restored");
		await importOrbitDirectory(path.join(f.parent, "export"));
		assert.deepEqual((await loadAssistantState()).goals, state.goals);
		assert.deepEqual(
			(await loadAssistantState()).recommendations,
			state.recommendations,
		);
	} finally {
		await client.close();
		await server.close();
		f.finish();
	}
});

test("goal edits reject stale revisions and target swaps, preserve omitted fields and roll back an entire mixed batch", async () => {
	const f = fixture();
	try {
		const state = await mutateAssistant({
			action: "goal",
			input: goalInputSchema.parse({
				title: "Original",
				description: "Manual note",
				metric: { current: 1, target: 5, unit: "users" },
				week: { start: "2026-10-11", outcome: "Old plan" },
			}),
		});
		const goal = state.goals[0];
		let proposed = await propose("goal-change", {
			kind: "update-goal",
			goalId: goal.id,
			expectedRevision: goal.revision,
			patch: { focused: true },
		});
		const rec = proposed.recommendations.find(
			(r) => r.requestKey === "goal-change",
		);
		assert.ok(rec);
		assert.deepEqual(rec.action.kind === "update-goal" && rec.action.patch, {
			focused: true,
		});
		await mutateAssistant({
			action: "goal",
			input: goalInputSchema.parse({
				...goalInput(goal),
				title: "Manual update",
			}),
		});
		proposed = await propose("new-task", {
			kind: "create",
			type: "task",
			title: "Must roll back",
		});
		const taskRec = proposed.recommendations.find(
			(r) => r.requestKey === "new-task",
		);
		assert.ok(taskRec);
		const selections = [taskRec, rec].map((r) => ({
			id: r.id,
			revision: r.revision,
		}));
		await assert.rejects(
			async () =>
				mutateAssistantWithScopes(
					{ action: "decide", input: { decision: "apply", selections } },
					["orbit.read", "orbit.apply"],
				),
			/변경/,
		);
		assert.equal((await listOrbitItems()).length, 0);
		assert.ok(
			(await loadAssistantState()).recommendations.every(
				(r) => r.state === "pending",
			),
		);
		await assert.rejects(
			async () =>
				mutateAssistantWithScopes(
					{
						action: "decide",
						input: {
							decision: "apply",
							selections: [
								{
									id: rec.id,
									revision: rec.revision,
									action: {
										kind: "update-goal",
										goalId: goal.id,
										expectedRevision: goal.revision + 1,
										patch: { focused: true },
									},
								},
							],
						},
					},
					["orbit.read", "orbit.apply"],
				),
			/대상/,
		);
		const current = (await loadAssistantState()).goals[0];
		proposed = await propose("clear-week", {
			kind: "update-goal",
			goalId: current.id,
			expectedRevision: current.revision,
			patch: { week: null },
		});
		const clear = proposed.recommendations.find(
			(r) => r.requestKey === "clear-week",
		);
		assert.ok(clear);
		await mutateAssistantWithScopes(
			{
				action: "decide",
				input: {
					decision: "apply",
					selections: [{ id: clear.id, revision: clear.revision }],
				},
			},
			["orbit.read", "orbit.apply"],
		);
		const after = (await loadAssistantState()).goals[0];
		assert.equal(after.week, undefined);
		assert.equal(after.title, "Manual update");
		assert.equal(after.description, "Manual note");
		assert.deepEqual(after.metric, goal.metric);
	} finally {
		f.finish();
	}
});

test("read-only and proposal-only clients cannot apply goal edits; milestone hierarchy and focus remain shared with the UI", async () => {
	const f = fixture();
	try {
		for (const scopes of [["read"], ["read", "write"]] as const) {
			const server = createAssistantMcpServer(scopes, true);
			const client = new Client({ name: "goal-scope-test", version: "1" });
			const [a, b] = InMemoryTransport.createLinkedPair();
			await server.connect(a);
			await client.connect(b);
			try {
				const { tools } = await client.listTools();
				assert.equal(
					tools.some((t) => t.name === "orbit_decide_recommendations"),
					false,
				);
				assert.equal(
					tools.some((t) => t.name === "orbit_propose_action"),
					scopes.length > 1,
				);
			} finally {
				await client.close();
				await server.close();
			}
		}
		const root = (
			await mutateAssistant({
				action: "goal",
				input: goalInputSchema.parse({ title: "Root", focused: true }),
			})
		).goals[0];
		const state = await propose("milestone", {
			kind: "create-goal",
			input: { title: "First milestone", parentId: root.id, focused: true },
		});
		const rec = state.recommendations[0];
		await assert.rejects(
			async () =>
				mutateAssistantWithScopes(
					{
						action: "decide",
						input: {
							decision: "apply",
							selections: [{ id: rec.id, revision: rec.revision }],
						},
					},
					["orbit.read", "orbit.write"],
				),
			/권한/,
		);
		const applied = await mutateAssistantWithScopes(
			{
				action: "decide",
				input: {
					decision: "apply",
					selections: [{ id: rec.id, revision: rec.revision }],
				},
			},
			["orbit.read", "orbit.apply"],
		);
		const child = applied.goals.find((g) => g.parentId === root.id);
		assert.ok(child);
		const nested = await propose("nested", {
			kind: "create-goal",
			input: { title: "Project milestone", parentId: child.id },
		});
		const nestedRec = nested.recommendations.find(
			(item) => item.requestKey === "nested",
		);
		assert.ok(nestedRec);
		const nestedApplied = await mutateAssistantWithScopes(
			{
				action: "decide",
				input: {
					decision: "apply",
					selections: [{ id: nestedRec.id, revision: nestedRec.revision }],
				},
			},
			["orbit.read", "orbit.apply"],
		);
		const milestone = nestedApplied.goals.find(
			(goal) => goal.parentId === child.id,
		);
		assert.ok(milestone);
		await assert.rejects(
			propose("too-deep", {
				kind: "create-goal",
				input: { title: "Too deep", parentId: milestone.id },
			}),
			/세 단계/,
		);
		const context = await compactAssistantContext({ date: "2026-10-12" });
		assert.equal(
			context.goals.find((goal) => goal.id === milestone.id)?.rootGoalId,
			root.id,
		);
		assert.equal(
			context.goals.find((g) => g.id === child.id)?.parentId,
			root.id,
		);
		await mutateAssistant({
			action: "goal",
			input: goalInputSchema.parse({ ...goalInput(root), status: "paused" }),
		});
		assert.equal(
			(await compactAssistantContext({ date: "2026-10-12" })).goals.length,
			0,
		);
	} finally {
		f.finish();
	}
});

test("MCP context matches project maps, includes completed stages and separates stage, task and outcome progress", async () => {
	const f = fixture();
	const server = createAssistantMcpServer(["read"], true);
	const client = new Client({ name: "goal-map-test", version: "1" });
	const [a, b] = InMemoryTransport.createLinkedPair();
	await server.connect(a);
	await client.connect(b);
	try {
		const save = async (input: z.input<typeof goalInputSchema>) => {
			const state = await mutateAssistant({
				action: "goal",
				input: goalInputSchema.parse(input),
			});
			const goal = state.goals.find((g) => g.title === input.title);
			assert.ok(goal);
			return goal;
		};
		const taskIds: string[] = [];
		for (const status of ["open", "done", "cancelled", "archived"] as const) {
			const task = await createOrbitItem({
				type: "task",
				title: status,
				body: "",
				space: "inbox",
			});
			assert.ok(task);
			await fileOrbitItem(task.id, {
				space: status === "archived" ? "archive" : "inbox",
				status: status === "archived" ? "done" : status,
			});
			taskIds.push(task.id);
		}
		const root = await save({
			title: "Launch",
			projectName: "Orbit",
			metric: { current: 3, target: 10, unit: "users" },
			focused: true,
			itemIds: taskIds,
		});
		const done = await save({
			title: "Finished stage",
			parentId: root.id,
			status: "done",
			targetDate: "2026-10-01",
		});
		const paused = await save({
			title: "Paused stage",
			parentId: root.id,
			status: "paused",
			targetDate: "2026-10-02",
		});
		await save({
			title: "Earlier stage",
			parentId: root.id,
			targetDate: "2026-10-03",
		});
		const next = await save({
			title: "Focused stage",
			parentId: root.id,
			focused: true,
			targetDate: "2026-10-20",
		});
		const legacy = await save({ title: "Legacy project", brand: "Legacy" });
		const hidden = await save({ title: "Paused root", status: "paused" });
		await save({ title: "Hidden child", parentId: hidden.id });
		const completedRoot = await save({
			title: "Finished root",
			status: "done",
		});
		const roadmap = {
			anchorDate: "2026-10-17",
			middleYears: 5 as const,
			steps: { year: { outcome: "Annual plan", reason: "Why" } },
		};
		const plan = await save({ title: "Mission", roadmap });
		const context = decode(
			await client.callTool({
				name: "orbit_assistant_context",
				arguments: { date: "2026-10-17" },
			}),
		);
		const state = await loadAssistantState();
		const summary = context.goals.find((g: { id: string }) => g.id === root.id);
		assert.equal(summary.projectName, "Orbit");
		assert.equal(summary.status, "active");
		assert.deepEqual(summary.milestoneProgress, {
			completed: 1,
			total: 4,
			percent: 25,
			nextMilestoneId: next.id,
		});
		assert.deepEqual(
			summary.milestoneProgress,
			goalMapProgress(root, state.goals),
		);
		assert.deepEqual(summary.taskProgress, { completed: 1, total: 2 });
		assert.deepEqual(summary.progress, summary.taskProgress);
		assert.deepEqual(
			new Set(summary.linkedTaskIds),
			new Set(
				goalTasks(root, state.goals, await listOrbitItems()).map(
					(task) => task.id,
				),
			),
		);
		assert.deepEqual(summary.metric, root.metric);
		assert.equal(
			context.goals.find((g: { id: string }) => g.id === done.id).status,
			"done",
		);
		assert.equal(
			context.goals.find((g: { id: string }) => g.id === paused.id).status,
			"paused",
		);
		assert.equal(
			context.goals.find((g: { id: string }) => g.id === legacy.id).projectName,
			"Legacy",
		);
		assert.deepEqual(
			context.goals.find((g: { id: string }) => g.id === plan.id).roadmap,
			roadmap,
		);
		assert.ok(
			!context.goals.some(
				(g: { id: string; parentId: string }) =>
					g.id === hidden.id ||
					g.parentId === hidden.id ||
					g.id === completedRoot.id,
			),
		);
		assert.deepEqual(
			context.goalProjects,
			goalProjectGroups(
				state.goals.filter((g) => !g.parentId && g.status === "active"),
				[],
			).map((group) => ({
				key: group.key,
				name: group.name,
				folders: group.folders,
				goalIds: group.goals.map((g) => g.id),
			})),
		);
		const records = decode(
			await client.callTool({
				name: "orbit_assistant_records",
				arguments: { kind: "goals", limit: 100 },
			}),
		);
		assert.equal(
			records.records.find((g: { id: string }) => g.id === completedRoot.id)
				.state,
			"done",
		);
		assert.equal(
			records.records.find((g: { id: string }) => g.id === plan.id).hasRoadmap,
			true,
		);
		assert.equal(
			records.records.find((g: { id: string }) => g.id === legacy.id)
				.projectName,
			"Legacy",
		);
		assert.equal(
			records.records.find((g: { id: string }) => g.id === done.id).parentId,
			root.id,
		);
		await save({ ...goalInput(next), status: "done" });
		assert.equal(
			goalMapProgress(root, (await loadAssistantState()).goals).completed,
			2,
		);
		await save({ ...goalInput(root), status: "done" });
		const finished = (await loadAssistantState()).goals.find(
			(g) => g.id === root.id,
		);
		assert.ok(finished);
		assert.equal(goalMapProgress(finished, state.goals).percent, 100);
		assert.equal(goalMapProgress(finished, state.goals).nextMilestoneId, null);
	} finally {
		await client.close();
		await server.close();
		f.finish();
	}
});

test("MCP advertises and round-trips roadmap and project edits without losing other planning horizons", async () => {
	const f = fixture();
	const server = createAssistantMcpServer(["read", "write", "apply"], true);
	const client = new Client({ name: "goal-roadmap-test", version: "1" });
	const [a, b] = InMemoryTransport.createLinkedPair();
	await server.connect(a);
	await client.connect(b);
	try {
		const { tools } = await client.listTools();
		const tool = tools.find((tool) => tool.name === "orbit_propose_action");
		assert.match(JSON.stringify(tool?.inputSchema), /projectName/);
		assert.match(JSON.stringify(tool?.inputSchema), /roadmap/);
		assert.match(tool?.description ?? "", /replaced as a whole/);
		assert.match(
			tools.find((tool) => tool.name === "orbit_assistant_context")
				?.description ?? "",
			/milestoneProgress/,
		);
		let sequence = 0;
		const apply = async (action: z.input<typeof proposalActionSchema>) => {
			const proposed = decode(
				await client.callTool({
					name: "orbit_propose_action",
					arguments: {
						requestKey: `roadmap-${++sequence}`,
						title: "Plan",
						reason: "User-reviewed plan",
						action,
					},
				}),
			);
			return decode(
				await client.callTool({
					name: "orbit_decide_recommendations",
					arguments: {
						decision: "apply",
						selections: [
							{
								id: proposed.recommendation.id,
								revision: proposed.recommendation.revision,
							},
						],
					},
				}),
			);
		};
		const read = async (id: string) =>
			decode(
				await client.callTool({
					name: "orbit_assistant_record",
					arguments: { kind: "goals", id },
				}),
			);
		const roadmap = {
			anchorDate: "2026-10-17",
			middleYears: 6 as const,
			steps: {
				decade: { outcome: "Mission outcome", reason: "Purpose" },
				middle: { outcome: "Six-year outcome", reason: "Path" },
				year: { outcome: "Annual outcome", reason: "First year" },
				half: { outcome: "Half-year outcome", reason: "First half" },
				month: { outcome: "Monthly outcome", reason: "First month" },
			},
		};
		const created = await apply({
			kind: "create-goal",
			input: {
				title: "Mission",
				description: "Keep my note",
				projectName: "Orbit",
				roadmap,
			},
		});
		const id = created.results[0].resultGoalId;
		let goal = await read(id);
		assert.deepEqual(goal.roadmap, roadmap);
		await apply({
			kind: "update-goal",
			goalId: id,
			expectedRevision: goal.revision,
			patch: { projectName: "New project" },
		});
		goal = await read(id);
		assert.deepEqual(goal.roadmap, roadmap);
		const updatedRoadmap = {
			...goal.roadmap,
			steps: {
				...goal.roadmap.steps,
				month: { outcome: "Revised month", reason: "New evidence" },
			},
		};
		await apply({
			kind: "update-goal",
			goalId: id,
			expectedRevision: goal.revision,
			patch: { roadmap: updatedRoadmap },
		});
		goal = await read(id);
		assert.deepEqual(goal.roadmap, updatedRoadmap);
		assert.equal(goal.projectName, "New project");
		assert.equal(goal.description, "Keep my note");
		const context = decode(
			await client.callTool({
				name: "orbit_assistant_context",
				arguments: { date: "2026-10-17" },
			}),
		);
		assert.deepEqual(context.goals[0].roadmap, updatedRoadmap);
		await apply({
			kind: "update-goal",
			goalId: id,
			expectedRevision: goal.revision,
			patch: { roadmap: null, projectName: null },
		});
		goal = await read(id);
		assert.equal(goal.roadmap, undefined);
		assert.equal(goal.projectName, undefined);
		assert.equal(goal.description, "Keep my note");
	} finally {
		await client.close();
		await server.close();
		f.finish();
	}
});

test("MCP accepts unmeasured and negative outcomes and records history once per approved measurement", async () => {
	const f = fixture();
	const server = createAssistantMcpServer(["read", "write", "apply"], true);
	const client = new Client({ name: "goal-measurement-test", version: "1" });
	const [a, b] = InMemoryTransport.createLinkedPair();
	await server.connect(a);
	await client.connect(b);
	try {
		const call = async (name: string, args: Record<string, unknown>) =>
			decode(await client.callTool({ name, arguments: args }));
		const create = await call("orbit_propose_action", {
			requestKey: "measure-create",
			title: "Profit",
			reason: "Requested",
			action: {
				kind: "create-goal",
				input: {
					title: "Profit",
					metric: { current: null, target: 1000, unit: "만원" },
				},
			},
		});
		const created = await call("orbit_decide_recommendations", {
			decision: "apply",
			selections: [
				{
					id: create.recommendation.id,
					revision: create.recommendation.revision,
				},
			],
		});
		const id = created.results[0].resultGoalId;
		let context = await call("orbit_assistant_context", { date: "2026-10-17" });
		assert.equal(context.goals[0].metric.current, null);
		assert.equal(context.goals[0].metricPercent, null);
		assert.deepEqual(context.goals[0].metricHistory, []);
		const goal = await call("orbit_assistant_record", { kind: "goals", id });
		const proposed = await call("orbit_propose_action", {
			requestKey: "measure-loss",
			title: "Record loss",
			reason: "Confirmed result",
			action: {
				kind: "update-goal",
				goalId: id,
				expectedRevision: goal.revision,
				patch: {
					metric: {
						...goal.metric,
						current: -200,
						measuredAt: "2026-10-17",
						period: "month",
						periodStart: "2026-09-01",
					},
				},
			},
		});
		assert.equal((await loadAssistantState()).goals[0].metric?.current, null);
		const selection = {
			decision: "apply",
			selections: [
				{
					id: proposed.recommendation.id,
					revision: proposed.recommendation.revision,
				},
			],
		};
		await call("orbit_decide_recommendations", selection);
		await call("orbit_decide_recommendations", selection);
		context = await call("orbit_assistant_context", { date: "2026-10-17" });
		assert.equal(context.goals[0].metric.current, -200);
		assert.equal(context.goals[0].metricHistoryTotal, 1);
		assert.equal(context.goals[0].metricHistory[0].periodStart, "2026-09-01");
		assert.deepEqual(context.goals[0].taskProgress, { completed: 0, total: 0 });
	} finally {
		await client.close();
		await server.close();
		f.finish();
	}
});
