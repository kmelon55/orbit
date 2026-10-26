import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(
	new URL("../../../public/sw.js", import.meta.url),
	"utf8",
);
const origin = "https://orbit.test";

function asset(
	body: string,
	type = "text/javascript",
	redirected = false,
): Response {
	const response = new Response(body, { headers: { "content-type": type } });
	Object.defineProperties(response, {
		type: { value: "basic" },
		redirected: { value: redirected },
		clone: { value: () => asset(body, type, redirected) },
	});
	return response;
}

function worker(network: Response, cached?: Response, brokenCache = false) {
	const handlers = new Map<string, (event: unknown) => void>();
	const entries = new Map<string, Response>();
	const removed: string[] = [];
	let requests = 0;
	const path = `${origin}/assets/note-editor-old.js`;
	if (cached) entries.set(path, cached);
	const cache = {
		match: async (request: Request) => entries.get(request.url),
		delete: async (request: Request) => entries.delete(request.url),
		put: async (request: Request, response: Response) => {
			entries.set(request.url, response);
		},
	};
	runInNewContext(source, {
		URL,
		self: {
			location: { origin },
			addEventListener: (name: string, handler: (event: unknown) => void) =>
				handlers.set(name, handler),
			clients: { claim: async () => {} },
		},
		caches: {
			open: async () => {
				if (brokenCache) throw new Error("disabled");
				return cache;
			},
			keys: async () => [
				"orbit-static-v2",
				"orbit-static-v3",
				"unrelated-cache",
			],
			delete: async (key: string) => {
				removed.push(key);
			},
		},
		fetch: async () => {
			requests++;
			return network;
		},
	});
	return {
		entries,
		removed,
		path,
		requests: () => requests,
		async request(url = path, mode?: RequestMode) {
			let result: Promise<Response> | undefined;
			const pending: Promise<unknown>[] = [];
			handlers.get("fetch")?.({
				request: mode ? { method: "GET", url, mode } : new Request(url),
				respondWith: (response: Promise<Response>) => {
					result = response;
				},
				waitUntil: (promise: Promise<unknown>) => pending.push(promise),
			});
			const response = await result;
			await Promise.all(pending);
			return response;
		},
		async activate() {
			let pending: Promise<unknown> | undefined;
			handlers.get("activate")?.({
				waitUntil: (value: Promise<unknown>) => {
					pending = value;
				},
			});
			await pending;
		},
	};
}

test("a redirected login page is never cached as a JavaScript module", async () => {
	const w = worker(asset("<html>Login</html>", "text/html", true));
	await w.request();
	assert.equal(w.entries.size, 0);
});

test("poisoned cached HTML is evicted and replaced by actual JavaScript", async () => {
	const w = worker(
		asset("export default 1"),
		asset("<html>Login</html>", "text/html"),
	);
	assert.equal(await (await w.request())?.text(), "export default 1");
	assert.equal(w.requests(), 1);
	assert.equal(
		w.entries.get(w.path)?.headers.get("content-type"),
		"text/javascript",
	);
});

test("cached valid chunks keep old open tabs working without network access", async () => {
	const w = worker(
		asset("<html>Login</html>", "text/html", true),
		asset("export default 1"),
	);
	assert.equal(await (await w.request())?.text(), "export default 1");
	assert.equal(w.requests(), 0);
});

test("wrong MIME types and redirects cannot poison module or stylesheet cache", async () => {
	for (const response of [
		asset("{}", "application/json"),
		asset("code", "text/javascript", true),
	]) {
		const w = worker(response);
		await w.request();
		assert.equal(w.entries.size, 0);
	}
	const w = worker(asset("code", "text/javascript"));
	await w.request(`${origin}/assets/app.css`);
	assert.equal(w.entries.size, 0);
});

test("unavailable CacheStorage falls back to the network", async () => {
	const w = worker(asset("export default 1"), undefined, true);
	assert.equal(await (await w.request())?.text(), "export default 1");
	assert.equal(w.requests(), 1);
});

test("private documents and API requests remain outside service-worker caching", async () => {
	const w = worker(asset("private", "text/html"));
	assert.equal(await w.request(`${origin}/notes`, "navigate"), undefined);
	assert.equal(await w.request(`${origin}/api/mail/draft`), undefined);
	assert.equal(await w.request(`${origin}/_server/function`), undefined);
	assert.equal(w.requests(), 0);
});

test("activation removes the poisoned old asset cache without clearing unrelated data", async () => {
	const w = worker(asset(""));
	await w.activate();
	assert.deepEqual(w.removed, ["orbit-static-v2"]);
});
