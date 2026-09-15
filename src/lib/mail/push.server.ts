import { createHash } from "node:crypto";
import webpush, { type PushSubscription } from "web-push";
import { z } from "zod";
import {
	getOrbitAuthConfig,
	verifyOrbitSessionToken,
} from "../orbit/auth.server";
import { mailConfig } from "./config.server";
import { mailStore } from "./store.server";
import type { MailAccount, MailMessage } from "./types";

export const subscriptionSchema = z.object({
	endpoint: z
		.url()
		.max(2048)
		.refine((value) => {
			const u = new URL(value);
			return (
				u.protocol === "https:" &&
				!u.username &&
				!u.password &&
				(!u.port || u.port === "443") &&
				(u.hostname === "fcm.googleapis.com" ||
					u.hostname === "updates.push.services.mozilla.com" ||
					u.hostname.endsWith(".push.apple.com") ||
					u.hostname === "web.push.apple.com" ||
					u.hostname.endsWith(".notify.windows.com"))
			);
		}, "지원하지 않는 푸시 서버입니다."),
	keys: z.object({
		p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}$/),
		auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
	}),
});
export function pushKeys() {
	const s = mailStore();
	let keys = s.setting<{ publicKey: string; privateKey: string }>("vapid");
	if (!keys) {
		keys = webpush.generateVAPIDKeys();
		s.setSetting("vapid", keys);
	}
	return keys;
}
export function pushConfigured() {
	return Boolean(mailConfig().publicUrl.startsWith("https://"));
}
export async function sendPush(
	subscription: PushSubscription,
	payload: unknown,
) {
	if (!pushConfigured())
		throw new Error(
			"폰 알림을 사용하려면 서버에 HTTPS Orbit 주소를 설정해 주세요.",
		);
	const keys = pushKeys();
	try {
		await webpush.sendNotification(subscription, JSON.stringify(payload), {
			vapidDetails: { subject: mailConfig().publicUrl, ...keys },
			TTL: 3600,
			urgency: "normal",
			timeout: 10_000,
		});
	} catch (error) {
		if (
			error instanceof webpush.WebPushError &&
			(error.statusCode === 404 || error.statusCode === 410)
		)
			mailStore().removeSubscription(subscription.endpoint);
		throw error;
	}
}
export async function notifyMail(
	account: MailAccount,
	messages: MailMessage[],
) {
	if (!account.notifications || !messages.length || !pushConfigured()) return;
	const preview = mailStore().setting<boolean>("notificationPreview") ?? true;
	const first = messages[0];
	const payload = {
		title: preview
			? first.from[0]?.name || first.from[0]?.address || account.email
			: "새 메일이 도착했습니다",
		body: preview
			? `${first.subject}${messages.length > 1 ? ` 외 ${messages.length - 1}개` : ""}`
			: account.email,
		url: `/mail?message=${first.id}`,
		tag: `orbit-mail-${account.id}`,
		timestamp: Date.now(),
	};
	const s = mailStore();
	const subscriptions = s.subscriptions<PushSubscription>();
	for (const sub of subscriptions) {
		const key = createHash("sha256")
			.update(
				`${account.id}:${messages
					.map((m) => m.remoteId)
					.sort()
					.join(",")}:${sub.endpoint}`,
			)
			.digest("hex");
		s.db
			.prepare(
				"INSERT OR IGNORE INTO push_jobs (id,account_id,data,next_at,expires) VALUES (?,?,?,?,?)",
			)
			.run(
				key,
				account.id,
				s.seal({ endpoint: sub.endpoint, payload }),
				Date.now(),
				Date.now() + 3600_000,
			);
	}
	await flushMailPush();
}

let flushing = false;
export async function flushMailPush() {
	if (flushing || !pushConfigured()) return;
	flushing = true;
	try {
		const s = mailStore();
		s.db.prepare("DELETE FROM push_jobs WHERE expires<?").run(Date.now());
		const config = getOrbitAuthConfig();
		for (const job of s.db
			.prepare(
				"SELECT id,account_id,data,attempt FROM push_jobs WHERE next_at<=? LIMIT 30",
			)
			.all(Date.now()) as {
			id: string;
			account_id: string;
			data: string;
			attempt: number;
		}[]) {
			const data = s.unseal<{ endpoint: string; payload: unknown }>(job.data);
			const subscription = s
				.subscriptions<PushSubscription & { session?: string }>()
				.find((sub) => sub.endpoint === data.endpoint);
			const enabled = s
				.accounts()
				.find((a) => a.id === job.account_id)?.notifications;
			if (
				!subscription ||
				!enabled ||
				(config.enabled &&
					!verifyOrbitSessionToken(subscription.session, config))
			) {
				s.db.prepare("DELETE FROM push_jobs WHERE id=?").run(job.id);
				if (
					subscription &&
					config.enabled &&
					!verifyOrbitSessionToken(subscription.session, config)
				)
					s.removeSubscription(subscription.endpoint);
				continue;
			}
			try {
				await sendPush(subscription, data.payload);
				s.db.prepare("DELETE FROM push_jobs WHERE id=?").run(job.id);
			} catch {
				s.db
					.prepare(
						"UPDATE push_jobs SET attempt=attempt+1,next_at=? WHERE id=?",
					)
					.run(
						Date.now() +
							Math.min(600_000, 30_000 * 2 ** Math.min(job.attempt, 5)),
						job.id,
					);
			}
		}
	} finally {
		flushing = false;
	}
}
