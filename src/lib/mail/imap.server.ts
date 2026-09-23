import { createHash } from "node:crypto";
import {
	type FetchMessageObject,
	ImapFlow,
	type MessageAddressObject,
	type SearchObject,
} from "imapflow";
import nodemailer from "nodemailer";
import { deliveryAddresses, matchesAddress } from "./identities";
import { mailDirectory, mailStore, messageKey } from "./store.server";
import {
	MAX_RAW_BYTES,
	type MailAccount,
	type MailAddress,
	type MailFolder,
	type MailMessage,
	type MailSecret,
	PAGE_SIZE,
} from "./types";

export function imapAddressSearch(
	addresses: string[],
	folder: MailFolder,
): SearchObject {
	const terms: SearchObject[] = [];
	for (const address of addresses) {
		if (folder !== "sent")
			terms.push(
				{ to: address },
				{ cc: address },
				{ header: { "Delivered-To": address } },
				{ header: { "X-Original-To": address } },
			);
		if (folder !== "inbox") terms.push({ from: address });
	}
	return terms.length === 1 ? terms[0] : { or: terms };
}
const hosts = {
	icloud: { imap: "imap.mail.me.com", smtp: "smtp.mail.me.com" },
	naver: { imap: "imap.naver.com", smtp: "smtp.naver.com" },
};
export function imapClient(
	account: MailAccount,
	secret = mailStore().secret(account.id),
) {
	if (account.provider === "gmail")
		throw new Error("Gmail 계정은 API를 사용합니다.");
	const client = new ImapFlow({
		host: hosts[account.provider].imap,
		port: 993,
		secure: true,
		auth: { user: account.email, pass: secret.password || "" },
		logger: false,
		connectionTimeout: 15_000,
		greetingTimeout: 15_000,
		socketTimeout: 90_000,
		maxIdleTime: 60_000,
		disableAutoIdle: false,
	});
	client.on("error", () => {});
	return client;
}
export function smtpClient(
	account: MailAccount,
	secret: MailSecret = mailStore().secret(account.id),
) {
	if (account.provider === "gmail")
		throw new Error("Gmail 계정은 API를 사용합니다.");
	return nodemailer.createTransport({
		host: hosts[account.provider].smtp,
		port: 587,
		secure: false,
		requireTLS: true,
		auth: { user: account.email, pass: secret.password || "" },
		connectionTimeout: 15_000,
		greetingTimeout: 15_000,
		socketTimeout: 30_000,
		disableFileAccess: true,
		disableUrlAccess: true,
	});
}
type Connection = {
	client: ImapFlow;
	tail: Promise<unknown>;
	timer?: ReturnType<typeof setTimeout>;
};
const connections = new Map<string, Connection>();
export async function usingImap<T>(
	account: MailAccount,
	fn: (client: ImapFlow) => Promise<T>,
	lane = "list",
) {
	const secret = mailStore().secret(account.id);
	const key = `${mailDirectory()}:${account.id}:${lane}:${createHash("sha256")
		.update(secret.password || "")
		.digest("hex")}`;
	let entry = connections.get(key);
	if (!entry) {
		entry = { client: imapClient(account, secret), tail: Promise.resolve() };
		connections.set(key, entry);
	}
	if (entry.timer) clearTimeout(entry.timer);
	const connection = entry;
	const next = connection.tail
		.catch(() => {})
		.then(async () => {
			if (!connection.client.usable) {
				connection.client.close();
				connection.client = imapClient(account, secret);
				await connection.client.connect();
			}
			return fn(connection.client);
		});
	connection.tail = next;
	try {
		return await next;
	} finally {
		if (connection.tail === next) {
			connection.timer = setTimeout(() => {
				connection.client.close();
				connections.delete(key);
			}, 60_000);
			connection.timer.unref();
		}
	}
}
export function closeImapConnections(accountId?: string) {
	for (const [key, entry] of connections) {
		if (accountId && !key.includes(`:${accountId}:`)) continue;
		if (entry.timer) clearTimeout(entry.timer);
		entry.client.close();
		connections.delete(key);
	}
}
export async function findMailbox(client: ImapFlow, folder: MailFolder) {
	if (folder === "inbox") return "INBOX";
	const special = { sent: "\\Sent", trash: "\\Trash", archive: "\\Archive" }[
		folder
	];
	const boxes = await client.list();
	let box = boxes.find((b) => b.specialUse === special);
	if (!box) {
		const patterns = {
			sent: /^(sent( messages| mail)?|보낸메일함|보낸 메일함)$/i,
			trash: /^(trash|deleted( messages| items)?|휴지통)$/i,
			archive: /^(archive|archives|보관함)$/i,
		};
		box = boxes.find((b) => patterns[folder].test(b.name));
	}
	if (!box)
		throw new Error(
			`${folder === "sent" ? "보낸 메일함" : folder === "trash" ? "휴지통" : "보관함"}을 제공자에서 찾을 수 없습니다.`,
		);
	return box.path;
}
function envelopeAddresses(
	value: MessageAddressObject[] | undefined,
): MailAddress[] {
	return (value || []).flatMap((a) =>
		a.address ? [{ name: a.name || "", address: a.address }] : [],
	);
}
function summary(
	account: MailAccount,
	folder: MailFolder,
	mailbox: string,
	validity: string,
	m: FetchMessageObject,
): MailMessage {
	const remoteId = `${validity}:${m.uid}`;
	return {
		id: messageKey(account.id, `${folder}:${mailbox}`, remoteId),
		accountId: account.id,
		folder,
		remoteId,
		mailbox,
		uidValidity: validity,
		messageId: m.envelope?.messageId,
		references: [
			...new Set(
				[
					...(m.headers
						?.toString()
						.replace(/\r?\n[ \t]+/g, " ")
						.split(/\r?\n/)
						.filter((line) => /^references:/i.test(line))
						.join(" ")
						.match(/<[^<>]+>/g) || []),
					m.envelope?.inReplyTo || "",
				].filter(Boolean),
			),
		],
		subject: m.envelope?.subject || "(제목 없음)",
		from: envelopeAddresses(m.envelope?.from),
		to: envelopeAddresses(m.envelope?.to),
		cc: envelopeAddresses(m.envelope?.cc),
		deliveredTo: deliveryAddresses(m.headers?.toString() || ""),
		date:
			m.internalDate instanceof Date ? m.internalDate.getTime() : Date.now(),
		unread: !m.flags?.has("\\Seen"),
		snippet: "",
		hasAttachments: JSON.stringify(m.bodyStructure || {}).includes(
			'"attachment"',
		),
	};
}
export async function listImap(
	account: MailAccount,
	folder: MailFolder,
	cursor?: string,
	query?: string,
	addresses: string[] = [],
) {
	return usingImap(account, async (client) => {
		const mailbox = await findMailbox(client, folder);
		const lock = await client.getMailboxLock(mailbox);
		try {
			if (!client.mailbox) throw new Error("메일함을 열지 못했습니다.");
			const validity = String(client.mailbox.uidValidity);
			const [cursorValidity, cursorUid] = cursor?.split(":") || [];
			if (cursor && cursorValidity !== validity)
				throw new Error("메일함이 변경되었습니다. 목록을 새로고침해 주세요.");
			const bound = cursor ? Number(cursorUid) : Infinity;
			if (cursor && (!Number.isSafeInteger(bound) || bound <= 0))
				throw new Error("페이지 정보가 올바르지 않습니다.");
			const fields = {
				uid: true,
				envelope: true,
				flags: true,
				internalDate: true,
				bodyStructure: true,
				headers: ["References", "Delivered-To", "X-Original-To"],
			};
			let fetched: FetchMessageObject[];
			let hasMore = false;
			if (!query && !cursor && !addresses.length) {
				// The initial window needs only the last 50 sequence numbers, not every UID.
				const count = client.mailbox.exists;
				fetched = count
					? await client.fetchAll(
							`${Math.max(1, count - PAGE_SIZE + 1)}:${count}`,
							fields,
						)
					: [];
				hasMore = count > PAGE_SIZE;
			} else {
				const criteria = query
					? {
							or: [
								{ subject: query },
								{ from: query },
								{ to: query },
								{ cc: query },
								{ body: query },
							],
						}
					: { all: true };
				const ids =
					bound <= 1
						? []
						: await client.search(
								{
									...criteria,
									// NOT NOT groups a second OR clause as an AND with the text search.
									...(addresses.length
										? {
												not: {
													not: {
														...imapAddressSearch(addresses, folder),
													},
												},
											}
										: {}),
									...(cursor ? { uid: `1:${bound - 1}` } : {}),
								},
								{ uid: true },
							);
				const remaining = (ids || [])
					.filter((id) => id < bound)
					.sort((a, b) => b - a);
				const page = remaining.slice(0, PAGE_SIZE);
				fetched = page.length
					? await client.fetchAll(page, fields, { uid: true })
					: [];
				hasMore = remaining.length > PAGE_SIZE;
			}
			return {
				uidValidity: validity,
				messages: fetched
					.map((m) => summary(account, folder, mailbox, validity, m))
					.filter(
						(m) =>
							!addresses.length ||
							addresses.some((address) => matchesAddress(m, address, folder)),
					)
					.sort((a, b) => b.date - a.date),
				cursor:
					hasMore && fetched.length
						? `${validity}:${Math.min(...fetched.map((m) => m.uid))}`
						: null,
			};
		} finally {
			lock.release();
		}
	});
}
async function lockMessage(client: ImapFlow, m: MailMessage) {
	if (!m.mailbox || !m.uidValidity) throw new Error("메일 위치가 없습니다.");
	const lock = await client.getMailboxLock(m.mailbox);
	if (!client.mailbox || String(client.mailbox.uidValidity) !== m.uidValidity) {
		lock.release();
		throw new Error("메일함이 변경되었습니다. 목록을 다시 불러와 주세요.");
	}
	return lock;
}
export async function imapRaw(account: MailAccount, m: MailMessage) {
	return usingImap(
		account,
		async (client) => {
			const lock = await lockMessage(client, m);
			try {
				const uid = m.remoteId.split(":")[1];
				const meta = await client.fetchOne(uid, { size: true }, { uid: true });
				if (!meta) throw new Error("원본 메일이 이동되거나 삭제되었습니다.");
				if ((meta.size || 0) > MAX_RAW_BYTES)
					throw new Error(
						"35MB를 넘는 메일은 원본 메일 서비스에서 열어 주세요.",
					);
				const download = await client.download(uid, undefined, {
					uid: true,
					maxBytes: MAX_RAW_BYTES + 1,
				});
				const chunks: Buffer[] = [];
				let size = 0;
				for await (const chunk of download.content) {
					const b = Buffer.from(chunk);
					size += b.length;
					if (size > MAX_RAW_BYTES) {
						download.content.destroy();
						throw new Error("메일이 너무 큽니다.");
					}
					chunks.push(b);
				}
				return Buffer.concat(chunks);
			} finally {
				lock.release();
			}
		},
		"body",
	);
}
export async function mutateImap(
	account: MailAccount,
	m: MailMessage,
	action: "read" | "unread" | "trash" | "archive",
) {
	return usingImap(account, async (client) => {
		const destination =
			action === "trash" || action === "archive"
				? await findMailbox(client, action)
				: null;
		const lock = await lockMessage(client, m);
		try {
			const uid = m.remoteId.split(":")[1];
			const ok = destination
				? await client.messageMove(uid, destination, { uid: true })
				: action === "read"
					? await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true })
					: await client.messageFlagsRemove(uid, ["\\Seen"], { uid: true });
			if (!ok) throw new Error("메일 변경이 완료되지 않았습니다.");
		} finally {
			lock.release();
		}
	});
}
