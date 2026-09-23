import { mailApi } from "./client";

function decodeKey(value: string) {
	const raw = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
	return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function withPushTimeout<T>(
	promise: Promise<T>,
	message: string,
	ms = 15_000,
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error(message)), ms);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

export function assertPushSupport() {
	if (
		!window.isSecureContext ||
		!("serviceWorker" in navigator) ||
		!("PushManager" in window) ||
		!("Notification" in window)
	) {
		throw new Error(
			"이 브라우저에서는 푸시를 사용할 수 없습니다. HTTPS 주소로 접속해 주세요. 아이폰은 홈 화면에 Orbit을 추가한 뒤 열어 주세요.",
		);
	}
}

export async function pushRegistration() {
	assertPushSupport();
	await withPushTimeout(
		navigator.serviceWorker.register("/sw.js", {
			scope: "/",
			updateViaCache: "none",
		}),
		"알림 기능을 준비하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.",
	);
	return withPushTimeout(
		navigator.serviceWorker.ready,
		"알림 기능이 준비되지 않았습니다. 페이지를 새로고침하고 다시 시도해 주세요.",
	);
}

export async function savePushSubscription(
	registration: ServiceWorkerRegistration,
	publicKey: string,
) {
	const key = decodeKey(publicKey);
	let sub = await registration.pushManager.getSubscription();
	const currentKey = sub?.options.applicationServerKey;
	if (
		sub &&
		(!currentKey ||
			new Uint8Array(currentKey).length !== key.length ||
			!new Uint8Array(currentKey).every((byte, i) => byte === key[i]))
	) {
		await mailApi("push/unsubscribe", { endpoint: sub.endpoint });
		await sub.unsubscribe();
		sub = null;
	}
	if (!sub) {
		try {
			sub = await withPushTimeout(
				registration.pushManager.subscribe({
					userVisibleOnly: true,
					applicationServerKey: key,
				}),
				"푸시 연결이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.",
			);
		} catch (error) {
			if (error instanceof DOMException && error.name === "AbortError") {
				throw new Error(
					"브라우저가 푸시 서버에 연결하지 못했습니다. Zen/Firefox의 알림 권한과 네트워크 연결을 확인한 뒤 다시 시도해 주세요.",
				);
			}
			throw error;
		}
	}
	// Re-register existing browser subscriptions too: the server or login session may have changed.
	await mailApi("push/subscribe", sub.toJSON());
	return sub;
}

type PushTestReceipt = {
	type: "orbit-push-test";
	testId: string;
	displayed: boolean;
};

export function waitForPushTest(
	target: EventTarget,
	testId: string,
	timeout = 12_000,
) {
	let finish: (receipt: PushTestReceipt | null) => void;
	const result = new Promise<PushTestReceipt | null>((resolve) => {
		finish = resolve;
	});
	const settle = (receipt: PushTestReceipt | null) => {
		clearTimeout(timer);
		target.removeEventListener("message", onMessage);
		finish(receipt);
	};
	const onMessage = (event: Event) => {
		const data = (event as MessageEvent).data;
		if (
			data?.type === "orbit-push-test" &&
			data.testId === testId &&
			typeof data.displayed === "boolean"
		)
			settle(data);
	};
	const timer = setTimeout(() => settle(null), timeout);
	target.addEventListener("message", onMessage);
	return { result, cancel: () => settle(null) };
}
