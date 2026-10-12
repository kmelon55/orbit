import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { loadAssistantState } from "./assistant.server";
import {
	compactAssistantContext,
	fetchAssistantItem,
	searchAssistantItems,
} from "./assistant-read.server";
import { createOrbitSessionToken, getOrbitAuthConfig } from "./auth.server";
import { closeOrbitDatabases, databaseFor, withDatabase } from "./database";
import { orbitLoginReturn } from "./login-return";
import { handleMcpRequest } from "./mcp-http.server";
import {
	createOrbitItem,
	fileOrbitItem,
	getOrbitItem,
	listOrbitItems,
} from "./store";

function required(value: string | null) {
	assert.ok(value);
	return value;
}
const origin = "https://orbit.example";
const redirect = "https://chatgpt.com/connector_platform_oauth_redirect";
function fixture(writes = false) {
	const dir = mkdtempSync(path.join(os.tmpdir(), "orbit-mcp-"));
	const keys = [
		"ORBIT_VAULT_DIR",
		"ORBIT_AUTH_USERNAME",
		"ORBIT_AUTH_PASSWORD",
		"ORBIT_MCP_ORIGIN",
		"ORBIT_MCP_ALLOW_WRITES",
		"ORBIT_MCP_CLIENT_ID",
		"ORBIT_MCP_REDIRECT_URIS",
	];
	const previous = Object.fromEntries(
		keys.map((key) => [key, process.env[key]]),
	);
	Object.assign(process.env, {
		ORBIT_VAULT_DIR: dir,
		ORBIT_AUTH_USERNAME: "owner",
		ORBIT_AUTH_PASSWORD: "test-password-for-isolated-fixture",
		ORBIT_MCP_ORIGIN: origin,
		ORBIT_MCP_ALLOW_WRITES: String(writes),
		ORBIT_MCP_CLIENT_ID: "orbit-chatgpt",
		ORBIT_MCP_REDIRECT_URIS: redirect,
	});
	return () => {
		closeOrbitDatabases();
		for (const key of keys) {
			if (previous[key] === undefined) delete process.env[key];
			else process.env[key] = previous[key];
		}
		rmSync(dir, { recursive: true, force: true });
	};
}
function cookie() {
	const config = getOrbitAuthConfig();
	assert.ok(config.enabled);
	return `orbit_session=${createOrbitSessionToken(config)}`;
}
function authorization(scope = "orbit.read") {
	const verifier = randomBytes(32).toString("base64url");
	const url = new URL(`${origin}/oauth/authorize`);
	url.search = new URLSearchParams({
		client_id: "orbit-chatgpt",
		redirect_uri: redirect,
		response_type: "code",
		resource: `${origin}/mcp`,
		scope,
		state: "test-state",
		code_challenge: createHash("sha256").update(verifier).digest("base64url"),
		code_challenge_method: "S256",
	}).toString();
	return { url, verifier };
}
async function consent(url: URL, session = cookie(), decision = "allow") {
	const page = await handleMcpRequest(
		new Request(url, { headers: { cookie: session } }),
	);
	assert.equal(page.status, 200);
	assert.equal(page.headers.get("referrer-policy"), "strict-origin");
	const markup = await page.text();
	const csrf = markup.match(/name="csrf" value="([^"]+)"/)?.[1];
	assert.ok(csrf);
	return handleMcpRequest(
		new Request(url, {
			method: "POST",
			headers: {
				cookie: session,
				origin,
				"content-type": "application/x-www-form-urlencoded",
			},
			body: new URLSearchParams({ csrf, decision }),
		}),
	);
}
async function token(body: Record<string, string>) {
	return handleMcpRequest(
		new Request(`${origin}/oauth/token`, {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				client_id: "orbit-chatgpt",
				resource: `${origin}/mcp`,
				...body,
			}),
		}),
	);
}
async function connect(scope = "orbit.read") {
	const { url, verifier } = authorization(scope),
		approved = await consent(url);
	assert.equal(approved.status, 303);
	const location = new URL(required(approved.headers.get("location")));
	assert.equal(location.searchParams.get("iss"), origin);
	assert.equal(location.searchParams.get("state"), "test-state");
	const code = location.searchParams.get("code");
	assert.ok(code);
	const response = await token({
		grant_type: "authorization_code",
		code,
		code_verifier: verifier,
		redirect_uri: redirect,
	});
	assert.equal(response.status, 200, await response.clone().text());
	return {
		tokens: (await response.json()) as {
			access_token: string;
			refresh_token: string;
			scope: string;
		},
		code,
		verifier,
	};
}
async function rpc(access: string, name: string, args: unknown = {}) {
	return handleMcpRequest(
		new Request(`${origin}/mcp`, {
			method: "POST",
			headers: {
				authorization: `Bearer ${access}`,
				accept: "application/json, text/event-stream",
				"content-type": "application/json",
				"mcp-protocol-version": "2025-03-26",
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: name,
				params: args,
			}),
		}),
	);
}
test("MCP fails closed, challenges bearer auth, and publishes pinned discovery", async () => {
	const done = fixture();
	try {
		const response = await handleMcpRequest(new Request(`${origin}/mcp`));
		assert.equal(response.status, 401);
		assert.match(
			response.headers.get("www-authenticate") ?? "",
			/oauth-protected-resource/,
		);
		assert.equal(response.headers.get("cache-control"), "no-store");
		assert.equal(
			(
				await handleMcpRequest(
					new Request(`${origin}/mcp`, { headers: { cookie: cookie() } }),
				)
			).status,
			401,
		);
		const metadata = await (
			await handleMcpRequest(
				new Request(`${origin}/.well-known/oauth-protected-resource`),
			)
		).json();
		assert.equal(metadata.resource, `${origin}/mcp`);
		assert.deepEqual(metadata.scopes_supported, ["orbit.read"]);
		const auth = await (
			await handleMcpRequest(
				new Request(`${origin}/.well-known/oauth-authorization-server`),
			)
		).json();
		assert.deepEqual(auth.code_challenge_methods_supported, ["S256"]);
		assert.equal(auth.authorization_response_iss_parameter_supported, true);
		assert.equal(
			(
				await handleMcpRequest(
					new Request(`${origin}/mcp`, {
						headers: { origin: "https://evil.example" },
					}),
				)
			).status,
			403,
		);
		assert.equal(
			(await handleMcpRequest(new Request("https://wrong.example/mcp"))).status,
			403,
		);
		delete process.env.ORBIT_MCP_ORIGIN;
		assert.equal(
			(await handleMcpRequest(new Request(`${origin}/mcp`))).status,
			503,
		);
	} finally {
		done();
	}
});
test("authorization requires owner session, exact redirect/resource, S256 and same-origin consent", async () => {
	const done = fixture();
	try {
		const { url } = authorization();
		const login = await handleMcpRequest(new Request(url));
		assert.equal(login.status, 303);
		assert.match(login.headers.get("location") ?? "", /^\/login\?returnTo=/);
		for (const [key, value] of [
			["redirect_uri", "https://evil.example"],
			["resource", "https://evil.example/mcp"],
			["code_challenge_method", "plain"],
			["scope", "orbit.read orbit.apply"],
			["client_id", "unknown"],
		]) {
			const invalid = new URL(url);
			invalid.searchParams.set(key, value);
			assert.equal(
				(
					await handleMcpRequest(
						new Request(invalid, { headers: { cookie: cookie() } }),
					)
				).status,
				400,
			);
		}
		const invalid = new URL(url);
		invalid.searchParams.delete("code_challenge");
		assert.equal((await handleMcpRequest(new Request(invalid))).status, 400);
		const noCsrf = await handleMcpRequest(
			new Request(url, {
				method: "POST",
				headers: {
					cookie: cookie(),
					origin,
					"content-type": "application/x-www-form-urlencoded",
				},
				body: "decision=allow",
			}),
		);
		assert.equal(noCsrf.status, 403);
		const denied = await consent(url, cookie(), "deny");
		assert.equal(
			new URL(required(denied.headers.get("location"))).searchParams.get(
				"error",
			),
			"access_denied",
		);
		assert.equal(orbitLoginReturn("//evil.example"), "/");
		assert.equal(orbitLoginReturn("/oauth/authorize/../evil?x=1"), "/");
		assert.equal(
			orbitLoginReturn(url.pathname + url.search),
			url.pathname + url.search,
		);
	} finally {
		done();
	}
});
test("consent preserves browser Origin and rejects foreign, opaque or missing origins even with a valid CSRF token", async () => {
	const done = fixture();
	try {
		const { url } = authorization();
		const ownerSession = cookie();
		const page = await handleMcpRequest(
			new Request(url, { headers: { cookie: ownerSession } }),
		);
		assert.equal(page.status, 200);
		assert.equal(page.headers.get("referrer-policy"), "strict-origin");
		const csrf = (await page.text()).match(/name="csrf" value="([^"]+)"/)?.[1];
		assert.ok(csrf);
		for (const requestOrigin of [
			undefined,
			"null",
			"https://evil.example",
			"https://chatgpt.com",
		]) {
			const headers = new Headers({
				cookie: ownerSession,
				"content-type": "application/x-www-form-urlencoded",
			});
			if (requestOrigin !== undefined) headers.set("origin", requestOrigin);
			const response = await handleMcpRequest(
				new Request(url, {
					method: "POST",
					headers,
					body: new URLSearchParams({ csrf, decision: "allow" }),
				}),
			);
			assert.equal(response.status, 403);
			assert.equal((await response.json()).error, "invalid_origin");
		}
		const approved = await handleMcpRequest(
			new Request(url, {
				method: "POST",
				headers: {
					cookie: ownerSession,
					origin,
					"content-type": "application/x-www-form-urlencoded",
				},
				body: new URLSearchParams({ csrf, decision: "allow" }),
			}),
		);
		assert.equal(approved.status, 303);
		assert.ok(
			new URL(required(approved.headers.get("location"))).searchParams.get(
				"code",
			),
		);
		assert.equal(approved.headers.get("referrer-policy"), "no-referrer");
	} finally {
		done();
	}
});

