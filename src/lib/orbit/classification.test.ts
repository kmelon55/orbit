import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { mailStore } from "../mail/store.server";
import type { MailDetail } from "../mail/types";
import {
	CLASSIFICATION_MODEL,
	classificationFolders,
	classificationItemRevision,
	parseClassification,
} from "./classification";
import { cachedClassification, classifySource } from "./classification.server";
import { requestMailClassifications } from "./mail-classification.server";
import {
	createOrbitFolder,
	createOrbitItem,
	fileOrbitItem,
	getOrbitItem,
	getOrbitSnapshot,
	updateOrbitNote,
} from "./store";

let directory: string;
let savedEnv: Record<string, string | undefined>;
let savedFetch: typeof fetch;
let calls: Array<{
	model: string;
	state: unknown;
	questions: Record<string, { criteria?: Record<string, string> }>;
}>;
beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "orbit-classification-"));
	savedEnv = Object.fromEntries(
		["ORBIT_MAIL_DIR", "ORBIT_VAULT_DIR", "AI_GATEWAY_API_KEY"].map((key) => [
			key,
			process.env[key],
		]),
	);
	process.env.ORBIT_MAIL_DIR = join(directory, "mail");
	process.env.ORBIT_VAULT_DIR = join(directory, "vault");
	process.env.AI_GATEWAY_API_KEY = "fixture-key";
	mkdirSync(process.env.ORBIT_VAULT_DIR);
	savedFetch = globalThis.fetch;
	calls = [];
	globalThis.fetch = async (url, init) => {
		assert.equal(String(url), "https://ai-gateway.vercel.sh/v1/evaluate");
		assert.equal(
			new Headers(init?.headers).get("authorization"),
			"Bearer fixture-key",
		);
		const request = JSON.parse(String(init?.body));
		calls.push(request);
		const answers: Record<string, unknown> = {};
		for (const [name, question] of Object.entries(request.questions) as Array<
			[string, { type: string; criteria?: Record<string, string> }]
		>) {
			if (question.type === "boolean")
				answers[name] = { type: "boolean", probability: 0.94 };
			else {
				const keys = Object.keys(question.criteria ?? {});
				const choice =
					name === "category"
						? "billing"
						: name === "importance"
							? "high"
							: keys.find((key) => key !== "none");
				answers[name] = {
					type: "choice",
					choice,
					probabilities: Object.fromEntries(
						keys.map((key) => [key, key === choice ? 1 : 0]),
					),
				};
			}
		}
		return Response.json({ model: CLASSIFICATION_MODEL, answers });
	};
});
afterEach(() => {
	globalThis.fetch = savedFetch;
	mailStore().db.close();
	rmSync(directory, { recursive: true, force: true });
	for (const [key, value] of Object.entries(savedEnv)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});

async function noteFixture() {
	await createOrbitFolder({ space: "project", name: "결제 개선" });
	const note = await createOrbitItem({
		space: "inbox",
		type: "note",
		title: "결제 실패 개선",
		body: "구독 결제 재시도 방식을 정리해요.",
	});
	assert.ok(note);
	return note;
}

test("nested destinations preserve full paths across projects, areas and resources", async () => {
	for (const space of ["project", "area", "resource"] as const) {
		const root = await createOrbitFolder({ space, name: "Atlas" });
		const dev = await createOrbitFolder({
			space,
			name: "개발",
			parent: root.slug,
		});
		await createOrbitFolder({ space, name: "결제", parent: dev.slug });
		await createOrbitFolder({ space, name: "다른 작업" });
		await createOrbitFolder({ space, name: "결제", parent: "다른-작업" });
	}
	const snapshot = await getOrbitSnapshot();
	const { folders } = classificationFolders(snapshot, "Atlas 개발 결제");
	for (const space of ["project", "area", "resource"] as const) {
		const nested = folders.find(
			(folder) => folder.space === space && folder.folder === "atlas/개발/결제",
		);
		assert.equal(nested?.label, "Atlas / 개발 / 결제");
		assert.notEqual(
			nested?.key,
			folders.find(
				(folder) =>
					folder.space === space && folder.folder === "다른-작업/결제",
			)?.key,
		);
		const note = await createOrbitItem({
			space: "inbox",
			type: "note",
			title: "Atlas 결제 재시도",
			body: "중첩 경로까지 본문 보존",
		});
		assert.ok(note);
		// A model-selected destination must survive parsing and the real move API.
		const probabilities = Object.fromEntries([
			...folders.map((folder) => [
				folder.key,
				folder.key === nested?.key ? 1 : 0,
			]),
			["none", 0],
		]);
		const parsed = parseClassification(
			{
				answers: {
					folder: { type: "choice", choice: nested?.key, probabilities },
					fits: { type: "boolean", probability: 1 },
				},
			},
			"item",
			folders,
		);
		await fileOrbitItem(note.id, {
			space: parsed.folders[0].space,
			folder: parsed.folders[0].folder,
		});
		const moved = await getOrbitItem(note.id);
		assert.equal(moved?.space, space);
		assert.equal(moved?.folder, "atlas/개발/결제");
		assert.equal(moved?.body, note.body);
	}
});

test("large folder collections still shortlist relevant deep paths", async () => {
	const snapshot = await getOrbitSnapshot();
	snapshot.folders.project = Array.from({ length: 140 }, (_, index) => ({
		space: "project" as const,
		color: "lime" as const,
		name: `Other ${index}`,
		slug: `other-${index}`,
		depth: 0,
		count: 0,
		descendantCount: 0,
	}));
	snapshot.folders.project.push(
		...["Atlas", "Atlas/개발", "Atlas/개발/결제"].map((slug) => ({
			space: "project" as const,
			color: "lime" as const,
			name: slug.split("/").at(-1) ?? slug,
			slug,
			depth: slug.split("/").length - 1,
			count: 0,
			descendantCount: 0,
		})),
	);
	const { folders, limited } = classificationFolders(
		snapshot,
		"Atlas 개발 결제",
	);
	assert.equal(limited, true);
	assert.equal(folders.length, 100);
	assert.ok(folders.some((folder) => folder.folder === "Atlas/개발/결제"));
});

test("note classification uses the decision endpoint, saves only a suggestion and reuses its encrypted cache", async () => {
	const note = await noteFixture();
	const source = { kind: "item" as const, id: note.id };
	assert.equal(await cachedClassification(source), null);
	assert.equal(calls.length, 0);
	const first = await classifySource(source);
	assert.equal(first.model, CLASSIFICATION_MODEL);
	assert.equal(first.folders[0].space, "project");
	assert.equal(first.folderStatus, "matched");
	assert.equal(first.sourceRevision, classificationItemRevision(note));
	assert.equal((await getOrbitItem(note.id))?.space, "inbox");
	assert.deepEqual(await cachedClassification(source), first);
	assert.deepEqual(await classifySource(source), first);
	assert.equal(calls.length, 1);
	assert.doesNotMatch(
		readFileSync(join(directory, "mail/mail.sqlite"), "utf8"),
		/결제 개선|fixture-key/,
	);
});

test("changed note text and destination folders invalidate cached results", async () => {
	const note = await noteFixture();
	const source = { kind: "item" as const, id: note.id };
	await classifySource(source);
	await updateOrbitNote(note.id, {
		title: note.title,
		body: "결제 영수증 발급 안내",
		tags: [],
	});
	assert.equal(await cachedClassification(source), null);
	await classifySource(source);
	await createOrbitFolder({ space: "area", name: "재정" });
	assert.equal(await cachedClassification(source), null);
	await classifySource(source);
	assert.equal(calls.length, 3);
});

test("concurrent duplicate requests make one paid call", async () => {
	const note = await noteFixture();
	const source = { kind: "item" as const, id: note.id };
	const [one, two] = await Promise.all([
		classifySource(source),
		classifySource(source),
	]);
	assert.deepEqual(one, two);
	assert.equal(calls.length, 1);
});

test("no available folders returns an empty result without a model call", async () => {
	const note = await createOrbitItem({
		space: "inbox",
		type: "note",
		title: "메모",
		body: "아직 폴더가 없어요.",
	});
	assert.ok(note);
	const result = await classifySource({ kind: "item", id: note.id });
	assert.equal(result.folderStatus, "no-folders");
	assert.equal(calls.length, 0);
});

test("only current Inbox notes may be classified", async () => {
	const note = await noteFixture();
	await fileOrbitItem(note.id, { space: "archive" });
	await assert.rejects(
		() => classifySource({ kind: "item", id: note.id }),
		/Inbox/,
	);
	assert.equal(calls.length, 0);
});

test("failure is not cached and provider response bodies never escape", async () => {
	const note = await noteFixture();
	const normalFetch = globalThis.fetch;
	globalThis.fetch = async () =>
		new Response("provider-private-details", { status: 429 });
	const source = { kind: "item" as const, id: note.id };
	await assert.rejects(
		() => classifySource(source),
		(error: Error) => {
			assert.match(error.message, /요청이 많아요/);
			assert.doesNotMatch(error.message, /provider-private/);
			return true;
		},
	);
	assert.equal(await cachedClassification(source), null);
	globalThis.fetch = normalFetch;
	assert.equal((await classifySource(source)).folderStatus, "matched");
});

test("missing Gateway configuration does not issue a paid request", async () => {
	delete process.env.AI_GATEWAY_API_KEY;
	const note = await noteFixture();
	await assert.rejects(
		() => classifySource({ kind: "item", id: note.id }),
		/API 키/,
	);
	assert.equal(calls.length, 0);
});

function mailFixture(id = "selected") {
	const store = mailStore();
	if (!store.accounts().length)
		store.saveAccount(
			{
				id: "account",
				provider: "gmail",
				email: "me@example.com",
				name: "Me",
				notifications: false,
				createdAt: 1,
				lastSync: null,
				error: null,
			},
			{},
		);
	const detail: MailDetail = {
		id,
		accountId: "account",
		folder: "inbox",
		remoteId: "remote",
		subject: "결제 문의",
		from: [{ name: "Kim", address: "kim@example.com" }],
		to: [{ name: "Me", address: "me@example.com" }],
		cc: [],
		date: 1,
		unread: true,
		snippet: "미리보기",
		hasAttachments: false,
		text: "두 번 결제되었어요. 환불 가능한지 답장 부탁해요.",
		html: "",
		replyTo: [],
		messageId: "mail@example.com",
		references: [],
		attachments: [],
	};
	store.saveMessages([detail]);
	store.saveBody(detail.id, detail, detail);
	return detail;
}

test("mail classification includes the selected body and never unrelated Inbox notes or email", async () => {
	const store = mailStore();
	const detail = mailFixture();
	await createOrbitItem({
		space: "inbox",
		type: "note",
		title: "private-unrelated-note",
		body: "private-unrelated-body",
	});
	const result = await classifySource({ kind: "mail", id: detail.id });
	assert.equal(result.category, "billing");
	assert.equal(result.importance, "high");
	assert.equal(result.needsReply, true);
	assert.equal(result.previewOnly, false);
	assert.match(JSON.stringify(calls[0].state), /두 번 결제/);
	assert.doesNotMatch(JSON.stringify(calls[0]), /private-unrelated/);
	assert.equal(store.message(detail.id).unread, true);
});

test("rejects invented destinations, bad distributions and missing probabilities", () => {
	const folders = [
		{
			key: "folder_0",
			space: "project" as const,
			folder: "billing",
			label: "결제",
			examples: [],
		},
	];
	for (const folder of [
		{ type: "choice", choice: "invented", probabilities: { invented: 1 } },
		{
			type: "choice",
			choice: "folder_0",
			probabilities: { folder_0: 1.1, none: -0.1 },
		},
		{
			type: "choice",
			choice: "folder_0",
			probabilities: { folder_0: 0.1, none: 0.9 },
		},
		{ type: "choice", choice: "folder_0", probabilities: {} },
	])
		assert.throws(() =>
			parseClassification(
				{ answers: { folder, fits: { type: "boolean", probability: 0.9 } } },
				"item",
				folders,
			),
		);
});

test("a relative winner cannot force a match when no folder fits", () => {
	const folders = [
		{
			key: "folder_0",
			space: "project" as const,
			folder: "billing",
			label: "결제",
			examples: [],
		},
	];
	const result = parseClassification(
		{
			answers: {
				folder: {
					type: "choice",
					choice: "folder_0",
					probabilities: { folder_0: 0.8, none: 0.2 },
				},
				fits: { type: "boolean", probability: 0.1 },
			},
		},
		"item",
		folders,
	);
	assert.deepEqual(result.folders, []);
	assert.equal(result.folderStatus, "none");
});

async function settledMail(ids: string[]) {
	for (let i = 0; i < 100; i++) {
		const states = await requestMailClassifications(ids);
		if (Object.values(states).every((state) => state.status !== "pending"))
			return states;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error("Classification queue did not settle");
}

test("mailbox automatically classifies unopened mail, limits concurrency and reuses persisted results", async () => {
	const ids = Array.from({ length: 5 }, (_, i) => mailFixture(`mail-${i}`).id);
	const normalFetch = globalThis.fetch;
	let active = 0;
	let peak = 0;
	globalThis.fetch = async (...args) => {
		active++;
		peak = Math.max(peak, active);
		try {
			await new Promise((resolve) => setTimeout(resolve, 15));
			return await normalFetch(...args);
		} finally {
			active--;
		}
	};
	const first = await requestMailClassifications(ids);
	assert.ok(Object.values(first).every((state) => state.status === "pending"));
	await requestMailClassifications(ids);
	const ready = await settledMail(ids);
	assert.equal(calls.length, 5);
	assert.equal(peak, 2);
	for (const id of ids) {
		assert.equal(ready[id].result?.importance, "high");
		assert.equal(mailStore().message(id).unread, true);
	}
	assert.deepEqual(await requestMailClassifications(ids), ready);
	assert.equal(calls.length, 5);
});

test("automatic mail classification backs off after provider errors", async () => {
	const mail = mailFixture();
	let failedCalls = 0;
	globalThis.fetch = async () => {
		failedCalls++;
		return new Response("private diagnostics", { status: 429 });
	};
	await requestMailClassifications([mail.id]);
	const states = await settledMail([mail.id]);
	assert.equal(states[mail.id].status, "error");
	assert.doesNotMatch(states[mail.id].error ?? "", /private diagnostics/);
	await requestMailClassifications([mail.id]);
	await requestMailClassifications([mail.id]);
	assert.equal(failedCalls, 1);
});

test("automatic mail classification reports missing AI configuration without calls", async () => {
	const mail = mailFixture();
	delete process.env.AI_GATEWAY_API_KEY;
	assert.deepEqual(await requestMailClassifications([mail.id]), {
		[mail.id]: { status: "unconfigured" },
	});
	assert.equal(calls.length, 0);
});
