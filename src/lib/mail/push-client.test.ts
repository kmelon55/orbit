import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mock, test } from "node:test";
import { runInNewContext } from "node:vm";
import {
	savePushSubscription,
	waitForPushTest,
	withPushTimeout,
} from "./push-browser";

test("push tests ignore other tests, report display failures, and clean up listeners", async () => {
	const target = new EventTarget();
	const removed = mock.method(target, "removeEventListener");
	const receipt = waitForPushTest(target, "current");
	target.dispatchEvent(
		new MessageEvent("message", {
			data: { type: "orbit-push-test", testId: "other", displayed: true },
		}),
	);
	assert.equal(removed.mock.callCount(), 0);
	target.dispatchEvent(
		new MessageEvent("message", {
			data: { type: "orbit-push-test", testId: "current", displayed: false },
		}),
	);
	assert.equal((await receipt.result)?.displayed, false);
	assert.equal(removed.mock.callCount(), 1);
	removed.mock.restore();
});

test("push timeout and cancellation never claim receipt", async () => {
	const target = new EventTarget();
	assert.equal(await waitForPushTest(target, "missing", 1).result, null);
	const cancelled = waitForPushTest(target, "cancelled");
	cancelled.cancel();
	assert.equal(await cancelled.result, null);
	await assert.rejects(
		withPushTimeout(new Promise(() => {}), "not ready", 1),
		/not ready/,
	);
});

test("existing subscriptions refresh server registration and changed VAPID keys renew them", async () => {
	const requests: string[] = [];
	const fetchMock = mock.method(
		globalThis,
		"fetch",
		async (url: string | URL | Request) => {
			requests.push(String(url));
			return Response.json({ ok: true });
		},
	);
	try {
		let unsubscribed = false;
		let subscribed = false;
		const sub = {
			endpoint: "https://updates.push.services.mozilla.com/test",
			options: { applicationServerKey: new Uint8Array([1, 2, 3]).buffer },
			unsubscribe: async () => {
				unsubscribed = true;
				return true;
			},
			toJSON: () => ({
				endpoint: "https://updates.push.services.mozilla.com/test",
			}),
		};
		const registration = {
			pushManager: {
				getSubscription: async () => sub,
				subscribe: async () => {
					subscribed = true;
					return sub;
				},
			},
		} as unknown as ServiceWorkerRegistration;
		await savePushSubscription(registration, "AQID");
		assert.deepEqual(requests, ["/api/mail/push/subscribe"]);
		assert.equal(subscribed, false);
		await savePushSubscription(registration, "BAUG");
		assert.equal(unsubscribed, true);
		assert.equal(subscribed, true);
		assert.deepEqual(requests.slice(1), [
			"/api/mail/push/unsubscribe",
			"/api/mail/push/subscribe",
		]);
	} finally {
		fetchMock.mock.restore();
	}
});

for (const fails of [false, true]) {
	test(`service worker acknowledges the notification API ${fails ? "failure" : "success"} and re-alerts`, async () => {
		const handlers = new Map<string, (event: unknown) => void>();
		const receipts: { testId: string; displayed: boolean }[] = [];
		let options: { renotify: boolean; data: { url: string } } | undefined;
		runInNewContext(
			readFileSync(new URL("../../../public/sw.js", import.meta.url), "utf8"),
			{
				URL,
				self: {
					location: { origin: "https://orbit.example.com" },
					addEventListener: (type: string, handler: (event: unknown) => void) =>
						handlers.set(type, handler),
					registration: {
						showNotification: async (_title: string, value: typeof options) => {
							options = value;
							if (fails) throw new Error("permission denied");
						},
					},
					clients: {
						matchAll: async () => [
							{
								postMessage: (receipt: (typeof receipts)[number]) =>
									receipts.push(receipt),
							},
						],
					},
				},
			},
		);
		let pending: Promise<void> = Promise.resolve();
		handlers.get("push")?.({
			data: {
				json: () => ({
					title: "Test",
					testId: "receipt-id",
					url: "https://other.example.com/mail",
				}),
			},
			waitUntil: (promise: Promise<void>) => {
				pending = promise;
			},
		});
		if (fails) await assert.rejects(pending, /permission denied/);
		else await pending;
		assert.equal(options?.renotify, true);
		assert.equal(options?.data.url, "/mail");
		assert.equal(receipts[0]?.testId, "receipt-id");
		assert.equal(receipts[0]?.displayed, !fails);
	});
}
