import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
	type AssistantScope,
	createAssistantMcpServer,
} from "../../mcp/assistant";
import {
	handleMcpOAuth,
	McpHttpError,
	mcpConfig,
	mcpJson,
	privateHeaders,
	smallBody,
	verifyMcpAccess,
} from "./mcp-auth.server";

// Bounded process-local abuse guard, not a substitute for reverse-proxy limits.
const windows = new Map<string, { count: number; until: number }>();
function rate(key: string, limit: number) {
	const now = Date.now();
	for (const [k, v] of windows) if (v.until <= now) windows.delete(k);
	const value = windows.get(key) ?? { count: 0, until: now + 60_000 };
	if (++value.count > limit || windows.size > 1000)
		throw new McpHttpError(429, "rate_limited");
	windows.set(key, value);
}
export async function handleMcpRequest(request: Request) {
	try {
		const c = mcpConfig(),
			url = new URL(request.url);
		if (url.host !== new URL(c.origin).host)
			throw new McpHttpError(403, "invalid_host");
		const origin = request.headers.get("origin");
		if (origin && origin !== c.origin && origin !== "https://chatgpt.com")
			throw new McpHttpError(403, "invalid_origin");
		if (url.pathname !== "/mcp") {
			if (
				![
					"/oauth/authorize",
					"/oauth/token",
					"/oauth/revoke",
					"/.well-known/oauth-protected-resource",
					"/.well-known/oauth-authorization-server",
				].includes(url.pathname)
			)
				throw new McpHttpError(404, "not_found");
			rate(`oauth:${url.pathname}`, 120);
			return await handleMcpOAuth(request, c);
		}
		let principal: Awaited<ReturnType<typeof verifyMcpAccess>>;
		try {
			principal = await verifyMcpAccess(request, c);
		} catch {
			return mcpJson({ error: "invalid_token" }, 401, {
				"WWW-Authenticate": `Bearer resource_metadata="${c.origin}/.well-known/oauth-protected-resource", scope="orbit.read"`,
			});
		}
		rate(`mcp:${principal.clientId}`, 120);
		if (request.method !== "POST")
			return mcpJson({ error: "method_not_allowed" }, 405, { Allow: "POST" });
		const body = await smallBody(request);
		let parsed: unknown;
		try {
			parsed = JSON.parse(body);
		} catch {
			throw new McpHttpError(400, "invalid_json");
		}
		const scopes: AssistantScope[] = ["read"];
		if (principal.scopes.includes("orbit.write")) scopes.push("write");
		if (principal.scopes.includes("orbit.apply")) scopes.push("apply");
		const server = createAssistantMcpServer(scopes, true);
		const transport = new WebStandardStreamableHTTPServerTransport({
			sessionIdGenerator: undefined,
			enableJsonResponse: true,
		});
		try {
			await server.connect(transport);
			const response = await transport.handleRequest(request, {
				parsedBody: parsed,
			});
			const headers = new Headers(response.headers);
			for (const [k, v] of Object.entries(privateHeaders)) headers.set(k, v);
			let payload = await response.arrayBuffer();
			// SDK 1.x emits extension fields only in _meta. Mirror the OAuth policy
			// into ChatGPT's top-level tools/list extension without changing handlers.
			if (
				parsed &&
				typeof parsed === "object" &&
				"method" in parsed &&
				parsed.method === "tools/list" &&
				response.ok
			) {
				const document = JSON.parse(new TextDecoder().decode(payload));
				if (Array.isArray(document.result?.tools))
					for (const tool of document.result.tools)
						tool.securitySchemes = tool._meta?.securitySchemes;
				payload = new TextEncoder().encode(JSON.stringify(document)).buffer;
			}
			return new Response(payload.byteLength ? payload : null, {
				status: response.status,
				headers,
			});
		} finally {
			await server.close();
		}
	} catch (error) {
		return mcpJson(
			{ error: error instanceof McpHttpError ? error.code : "request_failed" },
			error instanceof McpHttpError ? error.status : 500,
		);
	}
}