test("PKCE codes are single-use and failed verifier consumes the code", async () => {
	const done = fixture();
	try {
		const connected = await connect();
		assert.equal(
			(
				await token({
					grant_type: "authorization_code",
					code: connected.code,
					code_verifier: connected.verifier,
					redirect_uri: redirect,
				})
			).status,
			400,
		);
		const { url, verifier } = authorization(),
			approved = await consent(url),
			code = required(
				new URL(required(approved.headers.get("location"))).searchParams.get(
					"code",
				),
			);
		assert.equal(
			(
				await token({
					grant_type: "authorization_code",
					code,
					code_verifier: randomBytes(32).toString("base64url"),
					redirect_uri: redirect,
				})
			).status,
			400,
		);
		assert.equal(
			(
				await token({
					grant_type: "authorization_code",
					code,
					code_verifier: verifier,
					redirect_uri: redirect,
				})
			).status,
			400,
		);
		assert.equal(
			(
				await token({
					grant_type: "refresh_token",
					refresh_token: connected.tokens.refresh_token,
					resource: "https://other.example/mcp",
				})
			).status,
			400,
		);
	} finally {
		done();
	}
});
test("refresh rotates, old refresh replay revokes its family, credential changes invalidate grants", async () => {
	const done = fixture();
	try {
		const { tokens } = await connect();
		assert.equal((await rpc(tokens.access_token, "tools/list")).status, 200);
		const refresh = await token({
			grant_type: "refresh_token",
			refresh_token: tokens.refresh_token,
		});
		assert.equal(refresh.status, 200);
		const next = await refresh.json();
		assert.notEqual(next.refresh_token, tokens.refresh_token);
		assert.equal((await rpc(tokens.access_token, "tools/list")).status, 401);
		assert.equal(
			(
				await token({
					grant_type: "refresh_token",
					refresh_token: tokens.refresh_token,
				})
			).status,
			400,
		);
		assert.equal((await rpc(next.access_token, "tools/list")).status, 401);
		const fresh = await connect();
		process.env.ORBIT_AUTH_PASSWORD = "rotated-test-password";
		assert.equal(
			(await rpc(fresh.tokens.access_token, "tools/list")).status,
			401,
		);
	} finally {
		done();
	}
});
test("HTTP MCP SDK initialization, compact reads, scope enforcement and approved selected application", async () => {
	const done = fixture(true);
	try {
		const item = await createOrbitItem({
			space: "inbox",
			title: "와디즈 계획",
			body: "A".repeat(5000),
			type: "note",
		});
		assert.ok(item);
		const read = await connect();
		const client = new Client({ name: "orbit-http-test", version: "1" });
		await client.connect(
			new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
				requestInit: {
					headers: { Authorization: `Bearer ${read.tokens.access_token}` },
				},
				fetch: async (input, init) =>
					handleMcpRequest(new Request(input, init)),
			}),
		);
		try {
			const { tools } = await client.listTools();
			assert.equal(tools.length, 5);
			assert.ok(tools.every((t) => t.annotations?.readOnlyHint));
			const result = await client.callTool({
				name: "orbit_assistant_search",
				arguments: { query: "와디즈" },
			});
			assert.equal(result.isError, undefined);
			assert.ok(JSON.stringify(result).length < 2000);
			const denied = await client.callTool({
				name: "orbit_decide_recommendations",
				arguments: { decision: "apply", selections: [] },
			});
			assert.equal(denied.isError, true);
		} finally {
			await client.close();
		}
		const write = await connect("orbit.read orbit.write orbit.apply");
		const proposal = {
			requestKey: "http-one",
			title: "연락",
			reason: "고객 확인",
			action: { kind: "create", type: "task", title: "연락" },
		};
		const call = await rpc(write.tokens.access_token, "tools/call", {
			name: "orbit_propose_action",
			arguments: proposal,
		});
		const proposed = await call.json();
		assert.equal(proposed.result.isError, undefined);
		const record = JSON.parse(proposed.result.content[0].text).recommendation;
		assert.equal((await listOrbitItems()).length, 1);
		const arguments_ = {
			decision: "apply",
			selections: [{ id: record.id, revision: record.revision }],
		};
		const applied = await (
			await rpc(write.tokens.access_token, "tools/call", {
				name: "orbit_decide_recommendations",
				arguments: arguments_,
			})
		).json();
		assert.equal(applied.result.isError, undefined);
		assert.equal((await listOrbitItems()).length, 2);
		await rpc(write.tokens.access_token, "tools/call", {
			name: "orbit_decide_recommendations",
			arguments: arguments_,
		});
		assert.equal((await listOrbitItems()).length, 2);
		assert.ok(
			(await loadAssistantState()).audit.some(
				(a) =>
					a.actor === "mcp" && a.action === "decide" && a.outcome === "success",
			),
		);
		const rows = databaseFor()
			.sql.prepare("SELECT value FROM metadata WHERE key LIKE 'mcp.oauth.v1/%'")
			.all();
		assert.ok(!JSON.stringify(rows).includes(write.tokens.access_token));
		assert.ok(!JSON.stringify(rows).includes(write.tokens.refresh_token));
	} finally {
		done();
	}
});
test("search follows relevance filters and pagination; full note reads include every tag and fresh edits", async () => {
	const done = fixture();
	try {
		for (let i = 0; i < 8; i++)
			await createOrbitItem({
				space: "inbox",
				title: `계획 ${i}`,
				body: `관련 메모 ${"x".repeat(5000)}`,
				type: "note",
			});
		const hidden = await createOrbitItem({
			space: "inbox",
			title: "계획 태그",
			type: "task",
			body: "tagged note content",
			due: "2026-10-12",
		});
		assert.ok(hidden);
		await fileOrbitItem(hidden.id, { space: "inbox", tags: ["no-ai"] });
		const found = await searchAssistantItems({ query: "계획" });
		assert.equal(found.items.length, 9);
		assert.equal(found.total, 9);
		assert.equal(found.nextOffset, null);
		assert.ok(
			found.items.every(
				(i) => i.excerpt.length <= 600 && !("body" in i) && !("path" in i),
			),
		);
		assert.equal((await searchAssistantItems({})).total, 9);
		const page = await searchAssistantItems({ query: "계획", limit: 6 });
		assert.equal(page.items.length, 6);
		assert.equal(page.nextOffset, 6);
		assert.equal(
			(await searchAssistantItems({ query: "계획", offset: 6 })).items.length,
			3,
		);
		assert.equal(
			(await fetchAssistantItem({ id: hidden.id })).body,
			"tagged note content",
		);
		const c = await compactAssistantContext({ date: "2026-10-12" });
		assert.ok(c.today.some((i) => i.id === hidden.id));
		assert.ok(await getOrbitItem(hidden.id));
		assert.equal((await listOrbitItems()).length, 9);
		const first = found.items.find((i) => i.type === "note");
		assert.ok(first);
		const detail = await fetchAssistantItem({ id: first.id });
		assert.ok(detail.body.length > 5000);
		assert.equal(detail.nextOffset, null);
		const chunk = await fetchAssistantItem({ id: first.id, length: 3000 });
		assert.equal(chunk.body, detail.body.slice(0, 3000));
		assert.equal(chunk.nextOffset, 3000);
		await fileOrbitItem(first.id, { space: "inbox", body: "updated now" });
		assert.equal(
			(await fetchAssistantItem({ id: first.id })).body,
			"updated now",
		);
		const event = await createOrbitItem({
			space: "inbox",
			title: "여러 날",
			body: "",
			type: "event",
			start: "2026-10-11T23:00:00",
			end: "2026-10-13T02:00:00",
		});
		assert.ok(event);
		assert.equal(
			(
				await searchAssistantItems({
					type: "event",
					from: "2026-10-12",
					to: "2026-10-12",
				})
			).items[0].id,
			event.id,
		);
	} finally {
		done();
	}
});
test("explicit revocation and expiration reject access; request bodies are bounded", async () => {
	const done = fixture();
	try {
		const { tokens } = await connect();
		const revoked = await handleMcpRequest(
			new Request(`${origin}/oauth/revoke`, {
				method: "POST",
				headers: { "content-type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams({
					client_id: "orbit-chatgpt",
					token: tokens.refresh_token,
				}),
			}),
		);
		assert.equal(revoked.status, 200);
		assert.equal((await rpc(tokens.access_token, "tools/list")).status, 401);
		const fresh = await connect();
		const large = await handleMcpRequest(
			new Request(`${origin}/mcp`, {
				method: "POST",
				headers: { authorization: `Bearer ${fresh.tokens.access_token}` },
				body: "x".repeat(65537),
			}),
		);
		assert.equal(large.status, 413);
		await withDatabase(() => {
			const key = `mcp.oauth.v1/access/${createHash("sha256").update(fresh.tokens.access_token).digest("hex")}`;
			const value = databaseFor().metadata<Record<string, unknown>>(key);
			databaseFor().setMetadata(key, { ...value, expires: 0 });
		}, true);
		assert.equal(
			(await rpc(fresh.tokens.access_token, "tools/list")).status,
			401,
		);
	} finally {
		done();
	}
});

