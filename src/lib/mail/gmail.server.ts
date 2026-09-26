import { OAuth2Client } from "google-auth-library";
import { simpleParser } from "mailparser";
import { mailConfig } from "./config.server";
import { addresses } from "./content.server";
import { mailStore, messageKey } from "./store.server";
import {
	MAX_RAW_BYTES,
	type MailAccount,
	type MailFolder,
	type MailMessage,
	PAGE_SIZE,
	type ProviderMailAction,
} from "./types";

export function gmailConfigured() {
	return Boolean(
		mailConfig().gmailClientId &&
			mailConfig().gmailClientSecret &&
			mailConfig().publicUrl,
	);
}
export function oauthClient() {
	if (!gmailConfigured())
		throw new Error("먼저 서버에 Gmail 연결 설정을 추가해 주세요.");
	return new OAuth2Client(
		mailConfig().gmailClientId,
		mailConfig().gmailClientSecret,
		`${mailConfig().publicUrl}/api/mail/oauth/callback`,
	);
}
const tokens = new Map<string, { token: string; expires: number }>();
export function clearGmailToken(id: string) {
	tokens.delete(id);
}
async function accessToken(account: MailAccount) {
	const cached = tokens.get(account.id);
	if (cached && cached.expires > Date.now() + 60_000) return cached.token;
	const client = oauthClient();
	client.setCredentials({
		refresh_token: mailStore().secret(account.id).refreshToken,
	});
	const r = await client.getAccessToken();
	if (!r.token) throw new Error("Gmail에 다시 연결해 주세요.");
	tokens.set(account.id, {
		token: r.token,
		expires: client.credentials.expiry_date || Date.now() + 300_000,
	});
	return r.token;
}
export async function gmailRequest<T>(
	account: MailAccount,
	path: string,
	init?: RequestInit,
): Promise<T> {
	const response = await fetch(
		`https://gmail.googleapis.com/gmail/v1/users/me/${path}`,
		{
			...init,
			headers: {
				Authorization: `Bearer ${await accessToken(account)}`,
				"Content-Type": "application/json",
				...init?.headers,
			},
			signal: AbortSignal.timeout(30_000),
		},
	);
	if (!response.ok) {
		if (response.status === 401) tokens.delete(account.id);
		throw new Error(
			response.status === 401 || response.status === 403
				? "Gmail 권한이 만료되었거나 부족합니다. 다시 연결해 주세요."
				: response.status === 429
					? "Gmail 요청이 많습니다. 잠시 후 다시 시도해 주세요."
					: `Gmail 요청에 실패했습니다 (${response.status}).`,
		);
	}
	if (response.status === 204) return undefined as T;
	return response.json() as Promise<T>;
}
type GmailMeta = {
	id: string;
	threadId: string;
	labelIds?: string[];
	snippet?: string;
	internalDate?: string;
	sizeEstimate?: number;
	payload?: {
		headers?: { name: string; value: string }[];
		parts?: { filename?: string }[];
	};
};
const queries: Record<MailFolder, string> = {
	inbox: "in:inbox",
	spam: "in:spam",
	sent: "in:sent",
	trash: "in:trash",
	archive: "-in:inbox -in:sent -in:drafts -in:trash -in:spam",
};
export async function listGmail(
	account: MailAccount,
	folder: MailFolder,
	cursor?: string,
	query?: string,
) {
	const params = new URLSearchParams({
		maxResults: String(PAGE_SIZE),
		q: `${queries[folder]} ${query || ""}`,
		includeSpamTrash:
			folder === "trash" || folder === "spam" ? "true" : "false",
	});
	if (cursor) params.set("pageToken", cursor);
	const list = await gmailRequest<{
		messages?: { id: string }[];
		nextPageToken?: string;
	}>(account, `messages?${params}`);
	const messages: MailMessage[] = [];
	// Bounded concurrency instead of a request burst for every message.
	const ids = list.messages || [];
	for (let i = 0; i < ids.length; i += 5) {
		const batch = await Promise.all(
			ids.slice(i, i + 5).map(async ({ id }) => {
				const m = await gmailRequest<GmailMeta>(
					account,
					`messages/${encodeURIComponent(id)}?format=metadata`,
				);
				return gmailSummary(account, folder, m);
			}),
		);
		messages.push(...batch);
	}
	return { messages, cursor: list.nextPageToken || null };
}
async function gmailSummary(
	account: MailAccount,
	folder: MailFolder,
	m: GmailMeta,
): Promise<MailMessage> {
	const headers = (m.payload?.headers || [])
		.map((h) => `${h.name}: ${h.value}`)
		.join("\r\n");
	const parsed = await simpleParser(`${headers}\r\n\r\n`, {
		skipTextToHtml: true,
	});
	return {
		id: messageKey(account.id, folder, m.id),
		accountId: account.id,
		folder,
		remoteId: m.id,
		threadId: m.threadId,
		messageId: parsed.messageId,
		references: [
			...(typeof parsed.references === "string"
				? [parsed.references]
				: parsed.references || []),
			...(parsed.inReplyTo ? [parsed.inReplyTo] : []),
		],
		subject: parsed.subject || "(제목 없음)",
		from: addresses(parsed.from),
		to: addresses(parsed.to),
		cc: addresses(parsed.cc),
		date: Number(m.internalDate) || Date.now(),
		unread: (m.labelIds || []).includes("UNREAD"),
		snippet: m.snippet || "",
		hasAttachments: false,
	} satisfies MailMessage;
}
export async function gmailConversation(
	account: MailAccount,
	threadId: string,
) {
	const thread = await gmailRequest<{ messages?: GmailMeta[] }>(
		account,
		`threads/${encodeURIComponent(threadId)}?format=metadata`,
	);
	return Promise.all(
		(thread.messages || [])
			.filter((m) => !m.labelIds?.includes("DRAFT"))
			.map((m) => {
				const labels = m.labelIds || [];
				const folder: MailFolder = labels.includes("TRASH")
					? "trash"
					: labels.includes("SPAM")
						? "spam"
						: labels.includes("INBOX")
							? "inbox"
							: labels.includes("SENT")
								? "sent"
								: "archive";
				return gmailSummary(account, folder, m);
			}),
	);
}
export async function gmailRaw(account: MailAccount, message: MailMessage) {
	const meta = await gmailRequest<GmailMeta>(
		account,
		`messages/${encodeURIComponent(message.remoteId)}?format=minimal`,
	);
	if ((meta.sizeEstimate || 0) > MAX_RAW_BYTES)
		throw new Error("35MB를 넘는 메일은 원본 메일 서비스에서 열어 주세요.");
	const r = await gmailRequest<{ raw: string }>(
		account,
		`messages/${encodeURIComponent(message.remoteId)}?format=raw`,
	);
	const raw = Buffer.from(r.raw, "base64url");
	if (raw.length > MAX_RAW_BYTES) throw new Error("메일이 너무 큽니다.");
	return raw;
}
export async function mutateGmail(
	account: MailAccount,
	m: MailMessage,
	action: ProviderMailAction,
) {
	if (action === "trash")
		return gmailRequest(account, `messages/${m.remoteId}/trash`, {
			method: "POST",
		});
	return gmailRequest(account, `messages/${m.remoteId}/modify`, {
		method: "POST",
		body: JSON.stringify({
			addLabelIds:
				action === "unread"
					? ["UNREAD"]
					: action === "spam"
						? ["SPAM"]
						: action === "inbox"
							? ["INBOX"]
							: [],
			removeLabelIds:
				action === "read"
					? ["UNREAD"]
					: action === "archive"
						? ["INBOX", "SPAM", "TRASH"]
						: action === "spam"
							? ["INBOX", "TRASH"]
							: action === "inbox"
								? ["SPAM", "TRASH"]
								: [],
		}),
	});
}
