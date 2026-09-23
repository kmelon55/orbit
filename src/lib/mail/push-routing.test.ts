import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock, test } from "node:test";
import webpush, { type PushSubscription } from "web-push";
import { handleMailRequest } from "./http.server";
import { mailStore } from "./store.server";

test("push test routes target this device and carry a unique receipt ID without claiming delivery", async () => {
	const directory = mkdtempSync(join(tmpdir(), "orbit-push-routing-"));
	const env = { ...process.env };
	process.env.ORBIT_MAIL_DIR = directory;
	process.env.ORBIT_VAULT_DIR = directory;
	process.env.ORBIT_MAIL_WORKER = "off";
	process.env.ORBIT_PUBLIC_URL = "https://orbit.example.com";
	delete process.env.ORBIT_AUTH_USERNAME;
	delete process.env.ORBIT_AUTH_PASSWORD;
	const endpoint = "https://updates.push.services.mozilla.com/test-device";
	const calls: {
		endpoint: string;
		payload: { testId: string; tag: string };
	}[] = [];
	const send = mock.method(
		webpush,
		"sendNotification",
		async (sub: PushSubscription, payload?: string | Buffer | null) => {
			calls.push({
				endpoint: sub.endpoint,
				payload: JSON.parse(String(payload)),
			});
		},
	);
	const request = (body: unknown) =>
		handleMailRequest(
			new Request("http://localhost/api/mail/push/test", {
				method: "POST",
				headers: {
					Origin: "http://localhost",
					"Content-Type": "application/json",
				},
				body: JSON.stringify(body),
			}),
		);
	try {
		const store = mailStore();
		store.addSubscription(
			{ endpoint, keys: { p256dh: "test", auth: "test" } },
			endpoint,
		);
		const testId = randomUUID();
		const response = await request({ endpoint, testId });
		assert.equal(response.status, 200);
		assert.deepEqual(await response.json(), { ok: true, testId });
		assert.equal(calls[0].endpoint, endpoint);
		assert.equal(calls[0].payload.testId, testId);
		await request({ endpoint });
		assert.notEqual(calls[1].payload.tag, calls[0].payload.tag);
		assert.equal((await request({ endpoint, testId: "invalid" })).status, 400);
		assert.equal(
			(await request({ endpoint: `${endpoint}-missing` })).status,
			400,
		);
		assert.equal(calls.length, 2);
	} finally {
		send.mock.restore();
		mailStore().db.close();
		process.env = env;
		rmSync(directory, { recursive: true, force: true });
	}
});
