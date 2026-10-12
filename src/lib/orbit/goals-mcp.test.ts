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
import { goalInput } from "./goals";
import { exportOrbitDirectory, importOrbitDirectory } from "./storage-transfer";
import { createOrbitItem, getOrbitItem, listOrbitItems } from "./store";

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
		await assert.rejects(
			propose("nested", {
				kind: "create-goal",
				input: { title: "Too deep", parentId: child.id },
			}),
			/두 단계/,
		);
		const context = await compactAssistantContext({ date: "2026-10-12" });
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
