import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { mailStore } from "../mail/store.server";
import type { MailAccount, MailMessage } from "../mail/types";
import {
	askOrbit,
	gatewayModels,
	gatewaySettings,
	removeGatewayKey,
	saveGatewayKey,
} from "./ai.server";
import { aiChat, aiChats, deleteAiChat } from "./ai-history.server";
import { createOrbitItem } from "./store";

let directory: string;
let previousDirectory: string | undefined;
let previousKey: string | undefined;
let previousVault: string | undefined;
let previousFetch: typeof fetch;
beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "orbit-ai-test-"));
	previousDirectory = process.env.ORBIT_MAIL_DIR;
	previousKey = process.env.AI_GATEWAY_API_KEY;
	previousVault = process.env.ORBIT_VAULT_DIR;
	previousFetch = globalThis.fetch;
	process.env.ORBIT_MAIL_DIR = directory;
	process.env.ORBIT_VAULT_DIR = join(directory, "vault");
	mkdirSync(process.env.ORBIT_VAULT_DIR);
	delete process.env.AI_GATEWAY_API_KEY;
});
afterEach(() => {
	globalThis.fetch = previousFetch;
	mailStore().db.close();
	rmSync(directory, { recursive: true, force: true });
	if (previousDirectory === undefined) delete process.env.ORBIT_MAIL_DIR;
	else process.env.ORBIT_MAIL_DIR = previousDirectory;
	if (previousKey === undefined) delete process.env.AI_GATEWAY_API_KEY;
	else process.env.AI_GATEWAY_API_KEY = previousKey;
	if (previousVault === undefined) delete process.env.ORBIT_VAULT_DIR;
	else process.env.ORBIT_VAULT_DIR = previousVault;
});

test("AI stays optional without a key", async () => {
	assert.deepEqual(await gatewayModels(), { configured: false, models: [] });
	assert.deepEqual(gatewaySettings(), { configured: false, saved: false });
});

test("saved Gateway key is validated, encrypted, preferred over env, and removable", async () => {
	process.env.AI_GATEWAY_API_KEY = "environment-key";
	const seen: string[] = [];
	globalThis.fetch = async (_input, init) => {
		seen.push(new Headers(init?.headers).get("authorization") || "");
		return Response.json({
			data: [
				{
					id: "example/text",
					type: "language",
					modalities: { input: ["text"], output: ["text"] },
				},
				{
					id: "example/image",
					type: "image",
					modalities: { input: ["text"], output: ["image"] },
				},
			],
		});
	};
	assert.deepEqual(await saveGatewayKey("saved-secret-key"), {
		configured: true,
		saved: true,
	});
	assert.deepEqual(await gatewayModels(), {
		configured: true,
		models: ["example/text"],
	});
	assert.deepEqual(gatewaySettings(), { configured: true, saved: true });
	assert.deepEqual(seen, ["Bearer saved-secret-key"]);
	assert.doesNotMatch(
		readFileSync(join(directory, "mail.sqlite"), "utf8"),
		/saved-secret-key/,
	);
	assert.equal(mailStore().setting("aiGatewayApiKey"), "saved-secret-key");
	assert.deepEqual(removeGatewayKey(), { configured: true, saved: false });
	assert.equal(mailStore().setting("aiGatewayApiKey"), null);
});

test("invalid Gateway key is not stored", async () => {
	globalThis.fetch = async () => new Response(null, { status: 401 });
	await assert.rejects(() => saveGatewayKey("invalid-key-value"), /API 키/);
	assert.equal(mailStore().setting("aiGatewayApiKey"), null);
});

test("refresh fetches current Gateway models instead of a cached catalog", async () => {
	let calls = 0;
	globalThis.fetch = async (input) => {
		assert.equal(String(input), "https://ai-gateway.vercel.sh/v1/models");
		calls++;
		return Response.json({
			data: [
				{ id: "example/text", type: "language" },
				...(calls > 1 ? [{ id: "example/new", type: "language" }] : []),
				{ id: "example/image", type: "image" },
			],
		});
	};
	await saveGatewayKey("refresh-secret-key");
	assert.deepEqual((await gatewayModels()).models, ["example/text"]);
	assert.equal(calls, 1);
	assert.deepEqual((await gatewayModels(true)).models, [
		"example/new",
		"example/text",
	]);
	assert.equal(calls, 2);
});

test("AI uses selected mail body, follows up, and keeps encrypted chat history", async () => {
	const store = mailStore();
	const account: MailAccount = {
		id: "account-1",
		provider: "gmail",
		email: "me@example.com",
		name: "Me",
		notifications: false,
		createdAt: 1,
		lastSync: null,
		error: null,
	};
	store.saveAccount(account, { refreshToken: "fixture" });
	const message: MailMessage = {
		id: "mail-1",
		accountId: account.id,
		folder: "inbox",
		remoteId: "remote-1",
		subject: "계약 검토",
		from: [{ name: "Kim", address: "sender@example.com" }],
		to: [{ name: "Me", address: "me@example.com" }],
		cc: [],
		date: Date.now(),
		unread: true,
		snippet: "미리보기",
		hasAttachments: false,
	};
	store.saveMessages([message]);
	const detail = {
		...message,
		text: "본문에만 있는 비밀 일정은 금요일입니다.",
		html: "",
		replyTo: [],
		messageId: "mail-1@example.com",
		references: [],
		attachments: [],
	};
	store.saveBody(message.id, detail, detail);
	const note = await createOrbitItem({
		type: "note",
		space: "inbox",
		title: "회의 메모",
		body: "계약 검토 회의 자료",
	});
	assert.ok(note);
	const requests: Array<{ messages: Array<{ content: string }> }> = [];
	globalThis.fetch = async (input, init) => {
		if (String(input).endsWith("/models"))
			return Response.json({
				data: [{ id: "example/text", type: "language" }],
			});
		requests.push(JSON.parse(String(init?.body)));
		return Response.json({
			choices: [{ message: { content: "금요일입니다. [1]" } }],
		});
	};
	await saveGatewayKey("fixture-gateway-key");
	const first = await askOrbit(
		"이 메일의 일정은?",
		"example/text",
		[{ kind: "mail", id: message.id }],
		undefined,
		"11111111-1111-4111-8111-111111111111",
	);
	assert.equal(first.messages.length, 2);
	assert.equal(first.messages[1].sources?.[0].scope, "full");
	assert.match(
		requests[0].messages.at(-1)?.content ?? "",
		/본문에만 있는 비밀 일정/,
	);
	assert.equal(aiChats()[0].id, first.id);
	assert.equal(aiChat(first.id)?.messages[1].content, "금요일입니다. [1]");
	assert.doesNotMatch(
		readFileSync(join(directory, "mail.sqlite"), "utf8"),
		/금요일입니다/,
	);
	const second = await askOrbit(
		"그걸 다시 알려줘",
		"example/text",
		[{ kind: "item", id: note.id }],
		first.id,
		"22222222-2222-4222-8222-222222222222",
	);
	assert.equal(second.messages.length, 4);
	assert.ok(
		requests[1].messages.some(({ content }) => content === "금요일입니다. [1]"),
	);
	deleteAiChat(first.id);
	assert.equal(aiChat(first.id), null);
});
