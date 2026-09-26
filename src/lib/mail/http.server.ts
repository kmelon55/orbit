import { createHash, randomBytes, randomUUID } from "node:crypto";
import { CodeChallengeMethod, OAuth2Client } from "google-auth-library";
import type { PushSubscription } from "web-push";
import { z } from "zod";
import {
	getOrbitAuthConfig,
	verifyOrbitSessionToken,
} from "../orbit/auth.server";
import { mailConfig } from "./config.server";
import { demoMailRequest } from "./demo.server";
import { clearGmailToken, gmailConfigured, oauthClient } from "./gmail.server";
import { accountAddresses, aliasesSchema, matchesAddress } from "./identities";
import {
	pushConfigured,
	pushKeys,
	sendPush,
	subscriptionSchema,
} from "./push.server";
import { startMailRuntime, stopAccount, syncAccount } from "./runtime.server";
import {
	accountQueue,
	connectImap,
	conversationMessages,
	detailMessage,
	listRemote,
	mutateMessage,
	publicError,
	rawMessage,
	sendMail,
} from "./service.server";
import { mailStore } from "./store.server";
import {
	canPreview,
	folderSchema,
	type MailAccount,
	type MailStatus,
	mailActionSchema,
	sendSchema,
} from "./types";

const privateHeaders = {
	"Cache-Control": "no-store",
	Vary: "Cookie",
	"X-Content-Type-Options": "nosniff",
	"Referrer-Policy": "no-referrer",
};
function json(value: unknown, status = 200) {
	return Response.json(value, { status, headers: privateHeaders });
}
function cookie(request: Request, name: string) {
	return request.headers
		.get("cookie")
		?.split(";")
		.map((s) => s.trim())
		.find((s) => s.startsWith(`${name}=`))
		?.slice(name.length + 1);
}
function sessionBinding(request: Request) {
	return createHash("sha256")
		.update(cookie(request, "orbit_session") || "local")
		.digest("hex");
}
export function assertMailAccess(request: Request) {
	const config = getOrbitAuthConfig();
	const url = new URL(request.url);
	if (config.enabled) {
		if (!verifyOrbitSessionToken(cookie(request, "orbit_session"), config))
			throw new Error("로그인이 필요합니다.");
	} else if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
		throw new Error("메일을 사용하려면 Orbit 로그인을 설정해 주세요.");
	const site = request.headers.get("sec-fetch-site");
	if (site === "cross-site") throw new Error("허용되지 않은 요청입니다.");
	if (request.method !== "GET" && request.method !== "HEAD") {
		const origin = request.headers.get("origin");
		const publicUrl = process.env.ORBIT_PUBLIC_URL || "";
		// No wildcard CORS and no trust in arbitrary forwarded hosts.
		const allowed = [url.origin, publicUrl, mailConfig().publicUrl].filter(
			Boolean,
		);
		if (!origin || !allowed.includes(origin))
			throw new Error("허용되지 않은 요청입니다.");
	}
}
async function body(request: Request, limit = 24 * 1024 * 1024) {
	if (Number(request.headers.get("content-length")) > limit)
		throw new Error("요청이 너무 큽니다.");
	const reader = request.body?.getReader();
	if (!reader) throw new Error("요청 내용이 없습니다.");
	let size = 0;
	const chunks: Uint8Array[] = [];
	try {
		while (true) {
			const part = await reader.read();
			if (part.done) break;
			size += part.value.length;
			if (size > limit) {
				await reader.cancel();
				throw new Error("요청이 너무 큽니다.");
			}
			chunks.push(part.value);
		}
	} finally {
		reader.releaseLock();
	}
	return JSON.parse(Buffer.concat(chunks).toString()) as unknown;
}
function id(value: unknown) {
	return z.string().min(1).max(256).parse(value);
}
export async function handleMailRequest(request: Request): Promise<Response> {
	const url = new URL(request.url);
	const path = url.pathname.replace(/^\/api\/mail\/?/, "");
	try {
		if (path === "gmail/push") return await gmailPush(request);
		// OAuth callbacks are necessarily cross-site navigations, bound to both session and nonce.
		if (path === "oauth/callback") return await oauthCallback(request);
		assertMailAccess(request);
		if (path.startsWith("demo/"))
			return await demoMailRequest(
				request,
				path.slice(5),
				request.method === "POST" ? await body(request) : undefined,
			);
		startMailRuntime();
		const s = mailStore();
		if (request.method === "GET") {
			if (path === "status")
				return json({
					...({
						accounts: s.accounts(),
						blockedSenders: s.blockedSenders(),
						gmailConfigured: gmailConfigured(),
						pushConfigured: pushConfigured(),
						publicKey: pushConfigured() ? pushKeys().publicKey : null,
						notificationPreview:
							s.setting<boolean>("notificationPreview") ?? true,
					} satisfies MailStatus),
					publicUrl: mailConfig().publicUrl,
					gmailClientId: mailConfig().gmailClientId,
				});
			if (path === "messages") {
				const folder = folderSchema.parse(
					url.searchParams.get("folder") || "inbox",
				);
				const accountId = url.searchParams.get("account") || undefined;
				const addresses = aliasesSchema
					.max(51)
					.parse(url.searchParams.getAll("address"))
					.map((address) => address.toLowerCase());
				if (
					addresses.length &&
					(!accountId ||
						s.account(accountId).provider !== "icloud" ||
						addresses.some(
							(address) =>
								!accountAddresses(s.account(accountId)).includes(address),
						))
				)
					throw new Error("등록된 iCloud 메일 주소를 선택해 주세요.");
				const query = z
					.string()
					.max(200)
					.parse(url.searchParams.get("q") || "");
				const cursor = url.searchParams.get("cursor") || undefined;
				if (url.searchParams.get("remote") === "1") {
					if (accountId)
						return json(
							await listRemote(
								s.account(accountId),
								folder,
								cursor,
								query,
								addresses,
							),
						);
					const results = await Promise.allSettled(
						s
							.accounts()
							.map((a) =>
								accountQueue(a.id, () =>
									listRemote(a, folder, undefined, query),
								),
							),
					);
					return json({
						messages: results
							.flatMap((r) =>
								r.status === "fulfilled" ? r.value.messages : [],
							)
							.sort((a, b) => b.date - a.date),
						cursor: null,
						errors: results.flatMap((r, i) =>
							r.status === "rejected"
								? [
										{
											account: s.accounts()[i]?.email,
											error: publicError(r.reason),
										},
									]
								: [],
						),
					});
				}
				return json({
					messages: s
						.messages(accountId, folder, query)
						.filter(
							(message) =>
								!addresses.length ||
								addresses.some((address) =>
									matchesAddress(message, address, folder),
								),
						),
					cursor: null,
				});
			}
			if (path === "conversation")
				return json(
					await conversationMessages(
						id(url.searchParams.get("id")),
						url.searchParams.get("remote") === "1",
					),
				);
			if (path === "message")
				return json(
					await detailMessage(
						id(url.searchParams.get("id")),
						url.searchParams.get("images") === "1",
					),
				);
			if (path === "attachment") {
				const { parsed } = await rawMessage(
					id(url.searchParams.get("message")),
				);
				const index = z.coerce
					.number()
					.int()
					.min(0)
					.parse(url.searchParams.get("part"));
				const a = parsed.attachments[index];
				if (!a) return json({ error: "첨부파일을 찾을 수 없습니다." }, 404);
				const inline =
					url.searchParams.get("download") !== "1" && canPreview(a.contentType);
				return new Response(new Uint8Array(a.content), {
					headers: {
						...privateHeaders,
						"Content-Type": inline ? a.contentType : "application/octet-stream",
						"Content-Length": String(a.size),
						"Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(a.filename || "attachment").replace(/['()]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)}`,
						"Content-Security-Policy": "sandbox; default-src 'none'",
						"Cross-Origin-Resource-Policy": "same-origin",
					},
				});
			}
			if (path === "draft") {
				const draftId = z.string().uuid().parse(url.searchParams.get("id"));
				const row = s.db
					.prepare("SELECT data FROM drafts WHERE id=?")
					.get(draftId) as { data: string } | undefined;
				return json(row ? s.unseal(row.data) : null);
			}
		}
		if (request.method === "POST") {
			const input = await body(request);
			if (path === "connect") return json(await connectImap(input));
			if (path === "settings") {
				const v = z
					.object({
						publicUrl: z.url().refine((v) => {
							const u = new URL(v);
							return (
								u.protocol === "https:" &&
								!u.username &&
								!u.password &&
								u.pathname === "/" &&
								!u.search &&
								!u.hash
							);
						}),
						gmailClientId: z.string().max(500).optional(),
						gmailClientSecret: z.string().max(500).optional(),
						notificationPreview: z.boolean(),
					})
					.parse(input);
				const current = mailConfig();
				s.setSetting("config", {
					publicUrl: v.publicUrl.replace(/\/$/, ""),
					gmailClientId: v.gmailClientId ?? current.gmailClientId,
					gmailClientSecret: v.gmailClientSecret || current.gmailClientSecret,
				});
				s.setSetting("notificationPreview", v.notificationPreview);
				return json({ ok: true });
			}
			if (path === "account") {
				const v = z
					.object({
						id: z.string().uuid(),
						notifications: z.boolean().optional(),
						aliases: aliasesSchema.optional(),
						defaultFrom: z.email().max(254).optional(),
						remove: z.boolean().optional(),
					})
					.parse(input);
				await accountQueue(v.id, async () => {
					if (v.remove) {
						stopAccount(v.id);
						clearGmailToken(v.id);
						s.removeAccount(v.id);
					} else {
						const previous = s.account(v.id);
						if ((v.aliases || v.defaultFrom) && previous.provider !== "icloud")
							throw new Error(
								"추가 발신 주소는 iCloud 계정에서 설정해 주세요.",
							);
						const aliases = v.aliases
							? [
									...new Set(v.aliases.map((address) => address.toLowerCase())),
								].filter((address) => address !== previous.email.toLowerCase())
							: previous.aliases;
						const next = {
							...previous,
							aliases,
							defaultFrom:
								v.defaultFrom?.toLowerCase() ||
								previous.defaultFrom ||
								previous.email.toLowerCase(),
							notifications: v.notifications ?? previous.notifications,
						};
						if (!accountAddresses(next).includes(next.defaultFrom)) {
							if (v.defaultFrom)
								throw new Error(
									"기본 발신 주소는 등록한 주소 중에서 선택해 주세요.",
								);
							next.defaultFrom = previous.email.toLowerCase();
						}
						s.saveAccount(next);
					}
				});
				return json({ ok: true });
			}
			if (path === "sync") {
				const v = z.object({ id: z.string().uuid().optional() }).parse(input);
				await Promise.all(
					(v.id ? [s.account(v.id)] : s.accounts()).map((a) =>
						syncAccount(a.id),
					),
				);
				return json({ ok: true });
			}
			if (path === "unblock") {
				const v = z
					.object({ accountId: z.string().uuid(), address: z.string().email() })
					.parse(input);
				await accountQueue(v.accountId, async () =>
					s.setBlocked(v.accountId, v.address, false),
				);
				return json({ ok: true });
			}
			if (path === "action") {
				const v = z
					.object({
						id: z.string(),
						action: mailActionSchema,
					})
					.parse(input);
				return json(await mutateMessage(v.id, v.action));
			}
			if (path === "send") return json(await sendMail(sendSchema.parse(input)));
			if (path === "oauth/start") {
				if (request.headers.get("origin") !== mailConfig().publicUrl)
					throw new Error(
						"Gmail 연결은 설정한 Orbit HTTPS 주소에서 진행해 주세요.",
					);
				const client = oauthClient();
				const verifier = randomBytes(32).toString("base64url");
				const nonce = randomBytes(32).toString("base64url");
				const state = s.createOauth({
					verifier,
					nonce,
					binding: sessionBinding(request),
				});
				const auth = client.generateAuthUrl({
					access_type: "offline",
					prompt: "consent",
					scope: ["https://www.googleapis.com/auth/gmail.modify"],
					state,
					code_challenge: createHash("sha256")
						.update(verifier)
						.digest("base64url"),
					code_challenge_method: CodeChallengeMethod.S256,
				});
				const response = json({ url: auth });
				response.headers.set(
					"Set-Cookie",
					`orbit_mail_oauth=${nonce}; HttpOnly; SameSite=Lax; Path=/api/mail/oauth; Max-Age=600${new URL(request.url).protocol === "https:" || process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
				);
				return response;
			}
			if (path === "push/subscribe") {
				const v = subscriptionSchema.parse(input);
				s.addSubscription(
					{ ...v, session: cookie(request, "orbit_session") || null },
					v.endpoint,
				);
				return json({ ok: true });
			}
			if (path === "push/unsubscribe") {
				const v = z.object({ endpoint: z.string().max(2048) }).parse(input);
				s.removeSubscription(v.endpoint);
				return json({ ok: true });
			}
			if (path === "push/test") {
				const v = z
					.object({
						endpoint: z.string().max(2048),
						testId: z.string().uuid().optional(),
					})
					.parse(input);
				const sub = s
					.subscriptions<PushSubscription>()
					.find((s) => s.endpoint === v.endpoint);
				if (!sub) throw new Error("이 기기의 알림을 먼저 켜 주세요.");
				const testId = v.testId || randomUUID();
				await sendPush(sub, {
					title: "Orbit 메일",
					body: "이 기기로 메일 알림을 받을 수 있어요.",
					url: "/mail",
					tag: `orbit-mail-test-${testId}`,
					testId,
				});
				return json({ ok: true, testId });
			}
			if (path === "draft") {
				const v = z
					.object({
						id: z.string().uuid(),
						revision: z.number().int().min(0),
						value: sendSchema
							.omit({ requestId: true })
							.extend({
								to: z.array(z.string().max(500)).max(50),
								cc: z.array(z.string().max(500)).max(50),
								bcc: z.array(z.string().max(500)).max(50),
							})
							.nullable(),
					})
					.parse(input);
				const row = s.db
					.prepare("SELECT data FROM drafts WHERE id=?")
					.get(v.id) as { data: string } | undefined;
				const prev = row ? s.unseal<{ revision: number }>(row.data) : null;
				if (prev && v.revision <= prev.revision)
					return json({ error: "다른 창에서 임시저장이 변경되었습니다." }, 409);
				if (v.value === null)
					s.db.prepare("DELETE FROM drafts WHERE id=?").run(v.id);
				else
					s.db
						.prepare("INSERT OR REPLACE INTO drafts VALUES (?,?)")
						.run(v.id, s.seal(v));
				return json({ ok: true });
			}
		}
		return json({ error: "요청을 찾을 수 없습니다." }, 404);
	} catch (error) {
		return json(
			{
				error:
					error instanceof z.ZodError
						? "입력한 값과 이메일 주소를 확인해 주세요."
						: publicError(error),
			},
			error instanceof Error && error.message === "로그인이 필요합니다."
				? 401
				: 400,
		);
	}
}
async function oauthCallback(request: Request) {
	const url = new URL(request.url);
	const state = url.searchParams.get("state") || "";
	const s = mailStore();
	const entry = s.oauth<{ verifier: string; nonce: string; binding: string }>(
		state,
	);
	const config = getOrbitAuthConfig();
	const validSession = config.enabled
		? verifyOrbitSessionToken(cookie(request, "orbit_session"), config)
		: ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
	if (
		!validSession ||
		!entry ||
		entry.nonce !== cookie(request, "orbit_mail_oauth") ||
		entry.binding !== sessionBinding(request)
	)
		throw new Error("Gmail 연결 요청이 만료되었습니다. 다시 연결해 주세요.");
	if (url.searchParams.has("error"))
		return Response.redirect(
			new URL(
				"/mail?connection=cancelled",
				mailConfig().publicUrl || url.origin,
			),
			303,
		);
	const code = url.searchParams.get("code");
	if (!code) throw new Error("Gmail 인증 코드가 없습니다.");
	const client = oauthClient();
	const { tokens } = await client.getToken({
		code,
		codeVerifier: entry.verifier,
	});
	client.setCredentials(tokens);
	const profile = await client.request<{ emailAddress: string }>({
		url: "https://gmail.googleapis.com/gmail/v1/users/me/profile",
	});
	const email = z.email().parse(profile.data.emailAddress);
	const old = s
		.accounts()
		.find((a) => a.email.toLowerCase() === email.toLowerCase());
	const refreshToken =
		tokens.refresh_token || (old ? s.secret(old.id).refreshToken : undefined);
	if (!refreshToken) throw new Error("Gmail 권한을 다시 승인해 주세요.");
	const account: MailAccount = {
		id: old?.id || randomUUID(),
		provider: "gmail",
		email,
		name: old?.name || email,
		createdAt: old?.createdAt || Date.now(),
		notifications: old?.notifications ?? true,
		lastSync: old?.lastSync || null,
		error: null,
	};
	await accountQueue(account.id, async () => {
		s.saveAccount(account, { refreshToken });
		clearGmailToken(account.id);
	});
	startMailRuntime();
	void syncAccount(account.id);
	const response = new Response(null, {
		status: 303,
		headers: {
			...privateHeaders,
			Location: "/mail?connection=connected",
			"Set-Cookie":
				"orbit_mail_oauth=; HttpOnly; SameSite=Lax; Path=/api/mail/oauth; Max-Age=0",
		},
	});
	return response;
}
async function gmailPush(request: Request) {
	if (request.method !== "POST")
		return json({ error: "Method not allowed" }, 405);
	const email = process.env.ORBIT_GMAIL_PUSH_EMAIL;
	const base = mailConfig().publicUrl;
	if (!email || !base) return json({ error: "Push not configured" }, 404);
	const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
	if (!token) return json({ error: "Unauthorized" }, 401);
	try {
		const ticket = await new OAuth2Client().verifyIdToken({
			idToken: token,
			audience: `${base}/api/mail/gmail/push`,
		});
		const payload = ticket.getPayload();
		if (payload?.email !== email || !payload.email_verified)
			return json({ error: "Unauthorized" }, 401);
	} catch {
		return json({ error: "Unauthorized" }, 401);
	}
	const input = z
		.object({ message: z.object({ data: z.string().max(16_000) }) })
		.parse(await body(request, 32_000));
	const payload = z
		.object({ emailAddress: z.email() })
		.parse(JSON.parse(Buffer.from(input.message.data, "base64").toString()));
	const account = mailStore()
		.accounts()
		.find(
			(a) =>
				a.provider === "gmail" &&
				a.email.toLowerCase() === payload.emailAddress.toLowerCase(),
		);
	if (account) await syncAccount(account.id);
	return new Response(null, { status: 204, headers: privateHeaders });
}