test("OAuth scopes cannot escalate; tag changes stay readable but invalidate pending edits", async () => {
	const done = fixture(true);
	try {
		const { tokens } = await connect();
		const escalated = await token({
			grant_type: "refresh_token",
			refresh_token: tokens.refresh_token,
			scope: "orbit.read orbit.apply",
		});
		assert.equal(escalated.status, 400);
		const full = await connect("orbit.read orbit.write orbit.apply");
		const tools = await (
			await rpc(full.tokens.access_token, "tools/list")
		).json();
		assert.deepEqual(
			tools.result.tools.find(
				(t: { name: string }) => t.name === "orbit_decide_recommendations",
			).securitySchemes,
			[{ type: "oauth2", scopes: ["orbit.read", "orbit.apply"] }],
		);
		const item = await createOrbitItem({
			title: "before private",
			type: "note",
			body: "sensitive",
			space: "inbox",
		});
		assert.ok(item);
		const response = await (
			await rpc(full.tokens.access_token, "tools/call", {
				name: "orbit_propose_action",
				arguments: {
					requestKey: "private",
					title: "update",
					reason: "test",
					action: {
						kind: "update",
						itemId: item.id,
						patch: { title: "after" },
					},
				},
			})
		).json();
		const rec = JSON.parse(response.result.content[0].text).recommendation;
		await fileOrbitItem(item.id, { space: "inbox", tags: ["private"] });
		const records = await (
			await rpc(full.tokens.access_token, "tools/call", {
				name: "orbit_assistant_records",
				arguments: { kind: "recommendations" },
			})
		).json();
		assert.ok(JSON.stringify(records).includes(rec.id));
		const read = await (
			await rpc(full.tokens.access_token, "tools/call", {
				name: "orbit_assistant_record",
				arguments: { kind: "recommendations", id: rec.id },
			})
		).json();
		assert.equal(read.result.isError, undefined);
		assert.equal(
			JSON.parse(read.result.content[0].text).action.itemId,
			item.id,
		);
		const applied = await (
			await rpc(full.tokens.access_token, "tools/call", {
				name: "orbit_decide_recommendations",
				arguments: {
					decision: "apply",
					selections: [{ id: rec.id, revision: rec.revision }],
				},
			})
		).json();
		assert.equal(applied.result.isError, true);
		assert.equal(
			JSON.parse(applied.result.content[0].text).error,
			"item_conflict",
		);
		assert.equal((await getOrbitItem(item.id))?.title, "before private");
		const fakeApproval = await (
			await rpc(full.tokens.access_token, "tools/call", {
				name: "orbit_decide_recommendations",
				arguments: {
					approved: true,
					decision: "apply",
					selections: [{ id: rec.id, revision: rec.revision }],
				},
			})
		).json();
		assert.equal(fakeApproval.result.isError, true);
		process.env.ORBIT_MCP_CLIENT_ID = "changed-client";
		assert.equal(
			(await rpc(full.tokens.access_token, "tools/list")).status,
			401,
		);
	} finally {
		done();
	}
});

