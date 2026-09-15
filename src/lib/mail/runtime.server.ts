import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ImapFlow } from "imapflow";
import { gmailRequest } from "./gmail.server";
import { imapClient } from "./imap.server";
import { flushMailPush, notifyMail } from "./push.server";
import { accountQueue, listRemote, publicError } from "./service.server";
import { mailDirectory, mailStore } from "./store.server";
import type { MailAccount } from "./types";

type Runtime = {
	timer: ReturnType<typeof setInterval> | null;
	clients: Map<string, ImapFlow>;
	busy: Set<string>;
	stopped: boolean;
	failures: Map<string, { count: number; next: number }>;
};
const globalMail = globalThis as typeof globalThis & {
	orbitMailRuntime?: Runtime;
};
function runtime() {
	globalMail.orbitMailRuntime ??= {
		timer: null,
		clients: new Map(),
		busy: new Set(),
		stopped: false,
		failures: new Map(),
	};
	return globalMail.orbitMailRuntime;
}
export async function syncAccount(id: string) {
	const r = runtime();
	if (r.busy.has(id)) return;
	r.busy.add(id);
	try {
		await accountQueue(id, async () => {
			const s = mailStore();
			const a = s.account(id);
			const prior = s.setting<number>(`baseline:${id}`);
			const syncStarted = Date.now();
			const page = await listRemote(a, "inbox");
			const newest: import("./types").MailMessage[] = [];
			function discover(messages: import("./types").MailMessage[]) {
				let allNew = messages.length > 0;
				for (const m of messages) {
					const unseen = s.markSeen(id, m.remoteId);
					if (!unseen || (prior !== null && m.date < prior)) allNew = false;
					if (unseen && prior !== null && m.date >= prior && m.unread)
						newest.push(m);
				}
				return allNew;
			}
			const allNew = discover(page.messages);
			let cursor =
				s.setting<string>(`catchup:${id}`) ||
				(prior !== null && allNew ? page.cursor : null);
			for (let i = 0; cursor && i < 9; i++) {
				const older = await listRemote(a, "inbox", cursor);
				cursor = discover(older.messages) ? older.cursor : null;
			}
			s.setSetting(`catchup:${id}`, cursor);
			if (prior === null) s.setSetting(`baseline:${id}`, syncStarted);
			let mode: MailAccount["mode"] = "poll";
			let watchExpires = a.watchExpires;
			if (
				a.provider === "gmail" &&
				process.env.ORBIT_GMAIL_PUBSUB_TOPIC &&
				process.env.ORBIT_GMAIL_PUSH_EMAIL
			) {
				if (!watchExpires || watchExpires < Date.now() + 86_400_000) {
					try {
						const watch = await gmailRequest<{ expiration: string }>(
							a,
							"watch",
							{
								method: "POST",
								body: JSON.stringify({
									topicName: process.env.ORBIT_GMAIL_PUBSUB_TOPIC,
									labelIds: ["INBOX"],
									labelFilterBehavior: "include",
								}),
							},
						);
						watchExpires = Number(watch.expiration);
					} catch {
						watchExpires = undefined;
					}
				}
				mode = watchExpires ? "push" : "poll";
			} else if (a.provider !== "gmail") {
				let client = r.clients.get(id);
				if (client && !client.usable) {
					client.close();
					r.clients.delete(id);
					client = undefined;
				}
				if (!client && !r.stopped) {
					client = imapClient(a);
					r.clients.set(id, client);
					client.on("exists", () => {
						void syncAccount(id);
					});
					client.on("flags", () => {
						void syncAccount(id);
					});
					client.on("close", () => {
						if (r.clients.get(id) === client) r.clients.delete(id);
					});
					try {
						await client.connect();
						await client.mailboxOpen("INBOX");
					} catch {
						client.close();
						r.clients.delete(id);
						client = undefined;
					}
				}
				mode = client?.capabilities.has("IDLE") ? "idle" : "poll";
			}
			s.saveAccount({
				...s.account(id),
				lastSync: Date.now(),
				error: null,
				mode,
				watchExpires,
			});
			r.failures.delete(id);
			await notifyMail(a, newest);
		});
	} catch (error) {
		const failure = r.failures.get(id);
		const count = (failure?.count || 0) + 1;
		r.failures.set(id, {
			count,
			next: Date.now() + Math.min(900_000, 30_000 * 2 ** Math.min(count, 5)),
		});
		const a = mailStore()
			.accounts()
			.find((a) => a.id === id);
		if (a) mailStore().saveAccount({ ...a, error: publicError(error) });
	} finally {
		r.busy.delete(id);
	}
}
export function stopAccount(id: string) {
	const r = runtime();
	r.clients.get(id)?.close();
	r.clients.delete(id);
	r.failures.delete(id);
}
export function startMailRuntime() {
	const r = runtime();
	if (r.timer || process.env.ORBIT_MAIL_WORKER === "off") return;
	r.stopped = false;
	const tick = () => {
		try {
			if (!existsSync(join(mailDirectory(), "mail.sqlite"))) return;
			void flushMailPush().catch(() => {});
			for (const a of mailStore().accounts())
				if ((r.failures.get(a.id)?.next || 0) <= Date.now())
					void syncAccount(a.id);
		} catch {
			console.error(
				"Orbit Mail 저장소를 열지 못했습니다. Mail 화면에서 오류를 확인해 주세요.",
			);
		}
	};
	// No work or database is created until the first account is configured.
	r.timer = setInterval(tick, 60_000);
	r.timer.unref();
	tick();
}
export function stopMailRuntime() {
	const r = runtime();
	r.stopped = true;
	if (r.timer) clearInterval(r.timer);
	r.timer = null;
	for (const c of r.clients.values()) c.close();
	r.clients.clear();
}
