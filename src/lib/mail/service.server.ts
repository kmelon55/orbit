import { createHash, randomUUID } from "node:crypto";
import MailComposer from "nodemailer/lib/mail-composer";
import { parseMail, toDetail } from "./content.server";
import { gmailRaw, gmailRequest, listGmail, mutateGmail } from "./gmail.server";
import {
	findMailbox,
	imapClient,
	imapRaw,
	listImap,
	mutateImap,
	smtpClient,
	usingImap,
} from "./imap.server";
import { mailStore } from "./store.server";
import {
	connectSchema,
	MAX_SEND_BYTES,
	type MailAccount,
	type MailFolder,
	type SendMail,
	type SendResult,
} from "./types";

const globalQueues = globalThis as typeof globalThis & {
	orbitMailQueues?: Map<string, Promise<unknown>>;
};
globalQueues.orbitMailQueues ??= new Map();
const queues = globalQueues.orbitMailQueues;
export async function accountQueue<T>(
	id: string,
	fn: () => Promise<T>,
): Promise<T> {
	const last = queues.get(id) || Promise.resolve();
	const next = last.catch(() => {}).then(fn);
	queues.set(id, next);
	try {
		return await next;
	} finally {
		if (queues.get(id) === next) queues.delete(id);
	}
}
export function publicError(error: unknown) {
	// Never return provider diagnostics containing addresses, tokens, raw messages, or passwords.
	const message = error instanceof Error ? error.message : "";
	if (/^[가-힣]/.test(message)) return message;
	return "메일 서비스에 연결하지 못했습니다. 계정 연결과 네트워크를 확인해 주세요.";
}
export async function connectImap(input: unknown) {
	const data = connectSchema.parse(input);
	const s = mailStore();
	const existing = s
		.accounts()
		.find((a) => a.email.toLowerCase() === data.email.toLowerCase());
	const account: MailAccount = {
		id: existing?.id || randomUUID(),
		provider: data.provider,
		email: data.email,
		name: data.name || data.email,
		notifications: existing?.notifications ?? true,
		createdAt: existing?.createdAt || Date.now(),
		lastSync: existing?.lastSync || null,
		error: null,
	};
	return accountQueue(account.id, async () => {
		const secret = { password: data.password };
		const client = imapClient(account, secret);
		try {
			await client.connect();
			await smtpClient(account, secret).verify();
		} finally {
			await client.logout().catch(() => client.close());
		}
		s.saveAccount(account, secret);
		return account;
	});
}
export async function listRemote(
	account: MailAccount,
	folder: MailFolder,
	cursor?: string,
	query?: string,
) {
	const result =
		account.provider === "gmail"
			? await listGmail(account, folder, cursor, query)
			: await listImap(account, folder, cursor, query);
	if ("uidValidity" in result) {
		for (const cached of mailStore().messages(account.id, folder)) {
			if (cached.uidValidity !== result.uidValidity)
				mailStore().deleteMessage(cached.id);
		}
	}
	mailStore().saveMessages(result.messages);
	// Only a fresh, unfiltered page can establish removal from the visible window.
	if (!cursor && !query)
		mailStore().reconcile(
			account.id,
			folder,
			result.messages.map((m) => m.id),
			!result.cursor,
			Math.min(...result.messages.map((m) => m.date)),
		);
	return result;
}
export async function rawMessage(id: string) {
	const m = mailStore().message(id);
	const a = mailStore().account(m.accountId);
	return {
		message: m,
		parsed: await parseMail(
			a.provider === "gmail" ? await gmailRaw(a, m) : await imapRaw(a, m),
		),
	};
}
export async function detailMessage(id: string, remoteImages = false) {
	const { message, parsed } = await rawMessage(id);
	return toDetail(message, parsed, remoteImages);
}
export async function mutateMessage(
	id: string,
	action: "read" | "unread" | "trash" | "archive",
) {
	const m = mailStore().message(id);
	return accountQueue(m.accountId, async () => {
		const a = mailStore().account(m.accountId);
		if (action === "trash" && m.folder === "trash")
			throw new Error("이미 휴지통에 있는 메일입니다.");
		if (a.provider === "gmail") await mutateGmail(a, m, action);
		else await mutateImap(a, m, action);
		if (action === "read" || action === "unread") {
			// Gmail labels share read state across folders.
			for (const folder of ["inbox", "sent", "trash", "archive"]) {
				for (const cached of mailStore().messages(a.id, folder))
					if (
						cached.remoteId === m.remoteId &&
						(a.provider === "gmail" || cached.mailbox === m.mailbox)
					)
						mailStore().saveMessages([
							{ ...cached, unread: action === "unread" },
						]);
			}
		} else mailStore().deleteMessage(id);
		return { ok: true };
	});
}
export async function sendMail(data: SendMail): Promise<SendResult> {
	const attachments: { filename: string; content: Buffer }[] =
		data.attachments.map((a) => ({
			filename: a.name,
			content: Buffer.from(a.content, "base64"),
		}));
	if (
		attachments.reduce((sum, a) => sum + a.content.length, 0) > MAX_SEND_BYTES
	)
		throw new Error("첨부파일 합계는 15MB 이하여야 합니다.");
	return accountQueue(data.accountId, async () => {
		const s = mailStore();
		const account = s.account(data.accountId);
		const hash = createHash("sha256")
			.update(JSON.stringify(data))
			.digest("hex");
		const existing = s.db
			.prepare("SELECT hash,result FROM sends WHERE id=?")
			.get(data.requestId) as { hash: string; result: string } | undefined;
		if (existing) {
			if (existing.hash !== hash)
				throw new Error("이 발송 요청은 다른 내용으로 이미 사용되었습니다.");
			return JSON.parse(existing.result) as SendResult;
		}
		const original = data.replyId ? await detailMessage(data.replyId) : null;
		if (original && original.accountId !== account.id)
			throw new Error("메일을 받은 계정으로 답장해 주세요.");
		if (data.forwardId) {
			const forwarded = await rawMessage(data.forwardId);
			for (const a of forwarded.parsed.attachments)
				attachments.push({
					filename: a.filename || "attachment",
					content: a.content,
				});
		}
		if (
			attachments.reduce((sum, a) => sum + a.content.length, 0) > MAX_SEND_BYTES
		)
			throw new Error("첨부파일 합계는 15MB 이하여야 합니다.");
		// Build/validate before recording intent; once delivery starts, never automatically retry.
		const messageId = `<${data.requestId}@orbit.local>`;
		const composer = new MailComposer({
			keepBcc: account.provider === "gmail",
			from: { name: account.name, address: account.email },
			to: data.to,
			cc: data.cc,
			bcc: data.bcc,
			subject: data.subject,
			text: data.text,
			attachments,
			messageId,
			inReplyTo: original?.messageId || undefined,
			references: original
				? [...original.references, original.messageId].filter(Boolean)
				: undefined,
		});
		const mime = composer.compile();
		mime.keepBcc = account.provider === "gmail";
		const raw = await mime.build();
		const previous = s.beginSend(data.requestId, account.id, hash);
		if (previous) return previous;
		let accepted = false;
		try {
			if (account.provider === "gmail") {
				await gmailRequest(account, "messages/send", {
					method: "POST",
					body: JSON.stringify({
						raw: raw.toString("base64url"),
						threadId: original?.threadId,
					}),
				});
				accepted = true;
			} else {
				const result = await smtpClient(account).sendMail({
					raw,
					envelope: {
						from: account.email,
						to: [...data.to, ...data.cc, ...data.bcc],
					},
				});
				accepted = result.accepted.length > 0;
				if (!accepted) throw new Error("발송이 수락되지 않았습니다.");
				const warning = result.rejected.length
					? "일부 받는 사람에게 발송하지 못했습니다. 보낸 메일과 수신 주소를 확인해 주세요."
					: undefined;
				// Record successful SMTP acceptance BEFORE the secondary sent-folder operation.
				s.finishSend(data.requestId, { status: "sent", warning });
				try {
					await usingImap(account, async (client) => {
						const sent = await findMailbox(client, "sent");
						const lock = await client.getMailboxLock(sent);
						try {
							const found = await client.search(
								{ header: { "Message-ID": messageId } },
								{ uid: true },
							);
							if (!found || !found.length)
								await client.append(sent, raw, ["\\Seen"]);
						} finally {
							lock.release();
						}
					});
				} catch {
					const r: SendResult = {
						status: "sent",
						warning:
							"메일은 발송됐지만 보낸 메일함에 사본을 저장하지 못했습니다. 다시 발송하지 마세요.",
					};
					s.finishSend(data.requestId, r);
					return r;
				}
				return { status: "sent", warning };
			}
			const result: SendResult = { status: "sent" };
			s.finishSend(data.requestId, result);
			return result;
		} catch {
			const result: SendResult = accepted
				? {
						status: "sent",
						warning: "메일은 발송됐습니다. 보낸 메일함을 확인해 주세요.",
					}
				: {
						status: "uncertain",
						warning:
							"발송 결과를 확인하지 못했습니다. 보낸 메일함을 확인해 주세요. 중복 발송을 막기 위해 자동 재시도하지 않습니다.",
					};
			s.finishSend(data.requestId, result);
			return result;
		}
	});
}
