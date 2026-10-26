import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createAssistantMcpServer } from "../../mcp/assistant";
import { mutateAssistant } from "./assistant.server";
import {
	compactAssistantContext,
	fetchAssistantItem,
	searchAssistantItems,
} from "./assistant-read.server";
import { closeOrbitDatabases } from "./database";
import { inferScheduleCategory } from "./schedule-intent";
import {
	createOrbitFolder,
	createOrbitItem,
	fileOrbitItem,
	getOrbitItem,
	listOrbitItems,
	saveScheduleCategory,
} from "./store";

function fixture() {
	const previous = process.env.ORBIT_VAULT_DIR;
	const root = mkdtempSync(path.join(os.tmpdir(), "orbit-schedule-intent-"));
	process.env.ORBIT_VAULT_DIR = root;
	return () => {
		closeOrbitDatabases();
		if (previous === undefined) delete process.env.ORBIT_VAULT_DIR;
		else process.env.ORBIT_VAULT_DIR = previous;
		rmSync(root, { recursive: true, force: true });
	};
}

test("classification distinguishes clear work/private life, mixed and unknown context", () => {
	for (const title of [
		"API·MCP 개발",
		"Draft 마케팅 · 개인 제작자 유입 준비",
		"Payple QA",
		"광고 원가 분석",
	])
		assert.equal(inferScheduleCategory({ type: "task", title }), "business");
	for (const title of [
		"Do laundry",
		"로봇청소기 소모품 주문",
		"Work out",
		"치과 예약",
	])
		assert.equal(inferScheduleCategory({ type: "task", title }), "personal");
	for (const title of ["부산", "Check amazon payment", "사업 및 가족 계획"])
		assert.equal(inferScheduleCategory({ type: "task", title }), undefined);
	assert.equal(
		inferScheduleCategory({
			type: "task",
			title: "점검",
			projectFolder: "Draft/개발",
		}),
		"business",
	);
	assert.equal(
		inferScheduleCategory({ type: "task", title: "개발", category: null }),
		undefined,
	);
	assert.equal(
		inferScheduleCategory({ type: "task", title: "개발", category: "hobby" }),
		"hobby",
	);
	assert.equal(
		inferScheduleCategory({ type: "note", title: "개발" }),
		undefined,
	);
});

test("shared API creation infers category, preserves deliberate review/custom categories and deadlines", async () => {
	const finish = fixture();
	try {
		await saveScheduleCategory({ id: "hobby", name: "취미", color: "pink" });
		const work = await createOrbitItem({
			title: "MCP 개발",
			type: "task",
			space: "inbox",
			body: "",
			due: "2026-10-31",
		});
		assert.ok(work);
		assert.equal(work.category, "business");
		assert.equal(work.due, "2026-10-31");
		assert.equal(work.start, undefined);
		assert.equal(work.end, undefined);
		const personal = await createOrbitItem({
			title: "세탁",
			type: "task",
			space: "inbox",
			body: "",
		});
		assert.equal(personal?.category, "personal");
		for (const category of [null, "hobby"] as const) {
			const saved = await createOrbitItem({
				title: "개발",
				type: "task",
				space: "inbox",
				body: "",
				category,
			});
			assert.equal(saved?.category, category ?? undefined);
		}
		assert.equal(
			(await fetchAssistantItem({ id: work.id })).category,
			"business",
		);
		assert.equal(
			(await searchAssistantItems({ query: "MCP" })).items[0].category,
			"business",
		);
		assert.ok(
			(
				await compactAssistantContext({ date: "2026-10-26" })
			).scheduleCategories?.some((c) => c.id === "hobby"),
		);
		await fileOrbitItem(work.id, { space: work.space, category: null });
		await fileOrbitItem(work.id, { space: work.space, due: "2026-11-01" });
		assert.equal((await getOrbitItem(work.id))?.category, undefined);
	} finally {
		finish();
	}
});

