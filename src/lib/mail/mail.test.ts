import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, mock, test } from "node:test";
import { OAuth2Client } from "google-auth-library";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import webpush from "web-push";
import {
	createOrbitSessionToken,
	getOrbitAuthConfig,
} from "../orbit/auth.server";
import { addresses, parseMail, safeMailHtml, toDetail } from "./content.server";
import { handleMailRequest } from "./http.server";
import { imapRaw } from "./imap.server";
import { flushMailPush, notifyMail } from "./push.server";
import { stopMailRuntime, syncAccount } from "./runtime.server";
import { accountQueue, sendMail } from "./service.server";
import { MailStore, mailStore, messageKey } from "./store.server";
import {
	canPreview,
	type MailAccount,
	type MailMessage,
	replyRecipients,
	sendSchema,
} from "./types";

let directory: string;
let oldEnv: NodeJS.ProcessEnv;
let account: MailAccount;
beforeEach(() => {
	oldEnv = { ...process.env };
	directory = mkdtempSync(join(tmpdir(), "orbit-mail-test-"));
	process.env.ORBIT_MAIL_DIR = directory;
	process.env.ORBIT_VAULT_DIR = directory;
	process.env.NODE_ENV = "test";
	process.env.ORBIT_MAIL_WORKER = "off";
	delete process.env.ORBIT_AUTH_USERNAME;
	delete process.env.ORBIT_AUTH_PASSWORD;
	delete process.env.ORBIT_MAIL_ENCRYPTION_KEY;
	process.env.ORBIT_GMAIL_CLIENT_ID = "test-client";
	process.env.ORBIT_GMAIL_CLIENT_SECRET = "test-secret";
	process.env.ORBIT_PUBLIC_URL = "https://orbit.example.com";
	delete process.env.ORBIT_GMAIL_PUBSUB_TOPIC;
	delete process.env.ORBIT_GMAIL_PUSH_EMAIL;
	account = {
		id: randomUUID(),
		email: "me@example.com",
		name: "Me",
		provider: "gmail",
		notifications: true,
		createdAt: Date.now(),
		lastSync: null,
		error: null,
	};
	mailStore().saveAccount(account, { refreshToken: "private-refresh-token" });
	mock.method(OAuth2Client.prototype, "getAccessToken", async () => ({
		token: "test-token",
	}));
	// Unit/integration tests must never reach a real provider.
	mock.method(globalThis, "fetch", async () => {
		throw new Error("Unexpected external request");
	});
});
afterEach(() => {
	stopMailRuntime();
	mock.restoreAll();
	mailStore().db.close();
	rmSync(directory, { recursive: true, force: true });
	process.env = oldEnv;
});
function message(): MailMessage {
	return {
		id: messageKey(account.id, "inbox", "123"),
		accountId: account.id,
		folder: "inbox",
		remoteId: "123",
		threadId: "thread-1",
		subject: "제안서",
		from: [{ name: "Sender", address: "sender@example.com" }],
		to: [{ name: "Me", address: account.email }],
		cc: [],
		date: Date.now(),
		unread: true,
		snippet: "hello",
		hasAttachments: true,
	};
}
function request(
	path: string,
	body?: unknown,
	headers: Record<string, string> = {},
) {
	return new Request(`http://localhost/api/mail/${path}`, {
		method: body === undefined ? "GET" : "POST",
		headers: {
			Origin: "http://localhost",
			"Content-Type": "application/json",
			...headers,
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}
function mockGmail(
	raw: Buffer,
	onSend?: (input: { raw: string; threadId: string }) => void,
) {
	mock.method(globalThis, "fetch", async (url: unknown, init?: RequestInit) => {
		const path = String(url);
		if (path.endsWith("messages/send")) {
			onSend?.(JSON.parse(String(init?.body)));
			return Response.json({ id: "sent" });
		}
		if (path.includes("format=minimal"))
			return Response.json({ sizeEstimate: raw.length });
		if (path.includes("format=raw"))
			return Response.json({ raw: raw.toString("base64url") });
		throw new Error(`Unexpected test path: ${path}`);
	});
}
async function originalRaw() {
	return new MailComposer({
		from: "Sender <sender@example.com>",
		to: account.email,
		replyTo: "reply@example.com",
		subject: "제안서",
		messageId: "<original@example.com>",
		text: "한글 본문",
		html: '<p>한글 본문</p><script>alert(1)</script><img src="https://tracking.example/open">',
		attachments: [{ filename: "문서.txt", content: Buffer.from("첨부 내용") }],
	})
		.compile()
		.build();
}

test("secrets and cached message content are encrypted; lost keys fail closed", () => {
	const s = mailStore();
	const m = message();
	s.saveMessages([m]);
	assert.equal(s.secret(account.id).refreshToken, "private-refresh-token");
	assert.equal(s.message(m.id).subject, "제안서");
	const row = s.db.prepare("SELECT secret FROM accounts").get() as {
		secret: string;
	};
	assert.ok(!row.secret.includes("private-refresh-token"));
	const cached = s.db.prepare("SELECT data FROM messages").get() as {
		data: string;
	};
	assert.ok(!cached.data.includes("제안서"));
	const modified = Buffer.from(row.secret, "base64");
	modified[modified.length - 1] ^= 1;
	assert.throws(() => s.unseal(modified.toString("base64")));
	assert.equal(readFileSync(join(directory, "secret.key")).length, 32);
	const missing = mkdtempSync(join(tmpdir(), "orbit-missing-key-"));
	const other = new MailStore(missing);
	other.db.close();
	rmSync(join(missing, "secret.key"));
	assert.throws(() => new MailStore(missing), /복원/);
	rmSync(missing, { recursive: true, force: true });
});
test("HTML sanitization blocks scripts, active content, tracking images and SVG", () => {
	const html = safeMailHtml(
		'<script>x</script><iframe src="https://evil.example"></iframe><form action="/api/mail/send"><input></form><img src="data:image/svg+xml;base64,PHN2Zz4=" onerror="x"><img src="https://tracking.example/x"><a href="javascript:alert(1)">x</a><p style="background-image:url(https://evil.example);color:red">safe</p>',
	);
	assert.doesNotMatch(
		html,
		/<script|<iframe|<form|<input|onerror|javascript:|tracking.example|evil.example|svg\+xml/,
	);
	assert.match(html, /color:red/);
	assert.match(
		safeMailHtml('<img src="https://images.example/a.png">', true),
		/https:\/\/images/,
	);
	assert.equal(canPreview("text/html"), false);
	assert.equal(canPreview("image/svg+xml"), false);
	assert.equal(canPreview("application/pdf"), true);
});
test("MIME decoding preserves Korean attachment bytes and reply-all excludes self and duplicates", async () => {
	const parsed = await parseMail(await originalRaw());
	assert.equal(parsed.attachments[0].content.toString(), "첨부 내용");
	const detail = toDetail(message(), parsed);
	assert.equal(detail.text, "한글 본문");
	assert.doesNotMatch(detail.html, /<script>/);
	detail.cc = [
		{ name: "", address: "other@example.com" },
		{ name: "", address: "reply@example.com" },
	];
	assert.deepEqual(replyRecipients(detail, account.email, true), {
		to: ["reply@example.com"],
		cc: ["other@example.com"],
	});
});
test("authenticated API denies unauthenticated and cross-origin requests and keeps response private", async () => {
	process.env.ORBIT_AUTH_USERNAME = "test";
	process.env.ORBIT_AUTH_PASSWORD = "test-password";
	const denied = await handleMailRequest(request("status"));
	assert.equal(denied.status, 401);
	const config = getOrbitAuthConfig();
	assert.ok(config.enabled);
	const token = createOrbitSessionToken(config);
	const response = await handleMailRequest(
		request("status", undefined, { Cookie: `orbit_session=${token}` }),
	);
	assert.equal(response.status, 200);
	assert.equal(response.headers.get("cache-control"), "no-store");
	assert.doesNotMatch(
		await response.text(),
		/private-refresh-token|test-secret/,
	);
	const csrf = await handleMailRequest(
		request(
			"account",
			{ id: account.id, remove: true },
			{ Cookie: `orbit_session=${token}`, Origin: "https://evil.example" },
		),
	);
	assert.equal(csrf.status, 400);
	assert.equal(mailStore().accounts().length, 1);
	const attachment = await handleMailRequest(
		request("attachment?message=anything&part=0"),
	);
	assert.equal(attachment.status, 401);
});
test("OAuth start uses PKCE and callback requires matching browser nonce; push rejects forged callbacks and SSRF endpoints", async () => {
	const start = await handleMailRequest(
		request("oauth/start", {}, { Origin: "https://orbit.example.com" }),
	);
	assert.equal(start.status, 200);
	const result = await start.json();
	const url = new URL(result.url);
	assert.equal(url.searchParams.get("code_challenge_method"), "S256");
	assert.ok(start.headers.get("set-cookie")?.includes("HttpOnly"));
	const callback = await handleMailRequest(
		request(
			`oauth/callback?state=${url.searchParams.get("state")}&code=invalid`,
		),
	);
	assert.equal(callback.status, 400);
	const push = await handleMailRequest(
		request("push/subscribe", {
			endpoint: "https://127.0.0.1/internal",
			keys: { p256dh: "a".repeat(87), auth: "a".repeat(22) },
		}),
	);
	assert.equal(push.status, 400);
	process.env.ORBIT_GMAIL_PUSH_EMAIL = "push@example.com";
	const forged = await handleMailRequest(
		request("gmail/push", { message: { data: "e30=" } }),
	);
	assert.equal(forged.status, 401);
});
test("Gmail reply sends correct thread, MIME reply headers, attachments and Bcc; repeated request sends once", async () => {
	const m = message();
	mailStore().saveMessages([m]);
	let count = 0;
	let sent: { raw: string; threadId: string } | undefined;
	mockGmail(await originalRaw(), (input) => {
		count++;
		sent = input;
	});
	const data = sendSchema.parse({
		accountId: account.id,
		requestId: randomUUID(),
		to: ["reply@example.com"],
		bcc: ["hidden@example.com"],
		subject: "Re: 제안서",
		text: "답장입니다",
		replyId: m.id,
		attachments: [
			{ name: "test.txt", content: Buffer.from("test").toString("base64") },
		],
	});
	assert.equal((await sendMail(data)).status, "sent");
	assert.equal((await sendMail(data)).status, "sent");
	assert.equal(count, 1);
	assert.ok(sent);
	assert.equal(sent.threadId, "thread-1");
	const parsed = await parseMail(Buffer.from(sent.raw, "base64url"));
	assert.equal(parsed.inReplyTo, "<original@example.com>");
	assert.equal(parsed.text, "답장입니다");
	assert.match(
		addresses(parsed.bcc)
			.map((a) => a.address)
			.join(","),
		/hidden@example.com/,
	);
	assert.equal(parsed.attachments[0].content.toString(), "test");
	await assert.rejects(
		() => sendMail({ ...data, text: "different" }),
		/다른 내용/,
	);
});
test("uncertain delivery is persisted across retries and process-level store reopen", async () => {
	let sends = 0;
	mock.method(globalThis, "fetch", async () => {
		sends++;
		throw new Error("socket lost after acceptance");
	});
	const data = sendSchema.parse({
		accountId: account.id,
		requestId: randomUUID(),
		to: ["a@example.com"],
		subject: "test",
		text: "body",
	});
	assert.equal((await sendMail(data)).status, "uncertain");
	assert.equal((await sendMail(data)).status, "uncertain");
	assert.equal(sends, 1);
	const reopened = new MailStore(directory);
	assert.equal(
		(
			reopened.db
				.prepare("SELECT result FROM sends WHERE id=?")
				.get(data.requestId) as { result: string }
		).result.includes("uncertain"),
		true,
	);
	reopened.db.close();
});
test("SMTP raw message does not disclose Bcc; sent-folder failure does not report send failure", async () => {
	account = { ...account, provider: "naver" };
	mailStore().saveAccount(account, { password: "app-password" });
	let sentRaw: Buffer = Buffer.alloc(0);
	let envelope: unknown;
	mock.method(nodemailer, "createTransport", () => ({
		sendMail: async (value: { raw: Buffer; envelope: unknown }) => {
			sentRaw = value.raw;
			envelope = value.envelope;
			return { accepted: ["a@example.com"], rejected: [] };
		},
	}));
	mock.method(ImapFlow.prototype, "connect", async () => {
		throw new Error("offline");
	});
	mock.method(ImapFlow.prototype, "logout", async () => {});
	const result = await sendMail(
		sendSchema.parse({
			accountId: account.id,
			requestId: randomUUID(),
			to: ["a@example.com"],
			bcc: ["hidden@example.com"],
			subject: "test",
			text: "body",
		}),
	);
	assert.equal(result.status, "sent");
	assert.match(result.warning || "", /사본/);
	assert.doesNotMatch(sentRaw.toString(), /^Bcc:/im);
	assert.deepEqual(envelope, {
		from: account.email,
		to: ["a@example.com", "hidden@example.com"],
	});
});
test("IMAP UIDVALIDITY change prevents fetching the wrong message", async () => {
	account = { ...account, provider: "icloud" };
	mailStore().saveAccount(account, { password: "app-password" });
	mock.method(ImapFlow.prototype, "connect", async () => {});
	mock.method(ImapFlow.prototype, "logout", async () => {});
	let released = false;
	mock.method(
		ImapFlow.prototype,
		"getMailboxLock",
		async function (this: ImapFlow) {
			this.mailbox = { uidValidity: 2n } as Exclude<ImapFlow["mailbox"], false>;
			return {
				release: () => {
					released = true;
				},
			};
		},
	);
	await assert.rejects(
		() =>
			imapRaw(account, {
				...message(),
				mailbox: "INBOX",
				uidValidity: "1",
				remoteId: "1:123",
			}),
		/메일함이 변경/,
	);
	assert.ok(released);
});
test("drafts accept incomplete recipients, reject stale writes, and account deletion removes cached data", async () => {
	const draftId = randomUUID();
	const value = {
		accountId: account.id,
		to: [],
		cc: [],
		bcc: [],
		subject: "",
		text: "작성 중",
		attachments: [],
	};
	assert.equal(
		(
			await handleMailRequest(
				request("draft", { id: draftId, revision: 1, value }),
			)
		).status,
		200,
	);
	assert.equal(
		(
			await handleMailRequest(
				request("draft", {
					id: draftId,
					revision: 1,
					value: { ...value, text: "stale" },
				}),
			)
		).status,
		409,
	);
	const read = await handleMailRequest(request(`draft?id=${draftId}`));
	assert.equal((await read.json()).value.text, "작성 중");
	const m = message();
	mailStore().saveMessages([m]);
	mailStore().markSeen(account.id, m.remoteId);
	mailStore().removeAccount(account.id);
	assert.equal(mailStore().messages().length, 0);
	assert.equal(mailStore().db.prepare("SELECT * FROM seen").all().length, 0);
});
test("initial sync establishes a notification baseline; repeated sync does not rediscover the same message", async () => {
	const m = message();
	mock.method(globalThis, "fetch", async (url: unknown) =>
		String(url).includes("format=metadata")
			? Response.json({
					id: m.remoteId,
					threadId: "t",
					internalDate: String(m.date),
					labelIds: ["INBOX", "UNREAD"],
					payload: {
						headers: [
							{ name: "From", value: "sender@example.com" },
							{ name: "Subject", value: "test" },
						],
					},
				})
			: Response.json({ messages: [{ id: m.remoteId }] }),
	);
	await syncAccount(account.id);
	assert.ok(mailStore().account(account.id).lastSync);
	assert.equal(mailStore().db.prepare("SELECT * FROM seen").all().length, 1);
	await syncAccount(account.id);
	assert.equal(mailStore().db.prepare("SELECT * FROM seen").all().length, 1);
	assert.equal(mailStore().account(account.id).error, null);
});
test("per-account queue serializes mutations and continues after a failure", async () => {
	const order: string[] = [];
	const a = accountQueue("queue", async () => {
		order.push("a");
		await new Promise((resolve) => setTimeout(resolve, 10));
		order.push("b");
		throw new Error("test");
	});
	const b = accountQueue("queue", async () => {
		order.push("c");
		return true;
	});
	await assert.rejects(a);
	assert.equal(await b, true);
	assert.deepEqual(order, ["a", "b", "c"]);
});

test("forward includes original attachment bytes without attaching reply thread headers", async () => {
	const m = message();
	mailStore().saveMessages([m]);
	let sentRaw = "";
	mockGmail(await originalRaw(), (r) => {
		sentRaw = r.raw;
		assert.equal(r.threadId, undefined);
	});
	const result = await sendMail(
		sendSchema.parse({
			accountId: account.id,
			requestId: randomUUID(),
			to: ["forward@example.com"],
			subject: "Fwd: 제안서",
			text: "전달합니다",
			forwardId: m.id,
		}),
	);
	assert.equal(result.status, "sent");
	const parsed = await parseMail(Buffer.from(sentRaw, "base64url"));
	assert.equal(parsed.attachments[0].content.toString(), "첨부 내용");
	assert.equal(parsed.inReplyTo, undefined);
});

test("attachment endpoint preserves exact bytes and prevents HTML attachment execution", async () => {
	const m = message();
	mailStore().saveMessages([m]);
	mockGmail(await originalRaw());
	const response = await handleMailRequest(
		request(`attachment?message=${m.id}&part=0`),
	);
	assert.equal(response.status, 200);
	assert.equal(await response.text(), "첨부 내용");
	assert.match(response.headers.get("content-disposition") || "", /^inline/);
	assert.equal(response.headers.get("cache-control"), "no-store");
	const raw = await new MailComposer({
		from: "a@example.com",
		to: account.email,
		text: "body",
		attachments: [
			{
				filename: "attack.html",
				content: "<script>alert(1)</script>",
				contentType: "text/html",
			},
		],
	})
		.compile()
		.build();
	mockGmail(raw);
	const unsafe = await handleMailRequest(
		request(`attachment?message=${m.id}&part=0`),
	);
	assert.match(unsafe.headers.get("content-disposition") || "", /^attachment/);
	assert.equal(unsafe.headers.get("content-type"), "application/octet-stream");
});

test("Web Push retries transient failures durably, uses sender/subject, and removes expired subscriptions", async () => {
	const s = mailStore();
	const sub = {
		endpoint: "https://fcm.googleapis.com/fcm/send/test",
		keys: { p256dh: "a".repeat(87), auth: "a".repeat(22) },
	};
	s.addSubscription(sub, sub.endpoint);
	let calls = 0;
	let lastPayload = "";
	mock.method(
		webpush,
		"sendNotification",
		async (_sub: unknown, payload: string) => {
			calls++;
			lastPayload = payload;
			if (calls === 1) throw new Error("temporary network failure");
			return { statusCode: 201, headers: {}, body: "" };
		},
	);
	await notifyMail(account, [message()]);
	assert.equal(s.db.prepare("SELECT * FROM push_jobs").all().length, 1);
	assert.equal(JSON.parse(lastPayload).title, "Sender");
	assert.equal(JSON.parse(lastPayload).body, "제안서");
	s.db.prepare("UPDATE push_jobs SET next_at=0").run();
	await flushMailPush();
	assert.equal(calls, 2);
	assert.equal(s.db.prepare("SELECT * FROM push_jobs").all().length, 0);
	mock.method(webpush, "sendNotification", async () => {
		throw new webpush.WebPushError("gone", 410, {}, "", sub.endpoint);
	});
	await notifyMail(account, [{ ...message(), remoteId: "next" }]);
	assert.equal(s.subscriptions().length, 0);
});
test("expired Orbit sessions cannot continue receiving private mail notifications", async () => {
	const s = mailStore();
	process.env.ORBIT_AUTH_USERNAME = "test";
	process.env.ORBIT_AUTH_PASSWORD = "test-password";
	s.addSubscription(
		{
			endpoint: "https://fcm.googleapis.com/fcm/send/test",
			keys: { p256dh: "a".repeat(87), auth: "a".repeat(22) },
			session: "expired",
		},
		"https://fcm.googleapis.com/fcm/send/test",
	);
	let calls = 0;
	mock.method(webpush, "sendNotification", async () => {
		calls++;
		return { statusCode: 201, headers: {}, body: "" };
	});
	await notifyMail(account, [message()]);
	assert.equal(calls, 0);
	assert.equal(s.subscriptions().length, 0);
});

test("body opens share a provider request, cache encrypted variants, and preserve current read state", async () => {
	const { detailMessage } = await import("./service.server");
	const s = mailStore();
	const m = message();
	s.saveMessages([m]);
	mockGmail(await originalRaw());
	const [hidden, visible] = await Promise.all([
		detailMessage(m.id),
		detailMessage(m.id, true),
	]);
	assert.equal(hidden.text.trim(), "한글 본문");
	assert.doesNotMatch(hidden.html, /src="https:\/\/tracking/);
	assert.match(visible.html, /src="https:\/\/tracking/);
	const row = s.db.prepare("SELECT data FROM bodies WHERE id=?").get(m.id) as {
		data: string;
	};
	assert.doesNotMatch(row.data, /한글|tracking|Sender/);
	// Reopening remains available with the provider offline and reflects read mutations.
	mock.method(globalThis, "fetch", async () => {
		throw new Error("offline");
	});
	s.saveMessages([{ ...m, unread: false, snippet: "" }]);
	assert.equal((await detailMessage(m.id)).unread, false);
	assert.equal((await detailMessage(m.id, true)).html, visible.html);
	assert.match(s.message(m.id).snippet, /한글 본문/);
	s.deleteMessage(m.id);
	assert.equal(
		s.db.prepare("SELECT COUNT(*) AS count FROM bodies").get()?.count,
		0,
	);
	await assert.rejects(() => detailMessage(m.id), /메일을 찾을 수 없습니다/);
});

test("IMAP first page fetches a bounded sequence window and reuses its connection", async () => {
	const { listImap } = await import("./imap.server");
	account = { ...account, provider: "icloud" };
	mailStore().saveAccount(account, { password: "app-password" });
	let connects = 0;
	mock.method(ImapFlow.prototype, "connect", async function (this: ImapFlow) {
		connects++;
		Object.defineProperty(this, "usable", { value: true, configurable: true });
	});
	mock.method(
		ImapFlow.prototype,
		"getMailboxLock",
		async function (this: ImapFlow) {
			this.mailbox = { uidValidity: 7n, exists: 10_000 } as Exclude<
				ImapFlow["mailbox"],
				false
			>;
			return { release() {} };
		},
	);
	mock.method(ImapFlow.prototype, "search", async () => {
		throw new Error("must not search every UID");
	});
	mock.method(ImapFlow.prototype, "fetchAll", async (range: unknown) => {
		assert.equal(range, "9951:10000");
		return [
			{
				uid: 12_345,
				envelope: {
					subject: "답장",
					messageId: "<reply@example.com>",
					inReplyTo: "<root@example.com>",
				},
				headers: Buffer.from(
					"References: <root@example.com>\r\n <prior@example.com>",
				),
				flags: new Set(),
				internalDate: new Date(),
			},
		];
	});
	const page = await listImap(account, "inbox");
	assert.equal(page.cursor, "7:12345");
	assert.deepEqual(page.messages[0].references, [
		"<root@example.com>",
		"<prior@example.com>",
	]);
	await listImap(account, "inbox");
	assert.equal(connects, 1);
});

test("a slow IMAP list does not block opening a body", async () => {
	const { usingImap } = await import("./imap.server");
	account = { ...account, provider: "icloud" };
	mailStore().saveAccount(account, { password: "app-password" });
	mock.method(ImapFlow.prototype, "connect", async function (this: ImapFlow) {
		Object.defineProperty(this, "usable", { value: true, configurable: true });
	});
	let release = () => {};
	const waiting = new Promise<void>((resolve) => {
		release = resolve;
	});
	const list = usingImap(account, () => waiting);
	try {
		assert.equal(
			await usingImap(account, async () => "body ready", "body"),
			"body ready",
		);
	} finally {
		release();
		await list;
	}
});

test("conversation references connect inbox and sent replies but isolate accounts and repeated subjects", async () => {
	const { conversations, relatedMessages } = await import("./conversations");
	const root = { ...message(), threadId: undefined, messageId: "<root>" };
	const reply = {
		...root,
		id: "reply",
		remoteId: "reply",
		messageId: "<reply>",
		references: ["<root>"],
		folder: "sent" as const,
		date: root.date + 1,
	};
	const later = {
		...reply,
		id: "later",
		remoteId: "later",
		messageId: "<later>",
		references: ["<reply>"],
		date: root.date + 2,
	};
	const unrelated = {
		...root,
		id: "other",
		remoteId: "other",
		messageId: "<other>",
	};
	const otherAccount = { ...reply, id: "other-account", accountId: "another" };
	assert.equal(
		conversations([later, unrelated, root, reply, otherAccount]).length,
		3,
	);
	assert.deepEqual(
		relatedMessages(root, [later, reply, unrelated]).map((m) => m.id),
		["later", "reply", root.id],
	);
	mailStore().saveMessages([root, reply, later, unrelated]);
	const result = await handleMailRequest(request(`conversation?id=${root.id}`));
	const data = await result.json();
	assert.equal(data.messages.length, 3);
	assert.equal(data.messages[0].id, root.id);
});

test("cached search includes recipients and cc with Korean text", () => {
	const s = mailStore();
	s.saveMessages([
		{
			...message(),
			to: [{ name: "개발팀", address: "team@example.com" }],
			cc: [{ name: "검토자", address: "review@example.com" }],
		},
	]);
	assert.equal(s.messages(account.id, "inbox", "개발팀").length, 1);
	assert.equal(s.messages(account.id, "inbox", "REVIEW@example.com").length, 1);
});

test("Gmail conversation retrieves sent replies even when the subject changed", async () => {
	const { conversationMessages } = await import("./service.server");
	const original = message();
	mailStore().saveMessages([original]);
	let calls = 0;
	mock.method(globalThis, "fetch", async (url: unknown) => {
		assert.match(String(url), /threads\/thread-1\?format=metadata$/);
		calls++;
		return Response.json({
			messages: [
				{
					id: "123",
					threadId: "thread-1",
					labelIds: ["INBOX"],
					internalDate: "100",
					payload: {
						headers: [
							{ name: "Subject", value: "제안서" },
							{ name: "Message-ID", value: "<original>" },
						],
					},
				},
				{
					id: "sent-reply",
					threadId: "thread-1",
					labelIds: ["SENT"],
					internalDate: "200",
					payload: {
						headers: [
							{ name: "Subject", value: "수정된 제안" },
							{ name: "Message-ID", value: "<reply>" },
							{ name: "In-Reply-To", value: "<original>" },
						],
					},
				},
			],
		});
	});
	const result = await conversationMessages(original.id, true);
	assert.equal(result.messages.length, 2);
	assert.equal(result.messages[1].folder, "sent");
	assert.equal(result.messages[1].subject, "수정된 제안");
	const again = await conversationMessages(result.messages[1].id, true);
	assert.equal(again.messages.length, 2);
	assert.equal(calls, 1);
});

test("HTML layout keeps safe newsletter styles and isolates its trusted resize script", async () => {
	const parsed = await parseMail(
		await new MailComposer({
			from: account.email,
			to: "reader@example.com",
			subject: "Newsletter",
			html: '<table width="640" cellpadding="24" style="max-width:640px;margin:0 auto;border-collapse:collapse"><tr><td style="padding:24px;font-family:Georgia,serif"><img src="cid:photo"><img src="https://images.example/a.jpg" onload="evil()"><script>evil()</script></td></tr></table>',
			attachments: [
				{
					filename: "inline.png",
					content: Buffer.from("image"),
					cid: "photo",
					contentDisposition: "inline",
				},
				{ filename: "notes.txt", content: Buffer.from("notes") },
			],
		})
			.compile()
			.build(),
	);
	const visible = toDetail(message(), parsed, true);
	const hidden = toDetail(message(), parsed, false);
	assert.match(visible.html, /max-width:640px/);
	assert.match(visible.html, /cellpadding="24"/);
	assert.match(visible.html, /data:image\/png;base64,/);
	assert.match(visible.html, /https:\/\/images.example\/a.jpg/);
	assert.doesNotMatch(hidden.html, /https:\/\/images.example\/a.jpg/);
	assert.equal(visible.hasRemoteImages, true);
	assert.equal(hidden.hasRemoteImages, true);
	assert.doesNotMatch(visible.html, /evil\(\)|onload=/);
	const nonce = visible.html.match(/script-src 'nonce-([^']+)'/)?.[1];
	assert.ok(nonce);
	assert.ok(visible.html.includes(`<script nonce="${nonce}">`));
	assert.equal((visible.html.match(/<script /g) || []).length, 1);
	assert.deepEqual(
		visible.attachments.map((a) => [a.id, a.name]),
		[["1", "notes.txt"]],
	);
});

test("demo mailbox supports accounts, HTML, search, conversations and simulated send without changing real mail", async () => {
	const smtp = mock.method(nodemailer, "createTransport", () => {
		throw new Error("Demo must never use SMTP");
	});
	const call = async (path: string, body?: unknown) => {
		const response = await handleMailRequest(request(`demo/${path}`, body));
		assert.equal(response.status, 200, path);
		return response.json();
	};
	await call("reset", {});
	const status = await call("status");
	assert.equal(status.accounts.length, 2);
	assert.ok(status.accounts.every((a: MailAccount) => a.provider === "icloud"));
	const inbox = await call("messages?folder=inbox");
	assert.equal(inbox.messages.length, 7);
	const newsletter = await call("message?id=demo-newsletter");
	assert.match(newsletter.html, /data:image\/jpeg;base64,/);
	assert.equal(newsletter.attachments.length, 0);
	const search = await call(`messages?q=${encodeURIComponent("목요일")}`);
	assert.equal(search.messages.length, 1);
	const personal = await call(`messages?account=${status.accounts[0].id}`);
	assert.equal(personal.messages.length, 3);
	const thread = await call("conversation?id=demo-review-latest");
	assert.equal(thread.messages.length, 3);
	assert.ok(thread.messages.some((m: MailMessage) => m.folder === "sent"));
	const attachment = await handleMailRequest(
		request("demo/attachment?message=demo-review-latest&part=0"),
	);
	assert.match(await attachment.text(), /프로젝트 검토사항/);
	const requestId = randomUUID();
	const payload = {
		requestId,
		accountId: status.accounts[1].id,
		to: ["recipient@example.com"],
		cc: [],
		bcc: [],
		subject: "Demo reply",
		text: "데모 답장",
		attachments: [],
		replyId: "demo-review-latest",
	};
	const result = await call("send", payload);
	assert.equal(result.status, "sent");
	assert.match(result.warning, /실제로 발송하지/);
	await call("send", payload);
	const sent = await call("messages?folder=sent");
	assert.equal(sent.messages.length, 2);
	assert.equal(
		(await call("conversation?id=demo-review-latest")).messages.length,
		4,
	);
	assert.equal(smtp.mock.callCount(), 0);
	assert.deepEqual(
		mailStore()
			.accounts()
			.map((a) => a.id),
		[account.id],
	);
	assert.equal(
		(
			mailStore()
				.db.prepare("SELECT COUNT(*) AS count FROM messages")
				.get() as { count: number }
		).count,
		0,
	);
	await call("reset", {});
});

test("iCloud identities persist, validate the default sender and survive notification edits", async () => {
	account = { ...account, provider: "icloud" };
	mailStore().saveAccount(account, { password: "app-password" });
	const response = await handleMailRequest(
		request("account", {
			id: account.id,
			aliases: ["WORK@company.com", "work@company.com", account.email],
			defaultFrom: "WORK@company.com",
		}),
	);
	assert.equal(response.status, 200);
	assert.deepEqual(mailStore().account(account.id).aliases, [
		"work@company.com",
	]);
	assert.equal(mailStore().account(account.id).defaultFrom, "work@company.com");
	assert.equal(
		(
			await handleMailRequest(
				request("account", { id: account.id, notifications: false }),
			)
		).status,
		200,
	);
	assert.deepEqual(mailStore().account(account.id).aliases, [
		"work@company.com",
	]);
	assert.equal(
		(
			await handleMailRequest(
				request("account", {
					id: account.id,
					defaultFrom: "unregistered@example.com",
				}),
			)
		).status,
		400,
	);
	assert.equal(
		(
			await handleMailRequest(
				request("account", { id: account.id, aliases: [] }),
			)
		).status,
		200,
	);
	assert.equal(mailStore().account(account.id).defaultFrom, account.email);
});

test("alias sender reaches MIME and SMTP envelope while authentication keeps the primary account", async () => {
	account = { ...account, provider: "icloud", aliases: ["work@company.com"] };
	mailStore().saveAccount(account, { password: "app-password" });
	let raw: Buffer = Buffer.alloc(0);
	let envelope: unknown;
	const transport = mock.method(
		nodemailer,
		"createTransport",
		(options: unknown) => {
			assert.deepEqual((options as { auth: unknown }).auth, {
				user: account.email,
				pass: "app-password",
			});
			return {
				sendMail: async (value: { raw: Buffer; envelope: unknown }) => {
					raw = value.raw;
					envelope = value.envelope;
					return { accepted: ["recipient@example.com"], rejected: [] };
				},
			};
		},
	);
	mock.method(ImapFlow.prototype, "connect", async () => {
		throw new Error("offline");
	});
	const data = sendSchema.parse({
		accountId: account.id,
		from: "work@company.com",
		requestId: randomUUID(),
		to: ["recipient@example.com"],
		subject: "Alias",
		text: "Body",
	});
	assert.equal((await sendMail(data)).status, "sent");
	assert.equal(
		(await parseMail(raw)).from?.value[0].address,
		"work@company.com",
	);
	assert.deepEqual(envelope, {
		from: "work@company.com",
		to: ["recipient@example.com"],
	});
	assert.equal((await sendMail(data)).status, "sent");
	assert.equal(transport.mock.callCount(), 1);
	await assert.rejects(
		() =>
			sendMail({ ...data, requestId: randomUUID(), from: "spoof@example.com" }),
		/등록된 발신 주소/,
	);
	assert.equal(transport.mock.callCount(), 1);
});

test("address-filtered IMAP searches old mail, preserves unrelated cache, and keeps pagination after exact matching", async () => {
	const { listRemote } = await import("./service.server");
	account = { ...account, provider: "icloud", aliases: ["work@company.com"] };
	mailStore().saveAccount(account, { password: "app-password" });
	const unrelated = {
		...message(),
		uidValidity: "7",
		remoteId: "7:9000",
		mailbox: "INBOX",
	};
	mailStore().saveMessages([unrelated]);
	mock.method(ImapFlow.prototype, "connect", async function (this: ImapFlow) {
		Object.defineProperty(this, "usable", { value: true, configurable: true });
	});
	mock.method(
		ImapFlow.prototype,
		"getMailboxLock",
		async function (this: ImapFlow) {
			this.mailbox = { uidValidity: 7n, exists: 10000 } as Exclude<
				ImapFlow["mailbox"],
				false
			>;
			return { release() {} };
		},
	);
	const search = mock.method(
		ImapFlow.prototype,
		"search",
		async (criteria: unknown) => {
			assert.match(JSON.stringify(criteria), /work@company.com/);
			assert.match(JSON.stringify(criteria), /proposal/);
			return Array.from({ length: 60 }, (_, i) => i + 1);
		},
	);
	mock.method(ImapFlow.prototype, "fetchAll", async (range: number[]) =>
		range.map((uid) => ({
			uid,
			envelope: {
				from: [{ address: "sender@example.com" }],
				to: [
					{ address: uid === 60 ? "notwork@company.com" : "work@company.com" },
				],
				subject: "proposal",
			},
			headers: Buffer.from(
				`References: <root@example.com>\r\nX-Original-To: <${uid === 60 ? "notwork@company.com" : "work@company.com"}>`,
			),
			flags: new Set(),
			internalDate: new Date(uid * 1000),
		})),
	);
	const page = await listRemote(account, "inbox", undefined, "proposal", [
		"work@company.com",
	]);
	assert.equal(search.mock.callCount(), 1);
	assert.equal(page.cursor, "7:11");
	assert.equal(page.messages.length, 49); // Substring search candidates are checked against exact addresses.
	assert.deepEqual(page.messages[0].references, ["<root@example.com>"]);
	assert.equal(mailStore().message(unrelated.id).id, unrelated.id);
	const cached = await handleMailRequest(
		request(`messages?account=${account.id}&address=work%40company.com`),
	);
	const json = await cached.json();
	assert.equal(json.messages.length, 49);
	assert.ok(!json.messages.some((m: MailMessage) => m.id === unrelated.id));
	assert.equal(
		(
			await handleMailRequest(
				request(`messages?account=${account.id}&address=unknown%40company.com`),
			)
		).status,
		400,
	);
});

test("draft storage keeps the selected alias", async () => {
	const draftId = randomUUID();
	const value = {
		accountId: account.id,
		from: "work@company.com",
		to: [],
		cc: [],
		bcc: [],
		subject: "",
		text: "",
		attachments: [],
	};
	assert.equal(
		(
			await handleMailRequest(
				request("draft", { id: draftId, revision: 1, value }),
			)
		).status,
		200,
	);
	assert.equal(
		(await (await handleMailRequest(request(`draft?id=${draftId}`))).json())
			.value.from,
		"work@company.com",
	);
});

test("demo aliases support settings and simulated sending without touching real accounts", async () => {
	const call = async (path: string, body?: unknown) => {
		const response = await handleMailRequest(request(`demo/${path}`, body));
		assert.equal(response.status, 200);
		return response.json();
	};
	await call("reset", {});
	const initial = await call("status");
	const id = initial.accounts[0].id;
	await call("account", {
		id,
		aliases: ["hello@mina.design", "work@mina.studio", "news@mina.example"],
		defaultFrom: "work@mina.studio",
	});
	assert.equal(
		(await call("status")).accounts[0].defaultFrom,
		"work@mina.studio",
	);
	const inbox = await call(`messages?account=${id}&address=work%40mina.studio`);
	assert.deepEqual(
		inbox.messages.map((m: MailMessage) => m.id),
		["demo-photo"],
	);
	await call("send", {
		accountId: id,
		requestId: randomUUID(),
		from: "news@mina.example",
		to: ["recipient@example.com"],
		text: "Body",
		subject: "Alias demo",
	});
	const sent = await call(
		`messages?account=${id}&folder=sent&address=news%40mina.example`,
	);
	assert.equal(sent.messages.length, 1);
	assert.equal(sent.messages[0].from[0].address, "news@mina.example");
	assert.deepEqual(mailStore().account(account.id).aliases, undefined);
});

test("spam actions modify Gmail labels and restore inbox without retaining a sender block", async () => {
	const { mutateMessage } = await import("./service.server");
	const s = mailStore();
	const m = message();
	s.saveMessages([m, { ...m, id: "cached-sent-view", folder: "sent" }]);
	const bodies: unknown[] = [];
	mock.method(globalThis, "fetch", async (url: unknown, init?: RequestInit) => {
		assert.match(String(url), /messages\/123\/modify$/);
		bodies.push(JSON.parse(String(init?.body)));
		return Response.json({});
	});
	await mutateMessage(m.id, "block");
	assert.deepEqual(bodies[0], {
		addLabelIds: ["SPAM"],
		removeLabelIds: ["INBOX", "TRASH"],
	});
	assert.deepEqual(s.blockedSenders(), [
		{ accountId: account.id, address: "sender@example.com" },
	]);
	assert.equal(s.messages(account.id, "inbox").length, 0);
	assert.equal(s.messages(account.id, "sent").length, 0);
	s.saveMessages([{ ...m, folder: "spam" }]);
	await mutateMessage(m.id, "inbox");
	assert.deepEqual(bodies[1], {
		addLabelIds: ["INBOX"],
		removeLabelIds: ["SPAM", "TRASH"],
	});
	assert.deepEqual(s.blockedSenders(), []);
});

test("failed provider block preserves the original message and does not save a rule", async () => {
	const { mutateMessage } = await import("./service.server");
	const m = message();
	mailStore().saveMessages([m]);
	mock.method(globalThis, "fetch", async () =>
		Response.json({ error: "unavailable" }, { status: 400 }),
	);
	await assert.rejects(() => mutateMessage(m.id, "block"));
	assert.deepEqual(mailStore().blockedSenders(), []);
	assert.equal(mailStore().message(m.id).folder, "inbox");
	mailStore().saveMessages([
		{ ...m, from: [{ name: "Me", address: account.email }] },
	]);
	await assert.rejects(() => mutateMessage(m.id, "block"), /내 주소/);
});

test("sender rules are normalized, encrypted, scoped to each account, and removed with an account", () => {
	const s = mailStore();
	const other = { ...account, id: randomUUID(), email: "second@example.com" };
	s.saveAccount(other, { refreshToken: "test" });
	s.setBlocked(account.id, " Sender@Example.com ", true);
	s.setBlocked(other.id, "sender@example.com", true);
	assert.equal(s.blockedSenders(account.id).length, 1);
	const rows = s.db.prepare("SELECT data FROM blocked_senders").all();
	assert.ok(
		rows.every((row) => !String(row.data).includes("sender@example.com")),
	);
	s.setBlocked(account.id, "SENDER@example.com", false);
	assert.equal(s.blockedSenders(account.id).length, 0);
	assert.equal(s.blockedSenders(other.id).length, 1);
	s.removeAccount(other.id);
	assert.deepEqual(s.blockedSenders(), []);
});

test("inbox sync moves blocked senders before caching and never queues a new-mail notification", async () => {
	const s = mailStore();
	const m = message();
	s.saveMessages([m]);
	s.setBlocked(account.id, "sender@example.com", true);
	s.setSetting(`baseline:${account.id}`, Date.now() - 10000);
	let moves = 0;
	mock.method(globalThis, "fetch", async (url: unknown, init?: RequestInit) => {
		const path = String(url);
		if (path.includes("messages?"))
			return Response.json({ messages: [{ id: "123" }] });
		if (path.includes("format=metadata"))
			return Response.json({
				id: "123",
				internalDate: String(Date.now()),
				labelIds: ["INBOX", "UNREAD"],
				payload: {
					headers: [{ name: "From", value: "Sender <SENDER@example.com>" }],
				},
			});
		if (path.endsWith("/modify")) {
			moves++;
			assert.deepEqual(JSON.parse(String(init?.body)).addLabelIds, ["SPAM"]);
			return Response.json({});
		}
		throw new Error(`Unexpected URL: ${path}`);
	});
	s.addSubscription(
		{
			endpoint: "https://fcm.googleapis.com/fcm/send/blocked",
			keys: { p256dh: "a".repeat(87), auth: "a".repeat(22) },
		},
		"blocked",
	);
	const notify = mock.method(webpush, "sendNotification", async () => ({
		statusCode: 201,
		headers: {},
		body: "",
	}));
	await syncAccount(account.id);
	assert.equal(moves, 1);
	assert.equal(s.messages(account.id, "inbox").length, 0);
	assert.equal(notify.mock.callCount(), 0);
	assert.equal(s.account(account.id).error, null);
});

test("spam listing includes Gmail spam and trash and spam links retain the folder", async () => {
	const { listGmail } = await import("./gmail.server");
	const { mailSearch } = await import("../orbit/navigation-search");
	mock.method(globalThis, "fetch", async (url: unknown) => {
		const params = new URL(String(url)).searchParams;
		assert.equal(params.get("q")?.trim(), "in:spam");
		assert.equal(params.get("includeSpamTrash"), "true");
		return Response.json({ messages: [] });
	});
	await listGmail(account, "spam");
	assert.equal(mailSearch({ folder: "spam" }).folder, "spam");
});

test("IMAP spam actions use the provider junk mailbox and restore with a UID move", async () => {
	const { mutateImap, findMailbox } = await import("./imap.server");
	account = { ...account, provider: "icloud" };
	mailStore().saveAccount(account, { password: "test" });
	mock.method(ImapFlow.prototype, "connect", async function (this: ImapFlow) {
		Object.defineProperty(this, "usable", { value: true, configurable: true });
	});
	mock.method(ImapFlow.prototype, "list", async () => [
		{ path: "Localized/Junk", name: "Custom", specialUse: "\\Junk" },
	]);
	mock.method(
		ImapFlow.prototype,
		"getMailboxLock",
		async function (this: ImapFlow) {
			this.mailbox = { uidValidity: 7n } as Exclude<ImapFlow["mailbox"], false>;
			return { release() {} };
		},
	);
	const moves: string[] = [];
	mock.method(
		ImapFlow.prototype,
		"messageMove",
		async (uid: string, destination: string, opts: unknown) => {
			assert.equal(uid, "42");
			assert.deepEqual(opts, { uid: true });
			moves.push(destination);
			return true;
		},
	);
	const m = {
		...message(),
		remoteId: "7:42",
		mailbox: "INBOX",
		uidValidity: "7",
	};
	await mutateImap(account, m, "spam");
	await mutateImap(
		account,
		{ ...m, folder: "spam", mailbox: "Localized/Junk" },
		"inbox",
	);
	assert.deepEqual(moves, ["Localized/Junk", "INBOX"]);
	const client = new ImapFlow({
		host: "localhost",
		port: 993,
		auth: { user: "test", pass: "test" },
		logger: false,
	});
	mock.method(client, "list", async () => [
		{ name: "스팸메일함", path: "Spam" },
	]);
	assert.equal(await findMailbox(client, "spam"), "Spam");
	mock.method(client, "list", async () => []);
	await assert.rejects(() => findMailbox(client, "spam"), /스팸함/);
});

test("demo supports spam, block, unblock and restore through the same HTTP contract", async () => {
	const list = await (
		await handleMailRequest(request("demo/messages?folder=inbox"))
	).json();
	const m = list.messages[0];
	assert.ok(m);
	assert.equal(
		(
			await handleMailRequest(
				request("demo/action", { id: m.id, action: "block" }),
			)
		).status,
		200,
	);
	const status = await (await handleMailRequest(request("demo/status"))).json();
	assert.ok(
		status.blockedSenders.some(
			(rule: { accountId: string }) => rule.accountId === m.accountId,
		),
	);
	const spam = await (
		await handleMailRequest(request("demo/messages?folder=spam"))
	).json();
	assert.ok(spam.messages.some((entry: MailMessage) => entry.id === m.id));
	assert.equal(
		(
			await handleMailRequest(
				request("demo/action", { id: m.id, action: "inbox" }),
			)
		).status,
		200,
	);
	const restored = await (
		await handleMailRequest(request("demo/messages?folder=inbox"))
	).json();
	assert.ok(restored.messages.some((entry: MailMessage) => entry.id === m.id));
});
