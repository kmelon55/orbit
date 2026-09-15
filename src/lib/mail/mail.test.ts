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
