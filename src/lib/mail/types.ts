import { z } from "zod";

export const providerSchema = z.enum(["gmail", "icloud", "naver"]);
export type MailProvider = z.infer<typeof providerSchema>;
export const folderSchema = z.enum(["inbox", "sent", "trash", "archive"]);
export type MailFolder = z.infer<typeof folderSchema>;
export const folderLabels: Record<MailFolder, string> = {
	inbox: "받은 메일",
	sent: "보낸 메일",
	trash: "휴지통",
	archive: "보관함",
};
export type MailAddress = { name: string; address: string };
export type MailAccount = {
	id: string;
	provider: MailProvider;
	email: string;
	aliases?: string[];
	defaultFrom?: string;
	name: string;
	notifications: boolean;
	createdAt: number;
	lastSync: number | null;
	error: string | null;
	watchExpires?: number;
	mode?: "push" | "idle" | "poll";
};
export type MailSecret = { password?: string; refreshToken?: string };
export type MailMessage = {
	id: string;
	accountId: string;
	folder: MailFolder;
	remoteId: string;
	mailbox?: string;
	uidValidity?: string;
	threadId?: string;
	messageId?: string;
	references?: string[];
	subject: string;
	from: MailAddress[];
	to: MailAddress[];
	cc: MailAddress[];
	deliveredTo?: string[];
	date: number;
	unread: boolean;
	snippet: string;
	hasAttachments: boolean;
};
export type MailAttachment = {
	id: string;
	name: string;
	type: string;
	size: number;
};
export type MailDetail = MailMessage & {
	text: string;
	html: string;
	hasRemoteImages?: boolean;
	replyTo: MailAddress[];
	messageId: string;
	references: string[];
	attachments: MailAttachment[];
};
export type MailStatus = {
	accounts: MailAccount[];
	gmailConfigured: boolean;
	pushConfigured: boolean;
	publicKey: string | null;
	notificationPreview: boolean;
};
const header = z
	.string()
	.trim()
	.max(500)
	.refine((v) => !/[\r\n]/.test(v), "줄바꿈을 포함할 수 없습니다.");
export const connectSchema = z.object({
	provider: z.enum(["icloud", "naver"]),
	email: z.email().max(254),
	name: header.default(""),
	password: z.string().min(1).max(256),
});
export const sendSchema = z.object({
	accountId: z.string().uuid(),
	from: z.email().max(254).optional(),
	requestId: z.string().uuid(),
	to: z.array(z.email()).min(1).max(50),
	cc: z.array(z.email()).max(50).default([]),
	bcc: z.array(z.email()).max(50).default([]),
	subject: header,
	text: z.string().max(200_000),
	replyId: z.string().optional(),
	forwardId: z.string().optional(),
	attachments: z
		.array(
			z.object({ name: header.min(1), content: z.string().max(20_000_000) }),
		)
		.max(15)
		.default([]),
});
export type SendMail = z.infer<typeof sendSchema>;
export type SendResult = { status: "sent" | "uncertain"; warning?: string };
export const MAX_RAW_BYTES = 35 * 1024 * 1024;
export const MAX_SEND_BYTES = 15 * 1024 * 1024;
export const PAGE_SIZE = 50;

export function replyRecipients(
	detail: MailDetail,
	email: string,
	all: boolean,
	aliases: string[] = [],
) {
	const primary = detail.replyTo.length ? detail.replyTo : detail.from;
	const seen = new Set(
		[email, ...aliases].map((address) => address.toLowerCase()),
	);
	const unique = (addresses: MailAddress[]) =>
		addresses.filter((a) => {
			const key = a.address.toLowerCase();
			if (!key || seen.has(key)) return false;
			seen.add(key);
			return true;
		});
	const to = unique(primary);
	if (!to.length) to.push(...unique(detail.to));
	const cc = all ? unique([...detail.to, ...detail.cc]) : [];
	return { to: to.map((a) => a.address), cc: cc.map((a) => a.address) };
}
export function canPreview(type: string) {
	return /^(image\/(png|jpeg|gif|webp|avif)|application\/pdf|text\/plain|audio\/(mpeg|mp4|ogg|wav)|video\/(mp4|webm))$/.test(
		type,
	);
}