test("HTTP requested creates require write scope and never modify existing content", async () => {
	const done = fixture(true);
	try {
		const original = await createOrbitItem({
			space: "inbox",
			type: "note",
			title: "기존 메모",
			body: "유지할 내용",
		});
		assert.ok(original);
		const read = await connect();
		const writer = await connect("orbit.read orbit.write");
		const args = {
			requestKey: "http-requested-save",
			type: "note",
			title: "기존 메모",
			body: "정리한 새 메모",
		};
		const call = async (
			accessToken: string,
			name: string,
			arguments_: unknown,
		) =>
			(
				await rpc(accessToken, "tools/call", { name, arguments: arguments_ })
			).json();
		assert.equal(
			(await call(read.tokens.access_token, "orbit_create_item", args)).result
				.isError,
			true,
		);
		const result = await call(
			writer.tokens.access_token,
			"orbit_create_item",
			args,
		);
		assert.equal(result.result.isError, undefined);
		const receipt = JSON.parse(result.result.content[0].text);
		assert.equal(receipt.saved, true);
		assert.notEqual(receipt.itemId, original.id);
		await call(writer.tokens.access_token, "orbit_create_item", args);
		assert.equal((await listOrbitItems()).length, 2);
		assert.equal((await getOrbitItem(original.id))?.body, "유지할 내용");
		const proposal = await call(
			writer.tokens.access_token,
			"orbit_propose_action",
			{
				requestKey: "needs-confirmation",
				title: "기존 메모 수정",
				reason: "정리 제안",
				action: {
					kind: "update",
					itemId: original.id,
					patch: { body: "수정 제안" },
				},
			},
		);
		const record = JSON.parse(proposal.result.content[0].text).recommendation;
		assert.equal(record.state, "pending");
		assert.equal((await getOrbitItem(original.id))?.body, "유지할 내용");
		assert.equal(
			(
				await call(writer.tokens.access_token, "orbit_decide_recommendations", {
					decision: "apply",
					selections: [{ id: record.id, revision: record.revision }],
				})
			).result.isError,
			true,
		);
		assert.equal((await getOrbitItem(original.id))?.body, "유지할 내용");
	} finally {
		done();
	}
});
