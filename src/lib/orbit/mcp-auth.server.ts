import {
	createHash,
	createHmac,
	randomBytes,
	randomUUID,
	timingSafeEqual,
} from "node:crypto";
import OAuth2Server from "@node-oauth/oauth2-server";
import {
	getOrbitAuthConfig,
	orbitAuthVersion,
	verifyOrbitSessionToken,
} from "./auth.server";
import { databaseFor, withDatabase } from "./database";

export const MCP_SCOPES = ["orbit.read", "orbit.write", "orbit.apply"] as const;
const prefix = "mcp.oauth.v1/";
const hash = (value: string) =>
	createHash("sha256").update(value).digest("hex");
const secret = () => randomBytes(32).toString("base64url");
export class McpHttpError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
	) {
		super(code);
	}
}
export function mcpConfig() {
	const raw = process.env.ORBIT_MCP_ORIGIN;
	if (!raw) throw new McpHttpError(503, "mcp_not_configured");
	const url = new URL(raw);
	if (
		url.origin !== raw ||
		url.protocol !== "https:" ||
		url.username ||
		url.password
	)
		throw new McpHttpError(503, "invalid_mcp_origin");
	const auth = getOrbitAuthConfig();
	if (!auth.enabled) throw new McpHttpError(503, "orbit_login_required");
	const redirects = (
		process.env.ORBIT_MCP_REDIRECT_URIS ??
		"https://chatgpt.com/connector_platform_oauth_redirect"
	)
		.split(",")
		.map((s) => s.trim());
	for (const redirect of redirects) {
		const uri = new URL(redirect);
		if (uri.protocol !== "https:" || uri.hash || uri.username || uri.password)
			throw new McpHttpError(503, "invalid_redirect_configuration");
	}
	return {
		origin: raw,
		resource: `${raw}/mcp`,
		clientId: process.env.ORBIT_MCP_CLIENT_ID ?? "orbit-chatgpt",
		redirects,
		scopes:
			process.env.ORBIT_MCP_ALLOW_WRITES === "true"
				? [...MCP_SCOPES]
				: ["orbit.read"],
		auth,
		version: orbitAuthVersion(auth),
	};
}
export type McpConfig = ReturnType<typeof mcpConfig>;
export const privateHeaders = {
	"Cache-Control": "no-store",
	Pragma: "no-cache",
	"Referrer-Policy": "no-referrer",
	"X-Content-Type-Options": "nosniff",
};
export function mcpJson(
	value: unknown,
	status = 200,
	extra: Record<string, string> = {},
) {
	return Response.json(value, {
		status,
		headers: { ...privateHeaders, ...extra },
	});
}
function read<T>(kind: string, id: string) {
	return databaseFor().metadata<T>(`${prefix}${kind}/${id}`);
}
function write(kind: string, id: string, value: unknown) {
	databaseFor().setMetadata(`${prefix}${kind}/${id}`, value);
}
type Owner = { id: string; version: string; grantId: string; resource: string };
type Grant = { user: Owner; expires: number; revoked: boolean };
type StoredCode = {
	code: Pick<
		OAuth2Server.AuthorizationCode,
		| "redirectUri"
		| "scope"
		| "codeChallenge"
		| "codeChallengeMethod"
		| "user"
		| "client"
	>;
	expires: number;
	used: boolean;
};
type StoredToken = {
	user: Owner;
	scope: string[];
	clientId: string;
	expires: number;
	used?: boolean;
	accessHash?: string;
};
function currentOwner(user: Owner, c: McpConfig) {
	return (
		user.id === c.auth.username &&
		user.version === c.version &&
		user.resource === c.resource
	);
}
function activeGrant(user: Owner, c: McpConfig) {
	const grant = read<Grant>("grant", user.grantId);
	return (
		currentOwner(user, c) &&
		grant &&
		!grant.revoked &&
		grant.expires > Date.now()
	);
}
function client(c: McpConfig): OAuth2Server.Client {
	return {
		id: c.clientId,
		grants: ["authorization_code", "refresh_token"],
		redirectUris: c.redirects,
	};
}
function model(
	c: McpConfig,
): OAuth2Server.AuthorizationCodeModel & OAuth2Server.RefreshTokenModel {
	return {
		getClient: async (id, suppliedSecret) =>
			id === c.clientId && !suppliedSecret ? client(c) : false,
		generateAccessToken: async () => secret(),
		generateRefreshToken: async () => secret(),
		generateAuthorizationCode: async () => secret(),
		validateScope: async (_user, _client, scope) =>
			scope?.length &&
			scope.includes("orbit.read") &&
			scope.every((s) => c.scopes.includes(s))
				? scope
				: false,
		getAuthorizationCode: async (value) => {
			const r = read<StoredCode>("code", hash(value));
			if (
				!r ||
				r.used ||
				r.expires <= Date.now() ||
				!currentOwner(r.code.user as Owner, c)
			)
				return false;
			return {
				...r.code,
				authorizationCode: value,
				expiresAt: new Date(r.expires),
			};
		},
		saveAuthorizationCode: async (code, app, user) => {
			const { authorizationCode, expiresAt, ...rest } = code;
			write("code", hash(authorizationCode), {
				code: { ...rest, client: app, user },
				expires: expiresAt.getTime(),
				used: false,
			});
			return { ...code, client: app, user };
		},
		revokeAuthorizationCode: async (code) => {
			const key = hash(code.authorizationCode),
				r = read<StoredCode>("code", key);
			if (!r || r.used) return false;
			write("code", key, { ...r, used: true });
			return true;
		},
		saveToken: async (token, app, rawUser) => {
			const user = rawUser as Owner;
			if (!activeGrant(user, c))
				throw new OAuth2Server.InvalidGrantError("Authorization expired");
			const grant = read<Grant>("grant", user.grantId);
			if (
				!grant ||
				!token.refreshToken ||
				!token.refreshTokenExpiresAt ||
				!token.accessTokenExpiresAt
			)
				throw new OAuth2Server.InvalidGrantError("Invalid token data");
			const refreshExpiry = new Date(
				Math.min(token.refreshTokenExpiresAt.getTime(), grant.expires),
			);
			const saved: StoredToken = {
				user,
				scope: token.scope ?? [],
				clientId: app.id,
				expires: token.accessTokenExpiresAt.getTime(),
			};
			write("access", hash(token.accessToken), saved);
			write("refresh", hash(token.refreshToken), {
				...saved,
				expires: refreshExpiry.getTime(),
				used: false,
				accessHash: hash(token.accessToken),
			});
			return {
				...token,
				refreshTokenExpiresAt: refreshExpiry,
				client: app,
				user,
			};
		},
		getAccessToken: async (value) => {
			const r = read<StoredToken>("access", hash(value));
			if (
				!r ||
				r.clientId !== c.clientId ||
				r.expires <= Date.now() ||
				!activeGrant(r.user, c)
			)
				return false;
			return {
				accessToken: value,
				accessTokenExpiresAt: new Date(r.expires),
				scope: r.scope.filter((s) => c.scopes.includes(s)),
				client: client(c),
				user: r.user,
			};
		},
		getRefreshToken: async (value) => {
			const r = read<StoredToken>("refresh", hash(value));
			if (
				!r ||
				r.clientId !== c.clientId ||
				r.expires <= Date.now() ||
				!activeGrant(r.user, c)
			)
				return false;
			if (r.used) {
				const grant = read<Grant>("grant", r.user.grantId);
				write("grant", r.user.grantId, { ...grant, revoked: true });
				return false;
			}
			return {
				refreshToken: value,
				refreshTokenExpiresAt: new Date(r.expires),
				scope: r.scope.filter((s) => c.scopes.includes(s)),
				client: client(c),
				user: r.user,
			};
		},
		revokeToken: async (token) => {
			const key = hash(token.refreshToken),
				r = read<StoredToken>("refresh", key);
			if (!r || r.used) return false;
			write("refresh", key, { ...r, used: true });
			if (r.accessHash) {
				const access = read<StoredToken>("access", r.accessHash);
				if (access) write("access", r.accessHash, { ...access, expires: 0 });
			}
			return true;
		},
		verifyScope: async (token, scope) =>
			scope.every((s) => token.scope?.includes(s)),
	};
}
function oauth(c: McpConfig) {
	return new OAuth2Server({
		model: model(c),
		accessTokenLifetime: 3600,
		refreshTokenLifetime: 30 * 86400,
		authorizationCodeLifetime: 120,
		requireClientAuthentication: {
			authorization_code: false,
			refresh_token: false,
		},
		alwaysIssueNewRefreshToken: true,
	});
}
export async function verifyMcpAccess(request: Request, c: McpConfig) {
	const bearer = request.headers.get("authorization");
	if (!bearer || !/^Bearer [A-Za-z0-9_-]{43}$/.test(bearer))
		throw new McpHttpError(401, "invalid_token");
	return withDatabase(async () => {
		const token = await model(c).getAccessToken(bearer.slice(7));
		if (
			!token ||
			!token.accessTokenExpiresAt ||
			!token.scope?.includes("orbit.read")
		)
			throw new McpHttpError(401, "invalid_token");
		return {
			clientId: token.client.id,
			scopes: token.scope,
			expiresAt: Math.floor(token.accessTokenExpiresAt.getTime() / 1000),
		};
	});
}
function params(search: URLSearchParams) {
	const result: Record<string, string> = {};
	for (const [key, value] of search) {
		if (Object.hasOwn(result, key))
			throw new McpHttpError(400, "duplicate_parameter");
		result[key] = value;
	}
	return result;
}
export async function smallBody(request: Request, max = 65536) {
	if (Number(request.headers.get("content-length") ?? "0") > max)
		throw new McpHttpError(413, "request_too_large");
	const reader = request.body?.getReader();
	if (!reader) return "";
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.length;
			if (size > max) {
				await reader.cancel();
				throw new McpHttpError(413, "request_too_large");
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	return Buffer.concat(chunks).toString("utf8");
}
function session(request: Request, c: McpConfig) {
	const value = request.headers
		.get("cookie")
		?.split(";")
		.map((s) => s.trim())
		.find((s) => s.startsWith("orbit_session="))
		?.slice(14);
	return value && verifyOrbitSessionToken(value, c.auth) ? value : undefined;
}
const escapeHtml = (s: string) =>
	s.replace(
		/[&<>"']/g,
		(char) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				char
			] ?? char,
	);
function csrf(cookie: string, query: string, expires: string) {
	return createHmac("sha256", cookie)
		.update(`${query}\0${expires}`)
		.digest("hex");
}
function validCsrf(cookie: string, query: string, value: string) {
	const [expires, signature] = value.split(".");
	if (
		!/^\d{13}$/.test(expires ?? "") ||
		Number(expires) < Date.now() ||
		Number(expires) > Date.now() + 600_000 ||
		!/^[a-f0-9]{64}$/.test(signature ?? "")
	)
		return false;
	return timingSafeEqual(
		Buffer.from(signature, "hex"),
		Buffer.from(csrf(cookie, query, expires), "hex"),
	);
}
function html(body: string) {
	return new Response(
		`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Orbit 연결</title><style>body{font:15px system-ui;color:#202020;background:#f6f6f5;margin:0;display:grid;min-height:100svh;place-items:center}main{background:white;border:1px solid #ddd;border-radius:16px;padding:32px;max-width:420px;margin:20px}h1{font-size:22px}p,li{line-height:1.7}button,a{font:inherit}button{padding:10px 16px;border:1px solid #ccc;border-radius:8px;cursor:pointer;background:white}button[value=allow]{background:#242424;color:white}form{display:flex;gap:8px;margin-top:24px}</style><main>${body}</main></html>`,
		{
			headers: {
				...privateHeaders,
				"Content-Type": "text/html; charset=utf-8",
				// no-referrer makes native form POSTs send Origin: null, which
				// correctly fails our same-origin consent check. Keep the real
				// origin without forwarding the OAuth query in Referer headers.
				"Referrer-Policy": "strict-origin",
				"Content-Security-Policy":
					"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
				"X-Frame-Options": "DENY",
			},
		},
	);
}
function authorizeParams(url: URL, c: McpConfig) {
	const p = params(url.searchParams);
	if (p.client_id !== c.clientId || !c.redirects.includes(p.redirect_uri))
		throw new McpHttpError(400, "invalid_client_or_redirect");
	if (
		p.resource !== c.resource ||
		p.response_type !== "code" ||
		p.code_challenge_method !== "S256" ||
		!/^[A-Za-z0-9_-]{43}$/.test(p.code_challenge ?? "") ||
		!p.state ||
		p.state.length > 1024
	)
		throw new McpHttpError(400, "invalid_authorization_request");
	const scopes = (p.scope ?? "orbit.read").split(" ");
	if (
		!scopes.includes("orbit.read") ||
		scopes.some((s) => !c.scopes.includes(s))
	)
		throw new McpHttpError(400, "invalid_scope");
	p.scope = scopes.join(" ");
	return p;
}
function callback(
	p: Record<string, string>,
	c: McpConfig,
	values: Record<string, string>,
) {
	const url = new URL(p.redirect_uri);
	for (const [key, value] of Object.entries({
		...values,
		state: p.state,
		iss: c.origin,
	}))
		url.searchParams.set(key, value);
	return new Response(null, {
		status: 303,
		headers: { ...privateHeaders, Location: url.href },
	});
}
// One configured public OAuth client, exact callback allowlist, mandatory S256.
// The library validates code/redirect/client/PKCE and rotation; this adapter binds
// every grant to Orbit's current owner, credential version and MCP resource.
export async function handleMcpOAuth(
	request: Request,
	c = mcpConfig(),
): Promise<Response> {
	const url = new URL(request.url),
		path = url.pathname;
	if (
		request.method === "GET" &&
		path === "/.well-known/oauth-protected-resource"
	)
		return mcpJson({
			resource: c.resource,
			authorization_servers: [c.origin],
			scopes_supported: c.scopes,
			bearer_methods_supported: ["header"],
		});
	if (
		request.method === "GET" &&
		path === "/.well-known/oauth-authorization-server"
	)
		return mcpJson({
			issuer: c.origin,
			authorization_endpoint: `${c.origin}/oauth/authorize`,
			token_endpoint: `${c.origin}/oauth/token`,
			revocation_endpoint: `${c.origin}/oauth/revoke`,
			response_types_supported: ["code"],
			grant_types_supported: ["authorization_code", "refresh_token"],
			token_endpoint_auth_methods_supported: ["none"],
			code_challenge_methods_supported: ["S256"],
			scopes_supported: c.scopes,
			authorization_response_iss_parameter_supported: true,
		});
	if (path === "/oauth/authorize" && ["GET", "POST"].includes(request.method)) {
		const p = authorizeParams(url, c),
			cookie = session(request, c);
		if (!cookie)
			return new Response(null, {
				status: 303,
				headers: {
					...privateHeaders,
					Location: `/login?returnTo=${encodeURIComponent(url.pathname + url.search)}`,
				},
			});
		if (request.method === "GET") {
			const expires = String(Date.now() + 600_000),
				token = `${expires}.${csrf(cookie, url.search, expires)}`;
			return html(
				`<h1>ChatGPT에 Orbit 연결</h1><p>필요한 일정·할 일·메모를 검색하고 내용을 조회합니다.</p><ul><li>일정·할 일·메모 검색 및 조회</li>${p.scope.includes("orbit.write") ? "<li>요청한 새 메모·할 일·일정과 브리핑·발견 정보·추천 저장</li>" : ""}${p.scope.includes("orbit.apply") ? "<li>ChatGPT에서 확인한 추천을 할 일·일정에 적용</li>" : ""}</ul><p>조회한 내용은 ChatGPT에 전달됩니다. 기존 항목을 변경하기 전에는 변경 내용을 확인받도록 요청합니다.</p><form method="post"><input type="hidden" name="csrf" value="${escapeHtml(token)}"><button name="decision" value="deny">취소</button><button name="decision" value="allow">연결 허용</button></form>`,
			);
		}
		if (request.headers.get("origin") !== c.origin)
			throw new McpHttpError(403, "invalid_origin");
		const body = params(new URLSearchParams(await smallBody(request, 4096)));
		if (!validCsrf(cookie, url.search, body.csrf ?? ""))
			throw new McpHttpError(403, "invalid_csrf");
		if (body.decision === "deny")
			return callback(p, c, { error: "access_denied" });
		if (body.decision !== "allow")
			throw new McpHttpError(400, "invalid_decision");
		return withDatabase(async () => {
			const user: Owner = {
				id: c.auth.username,
				version: c.version,
				resource: c.resource,
				grantId: randomUUID(),
			};
			write("grant", user.grantId, {
				user,
				expires: Date.now() + 30 * 86400_000,
				revoked: false,
			});
			const response = new OAuth2Server.Response();
			const code = await oauth(c).authorize(
				new OAuth2Server.Request({ method: "GET", headers: {}, query: p }),
				response,
				{ authenticateHandler: { handle: () => user } },
			);
			return callback(p, c, { code: code.authorizationCode });
		}, true);
	}
	if (
		request.method === "POST" &&
		["/oauth/token", "/oauth/revoke"].includes(path)
	) {
		if (
			!request.headers
				.get("content-type")
				?.startsWith("application/x-www-form-urlencoded")
		)
			throw new McpHttpError(415, "form_required");
		const body = params(new URLSearchParams(await smallBody(request, 8192)));
		if (
			body.client_id !== c.clientId ||
			body.client_secret ||
			request.headers.has("authorization")
		)
			throw new McpHttpError(401, "invalid_client");
		if (path === "/oauth/revoke") {
			await withDatabase(() => {
				const r =
					read<StoredToken>("access", hash(body.token ?? "")) ??
					read<StoredToken>("refresh", hash(body.token ?? ""));
				if (r?.clientId === c.clientId) {
					const grant = read<Grant>("grant", r.user.grantId);
					if (grant)
						write("grant", r.user.grantId, { ...grant, revoked: true });
				}
			}, true);
			return mcpJson({});
		}
		if (body.resource !== c.resource)
			throw new McpHttpError(400, "invalid_target");
		if (!["authorization_code", "refresh_token"].includes(body.grant_type))
			throw new McpHttpError(400, "unsupported_grant_type");
		// Commit consumed codes and refresh-token replay revocations even on failure.
		return withDatabase(async () => {
			try {
				const response = new OAuth2Server.Response();
				await oauth(c).token(
					new OAuth2Server.Request({
						method: "POST",
						headers: {
							"content-type": "application/x-www-form-urlencoded",
							"content-length": String(
								Buffer.byteLength(new URLSearchParams(body).toString()),
							),
						},
						query: {},
						body,
					}),
					response,
				);
				return mcpJson(response.body, response.status ?? 200);
			} catch (error) {
				return mcpJson(
					{
						error:
							error instanceof OAuth2Server.OAuthError
								? error.name
								: "server_error",
					},
					error instanceof OAuth2Server.OAuthError ? error.code : 500,
				);
			}
		}, true);
	}
	throw new McpHttpError(404, "not_found");
}
