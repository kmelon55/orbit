import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createAssistantMcpServer } from "../../mcp/assistant";
import {
	AssistantError,
	assistantContext,
	loadAssistantState,
	mutateAssistant,
	mutateAssistantWithScopes,
} from "./assistant.server";
import {
	type AssistantMutation,
	briefingInputSchema,
	contextInputSchema,
	daySchema,
	type Recommendation,
	scheduleSchema,
} from "./assistant-schema";
import { closeOrbitDatabases, databaseFor } from "./database";
import { exportOrbitDirectory, importOrbitDirectory } from "./storage-transfer";
import {
	createOrbitFolder,
	createOrbitItem,
	fileOrbitItem,
	getOrbitItem,
	listOrbitItems,
} from "./store";

function fixture() {
	const previous = process.env.ORBIT_VAULT_DIR;
	const parent = mkdtempSync(path.join(os.tmpdir(), "orbit-assistant-"));
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
const recommendation = (
	requestKey: string,
	title = "추천 작업",
): AssistantMutation => ({
	action: "recommend",
	input: {
		requestKey,
		title,
		reason: "사업 목표에 기여",
		action: { kind: "create", type: "task", title, body: "검토된 내용" },
	},
});
const selections = (records: Recommendation[]) =>
	records.map((r) => ({ id: r.id, revision: r.revision }));
const briefing = briefingInputSchema.parse({
	kind: "daily",
	periodStart: "2026-10-11",
	timezone: "Asia/Seoul",
	title: "일일 브리핑",
	origin: "chatgpt",
	sections: {
		importantGoals: "목표",
		progress: "진행",
		priorities: "업무",
		rationale: "이유",
		overdue: "연기",
		intelligence: "정보",
		risksAndOpportunities: "위험",
		schedule: "일정",
	},
});

test("strict dates, timezones and input boundaries", () => {
	assert.equal(daySchema.safeParse("2026-02-30").success, false);
	assert.equal(scheduleSchema.safeParse("2026-10-11T24:30").success, false);
	assert.equal(scheduleSchema.safeParse("2026-10-11T08:00Z").success, false);
	assert.equal(scheduleSchema.safeParse("2026-10-11T08:00").success, true);
	assert.equal(
		contextInputSchema.safeParse({
			date: "2026-10-11",
			timezone: "Invalid/Zone",
		}).success,
		false,
	);
});
test("proposals are inert; selected and edited application is atomic and idempotent", async () => {
	const f = fixture();
	try {
		await mutateAssistant(recommendation("one"), "mcp");
		let state = await mutateAssistant(recommendation("two", "두 번째"), "mcp");
		assert.equal((await listOrbitItems()).length, 0);
		const first = state.recommendations.find((r) => r.requestKey === "one");
		assert.ok(first);
		const second = state.recommendations.find((r) => r.requestKey === "two");
		assert.ok(second);
		const input = {
			decision: "apply" as const,
			selections: [
				{
					id: first.id,
					revision: first.revision,
					action: {
						kind: "create" as const,
						type: "task" as const,
						title: "수정 승인",
						body: "",
						due: "2026-10-12",
					},
				},
			],
		};
		state = await mutateAssistant({ action: "decide", input });
		assert.equal((await listOrbitItems()).length, 1);
		assert.equal((await listOrbitItems())[0].title, "수정 승인");
		await Promise.all([
			mutateAssistant({ action: "decide", input }),
			mutateAssistant({ action: "decide", input }),
		]);
		assert.equal((await listOrbitItems()).length, 1);
		state = await mutateAssistant({
			action: "decide",
			input: {
				decision: "defer",
				selections: selections([second]),
				deferUntil: "2026-10-12",
			},
		});
		assert.equal(
			state.recommendations.find((r) => r.id === second.id)?.state,
			"deferred",
		);
		await assert.rejects(
			() =>
				mutateAssistant({
					action: "decide",
					input: { decision: "apply", selections: selections([second]) },
				}),
			/변경/,
		);
		const deferred = state.recommendations.find((r) => r.id === second.id);
		assert.ok(deferred);
		await mutateAssistant({
			action: "decide",
			input: { decision: "reject", selections: selections([deferred]) },
		});
		await assert.rejects(
			() =>
				mutateAssistant({
					action: "decide",
					input: { decision: "apply", selections: selections([deferred]) },
				}),
			/거절/,
		);
		assert.equal((await listOrbitItems()).length, 1);
	} finally {
		f.finish();
	}
});
test("changed source rolls back the entire selected batch and retains failure audit", async () => {
	const f = fixture();
	try {
		const original = await createOrbitItem({
			title: "원본",
			body: "manual",
			type: "task",
			space: "inbox",
		});
		assert.ok(original);
		await mutateAssistant(recommendation("create"));
		let state = await mutateAssistant(
			{
				action: "recommend",
				input: {
					requestKey: "update",
					title: "변경",
					reason: "이유",
					action: {
						kind: "update",
						itemId: original.id,
						patch: { title: "AI 수정" },
					},
				},
			},
			"mcp",
		);
		await fileOrbitItem(original.id, {
			space: "inbox",
			body: "preserve user edit",
		});
		const create = state.recommendations.find((r) => r.requestKey === "create");
		const update = state.recommendations.find((r) => r.requestKey === "update");
		assert.ok(create);
		assert.ok(update);
		await assert.rejects(
			() =>
				mutateAssistant({
					action: "decide",
					input: {
						decision: "apply",
						selections: selections([create, update]),
					},
				}),
			/원본이 변경/,
		);
		assert.equal((await listOrbitItems()).length, 1);
		assert.equal((await getOrbitItem(original.id))?.body, "preserve user edit");
		state = await loadAssistantState();
		assert.ok(state.recommendations.every((r) => r.state === "pending"));
		assert.ok(
			state.audit.some(
				(a) => a.code === "item_conflict" && a.outcome === "failure",
			),
		);
	} finally {
		f.finish();
	}
});
test("MCP and system actors cannot approve, edit goals or review Inbox", async () => {
	const f = fixture();
	try {
		const state = await mutateAssistant(recommendation("one"), "mcp");
		for (const actor of ["mcp", "system"] as const)
			await assert.rejects(
				() =>
					mutateAssistant(
						{
							action: "decide",
							input: {
								decision: "apply",
								selections: selections(state.recommendations),
							},
						},
						actor,
					),
				(error: unknown) =>
					error instanceof AssistantError && error.code === "forbidden",
			);
		assert.equal((await listOrbitItems()).length, 0);
		await assert.rejects(
			() => mutateAssistant(recommendation("one", "different"), "mcp"),
			/요청 키/,
		);
		await mutateAssistant(recommendation("one"), "mcp");
		assert.equal((await loadAssistantState()).recommendations.length, 1);
	} finally {
		f.finish();
	}
});
test("briefing and finding retries preserve the saved output and review status", async () => {
	const f = fixture();
	try {
		await Promise.all([
			mutateAssistant({ action: "briefing", input: briefing }, "mcp"),
			mutateAssistant({ action: "briefing", input: briefing }, "mcp"),
		]);
		assert.equal((await loadAssistantState()).briefings.length, 1);
		const savedBriefing = (await loadAssistantState()).briefings[0];
		assert.ok(savedBriefing.itemId);
		const note = await getOrbitItem(savedBriefing.itemId);
		assert.equal(note?.type, "note");
		assert.match(note?.body ?? "", /현재 가장 중요한 목표/);
		await fileOrbitItem(savedBriefing.itemId, {
			space: "inbox",
			body: "My edited briefing",
		});
		await mutateAssistant({ action: "briefing", input: briefing }, "mcp");
		assert.equal((await listOrbitItems()).length, 1);
		assert.equal(
			(await getOrbitItem(savedBriefing.itemId))?.body,
			"My edited briefing",
		);
		await assert.rejects(
			() =>
				mutateAssistant({
					action: "briefing",
					input: { ...briefing, title: "different" },
				}),
			/이미 저장/,
		);
		const input = {
			title: "소식",
			body: "Important update",
			importance: 4,
			reason: "새 기회",
			source: {
				name: "news",
				url: "https://example.com/a?utm_source=one",
				observedAt: "2026-10-11T01:00:00Z",
			},
		};
		const state = await mutateAssistant({ action: "inbox", input }, "mcp");
		const saved = state.inbox[0];
		await mutateAssistant({
			action: "inbox-status",
			id: saved.id,
			revision: 1,
			status: "archived",
		});
		await mutateAssistant(
			{
				action: "inbox",
				input: {
					...input,
					source: {
						...input.source,
						url: "https://example.com/a?utm_source=two",
						observedAt: "2026-10-12T01:00:00Z",
					},
				},
			},
			"mcp",
		);
		const final = await loadAssistantState();
		assert.equal(final.inbox.length, 1);
		assert.equal(final.inbox[0].status, "archived");
	} finally {
		f.finish();
	}
});
test("goals reuse projects, roll up descendants and prioritize contribution before due dates", async () => {
	const f = fixture();
	try {
		const folder = await createOrbitFolder({
			space: "project",
			name: "Business",
		});
		const task = await createOrbitItem({
			title: "매출 개선",
			body: "",
			type: "task",
			space: "project",
			folder: folder.slug,
		});
		assert.ok(task);
		await createOrbitItem({
			title: "긴급하지만 목표 없음",
			body: "",
			type: "task",
			space: "inbox",
			due: "2026-10-01",
		});
		let state = await mutateAssistant({
			action: "goal",
			input: {
				title: "장기",
				description: "",
				horizon: "long_term",
				status: "active",
				importance: 5,
				projectFolders: [],
				itemIds: [],
			},
		});
		const parent = state.goals[0];
		state = await mutateAssistant({
			action: "goal",
			input: {
				title: "분기",
				description: "",
				horizon: "quarter",
				status: "active",
				importance: 4,
				parentId: parent.id,
				projectFolders: [folder.slug],
				itemIds: [],
			},
		});
		const child = state.goals.find((g) => g.parentId);
		assert.ok(child);
		await assert.rejects(
			() =>
				mutateAssistant({
					action: "goal",
					input: {
						id: parent.id,
						title: parent.title,
						description: parent.description,
						horizon: parent.horizon,
						status: parent.status,
						importance: parent.importance,
						projectFolders: parent.projectFolders,
						itemIds: parent.itemIds,
						parentId: child.id,
						expectedRevision: 1,
					},
				}),
			/순환/,
		);
		const context = await assistantContext({
			date: "2026-10-11",
			timezone: "Asia/Seoul",
		});
		assert.equal(context.priorities[0].task.id, task.id);
		assert.equal(
			context.goals.find((g) => g.id === parent.id)?.progress.total,
			1,
		);
		assert.equal(context.weekStart, "2026-10-05");
		assert.equal(context.weekEnd, "2026-10-11");
		assert.equal(context.sources.length, 1);
	} finally {
		f.finish();
	}
});
test("portable export round trip preserves recommendations and rejects conflicting history", async () => {
	const f = fixture();
	try {
		await mutateAssistant({ action: "briefing", input: briefing });
		await mutateAssistant(recommendation("export"));
		const before = await loadAssistantState();
		await exportOrbitDirectory(path.join(f.parent, "export"));
		await importOrbitDirectory(path.join(f.parent, "export"));
		closeOrbitDatabases();
		process.env.ORBIT_VAULT_DIR = path.join(f.parent, "restored");
		await importOrbitDirectory(path.join(f.parent, "export"));
		assert.deepEqual(await loadAssistantState(), before);
		const r = before.recommendations[0];
		await mutateAssistant({
			action: "decide",
			input: { decision: "reject", selections: selections([r]) },
		});
		await assert.rejects(
			() => importOrbitDirectory(path.join(f.parent, "export")),
			/conflicts with assistant/,
		);
		assert.equal(
			(await loadAssistantState()).recommendations[0].state,
			"rejected",
		);
		assert.equal(
			databaseFor().sql.prepare("PRAGMA user_version").get()?.user_version,
			1,
		);
	} finally {
		f.finish();
	}
});
test("MCP protocol initialization, scopes, tool schemas and inert writes", async () => {
	const f = fixture();
	try {
		for (const scopes of [["read"], ["read", "write"]] as const) {
			const server = createAssistantMcpServer(scopes);
			const client = new Client({ name: "assistant-test", version: "1" });
			const [a, b] = InMemoryTransport.createLinkedPair();
			await server.connect(a);
			await client.connect(b);
			try {
				const { tools } = await client.listTools();
				assert.equal(tools.length, scopes.length === 1 ? 5 : 9);
				assert.ok(
					tools.every(
						(t) =>
							t.annotations?.readOnlyHint ===
							(!t.name.startsWith("orbit_save") &&
								!t.name.startsWith("orbit_propose") &&
								!t.name.startsWith("orbit_create")),
					),
				);
				assert.ok(
					!tools.some((t) => /apply|approve|capture|file/.test(t.name)),
				);
				const context = await client.callTool({
					name: "orbit_assistant_context",
					arguments: { date: "2026-10-11", timezone: "Asia/Seoul" },
				});
				assert.equal(context.isError, undefined);
				const invalid = await client.callTool({
					name: "orbit_assistant_context",
					arguments: { date: "bad" },
				});
				assert.equal(invalid.isError, true);
				const write = await client.callTool({
					name: "orbit_propose_action",
					arguments: (
						recommendation("protocol") as Extract<
							AssistantMutation,
							{ action: "recommend" }
						>
					).input,
				});
				assert.equal(Boolean(write.isError), scopes.length === 1);
				assert.equal((await listOrbitItems()).length, 0);
			} finally {
				await client.close();
				await server.close();
			}
		}
	} finally {
		f.finish();
	}
});

test("findings are ordinary Inbox notes; edits, conversion and duplicate receipt preserve user content", async () => {
	const f = fixture();
	try {
		const input = {
			title: "사업 소식",
			body: "source content",
			importance: 3,
			reason: "review this",
			source: {
				name: "GitHub",
				externalId: "release:1",
				url: "https://github.com/example/repo/releases/1",
				observedAt: "2026-10-11T00:00:00Z",
			},
		};
		const saved = await mutateAssistant({ action: "inbox", input }, "mcp");
		const entry = saved.inbox[0];
		assert.ok(entry.itemId);
		const note = await getOrbitItem(entry.itemId);
		assert.ok(note);
		assert.equal(note.space, "inbox");
		assert.equal(note.type, "note");
		assert.match(note.body, /source content/);
		await fileOrbitItem(note.id, {
			space: "inbox",
			body: "my edited note",
			type: "task",
		});
		await mutateAssistant({ action: "inbox", input }, "mcp");
		assert.equal((await listOrbitItems()).length, 1);
		assert.equal((await getOrbitItem(note.id))?.body, "my edited note");
		assert.equal((await getOrbitItem(note.id))?.type, "task");
		assert.equal((await loadAssistantState()).inbox[0].status, "applied");
	} finally {
		f.finish();
	}
});

test("requested creation is append-only, idempotent, audited and cannot overwrite existing items", async () => {
	const f = fixture();
	try {
		const input = {
			requestKey: "requested-note",
			type: "note" as const,
			title: "사업 계획",
			body: "사용자가 정리해 달라고 요청한 내용",
		};
		const saved = await mutateAssistant({ action: "create", input }, "mcp");
		const receipt = saved.recommendations.find(
			(r) => r.requestKey === input.requestKey,
		);
		assert.ok(receipt?.resultItemId);
		assert.equal(receipt.state, "applied");
		assert.ok(
			saved.audit.some((r) => r.action === "create" && r.actor === "mcp"),
		);
		await fileOrbitItem(receipt.resultItemId, {
			space: "inbox",
			body: "사용자 편집",
		});
		await mutateAssistant({ action: "create", input }, "mcp");
		assert.equal((await listOrbitItems()).length, 1);
		assert.equal(
			(await getOrbitItem(receipt.resultItemId))?.body,
			"사용자 편집",
		);
		await assert.rejects(
			() =>
				mutateAssistant(
					{ action: "create", input: { ...input, body: "다른 내용" } },
					"mcp",
				),
			/동일 요청 키/,
		);
		assert.equal(
			(await getOrbitItem(receipt.resultItemId))?.body,
			"사용자 편집",
		);
		for (const type of ["task", "event"] as const) {
			const result = await mutateAssistant(
				{
					action: "create",
					input: {
						...input,
						requestKey: type,
						type,
						start: "2026-10-12T09:00",
						end: "2026-10-12T10:00",
					},
				},
				"mcp",
			);
			const record = result.recommendations.find((r) => r.requestKey === type);
			assert.ok(record?.resultItemId);
			const item = await getOrbitItem(record.resultItemId);
			assert.equal(item?.type, type);
			assert.equal(item?.space, type === "event" ? "event" : "inbox");
		}
		await assert.rejects(
			async () =>
				mutateAssistantWithScopes({ action: "create", input }, ["orbit.read"]),
			/권한/,
		);
	} finally {
		f.finish();
	}
});