test("MCP rejects work events and invented all-day scheduling, and returns persisted classification", async () => {
	const finish = fixture();
	const server = createAssistantMcpServer(["read", "write", "apply"]);
	const client = new Client({ name: "schedule-policy-test", version: "1" });
	const [a, b] = InMemoryTransport.createLinkedPair();
	try {
		await server.connect(a);
		await client.connect(b);
		const toolList = await client.listTools();
		assert.match(
			JSON.stringify(
				toolList.tools.find((t) => t.name === "orbit_create_item"),
			),
			/business/,
		);
		let request = 0;
		const create = (args: Record<string, unknown>) =>
			client.callTool({
				name: "orbit_create_item",
				arguments: { requestKey: `intent-${request++}`, ...args },
			});
		for (const args of [
			{
				title: "V2 에디터 개발",
				type: "event",
				start: "2026-10-27T14:00",
				end: "2026-10-27T17:00",
			},
			{ title: "고객 미팅", type: "event", start: "2026-10-27" },
			{ title: "API 개발", type: "task", start: "2026-10-27" },
			{ title: "API 개발", type: "task", due: "2026-10-27", allDay: true },
			{ title: "MCP 개발", type: "task", category: "not-an-existing-category" },
		])
			assert.equal((await create(args)).isError, true, JSON.stringify(args));
		assert.equal((await listOrbitItems()).length, 0);
		for (const args of [
			{ title: "API 개발", type: "task", due: "2026-10-27" },
			{
				title: "API 개발 집중",
				type: "task",
				start: "2026-10-27T14:00",
				end: "2026-10-27T17:00",
			},
			{
				title: "API 구현 회의",
				type: "event",
				start: "2026-10-28T10:00",
				end: "2026-10-28T11:00",
			},
			{
				title: "가족 여행",
				type: "event",
				start: "2026-11-01",
				end: "2026-11-03",
				allDay: true,
			},
		])
			assert.notEqual((await create(args)).isError, true, JSON.stringify(args));
		const items = await listOrbitItems();
		assert.equal(items.length, 4);
		assert.equal(
			items.find((i) => i.title === "가족 여행")?.category,
			"personal",
		);
		assert.equal(
			items.find((i) => i.title === "API 개발")?.category,
			"business",
		);
	} finally {
		await client.close();
		await server.close();
		finish();
	}
});

test("approved event-to-task correction preserves identity, content, period and replay safety", async () => {
	const finish = fixture();
	try {
		const original = await createOrbitItem({
			title: "Draft 개발 검수",
			type: "event",
			space: "event",
			body: "원래 작업과 연결",
			start: "2026-10-27T14:00",
			end: "2026-10-27T17:00",
			category: null,
		});
		assert.ok(original);
		const pending = await mutateAssistant(
			{
				action: "recommend",
				input: {
					requestKey: "convert",
					title: "할 일로 바로잡기",
					reason: "개발 작업",
					action: {
						kind: "update",
						itemId: original.id,
						patch: { type: "task", category: "business" },
					},
				},
			},
			"mcp",
		);
		const rec = pending.recommendations.find((r) => r.requestKey === "convert");
		assert.ok(rec);
		assert.equal((await getOrbitItem(original.id))?.type, "event");
		for (let n = 0; n < 2; n++)
			await mutateAssistant(
				{
					action: "decide",
					input: {
						decision: "apply",
						selections: [{ id: rec.id, revision: rec.revision }],
					},
				},
				"owner",
			);
		const saved = await getOrbitItem(original.id);
		assert.equal(saved?.type, "task");
		assert.equal(saved?.space, "inbox");
		assert.equal(saved?.status, "open");
		assert.equal(saved?.category, "business");
		for (const key of ["id", "body", "start", "end", "created"] as const)
			assert.equal(saved?.[key], original[key]);
		assert.equal((await listOrbitItems()).length, 1);
	} finally {
		finish();
	}
});

test("category-only MCP edits preserve completed work, omitted body and legacy project references", async () => {
	const finish = fixture();
	try {
		await createOrbitFolder({ space: "project", name: "Draft" });
		await createOrbitFolder({
			space: "project",
			name: "개발",
			parent: "Draft",
		});
		const created = await createOrbitItem({
			title: "결제 개발",
			type: "task",
			space: "project",
			folder: "Draft/개발",
			body: "보존할 개발 결과",
			category: null,
			due: "2026-10-21",
		});
		assert.ok(created);
		const original = await fileOrbitItem(created.id, {
			space: "project",
			folder: created.folder,
			project: "Draft",
			status: "done",
		});
		assert.ok(original);
		const state = await mutateAssistant(
			{
				action: "recommend",
				input: {
					requestKey: "category-only",
					title: "업무 분류",
					reason: "명확한 개발 업무",
					action: {
						kind: "update",
						itemId: original.id,
						patch: { category: "business" },
					},
				},
			},
			"mcp",
		);
		const rec = state.recommendations.find(
			(r) => r.requestKey === "category-only",
		);
		assert.ok(rec);
		assert.equal(
			"body" in (rec.action.kind === "update" ? rec.action.patch : {}),
			false,
		);
		await mutateAssistant(
			{
				action: "decide",
				input: {
					decision: "apply",
					selections: [{ id: rec.id, revision: rec.revision }],
				},
			},
			"owner",
		);
		const saved = await getOrbitItem(original.id);
		assert.ok(saved);
		for (const key of [
			"body",
			"project",
			"folder",
			"due",
			"status",
			"completedAt",
		] as const)
			assert.equal(saved[key], original[key]);
		assert.equal(saved.category, "business");
	} finally {
		finish();
	}
});
