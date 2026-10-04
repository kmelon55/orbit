import { randomUUID } from "node:crypto";
import type { ParsedMail } from "mailparser";
import { parseMail } from "./content.server";
import { MAX_RAW_BYTES, type MailAttachment } from "./types";

export type BodyPart = {
	id: string;
	type: string;
	charset?: string;
	filename?: string;
	disposition?: string;
	contentId?: string;
	size: number;
	children?: BodyPart[];
};
export type MailBody = { parsed: ParsedMail; attachments: MailAttachment[] };

// Retain the MIME tree (including alternative/related containers), but omit file bytes.
export async function readBody(
	headers: string,
	root: BodyPart,
	load: (part: BodyPart) => Promise<Buffer>,
): Promise<MailBody> {
	const attachments: MailAttachment[] = [];
	let bytes = 0;
	async function render(part: BodyPart): Promise<string | null> {
		if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(part.type))
			throw new Error("메일 형식이 올바르지 않습니다.");
		const bodyText = /^(text\/plain|text\/html)$/i.test(part.type);
		const inline = part.type.startsWith("image/") && Boolean(part.contentId);
		if (
			part.disposition === "attachment" ||
			part.filename ||
			(!bodyText && !part.children && !inline)
		) {
			if (!inline || part.disposition === "attachment") {
				attachments.push({
					id: part.id,
					name: part.filename || "첨부파일",
					type: part.type,
					size: part.size,
				});
				return null;
			}
		}
		if (part.children) {
			const boundary = `orbit-${randomUUID()}`;
			const children: string[] = [];
			for (const child of part.children) {
				const rendered = await render(child);
				if (rendered !== null) children.push(rendered);
			}
			return `Content-Type: ${part.type}; boundary="${boundary}"\r\n\r\n${children.map((child) => `--${boundary}\r\n${child}\r\n`).join("")}--${boundary}--\r\n`;
		}
		if (part.size > MAX_RAW_BYTES - bytes)
			throw new Error("메일 본문이 너무 큽니다.");
		const content = await load(part);
		bytes += content.length;
		if (bytes > MAX_RAW_BYTES) throw new Error("메일 본문이 너무 큽니다.");
		const charset = part.charset?.replace(/["\r\n]/g, "") || "utf-8";
		const cid = part.contentId?.replace(/[<>\r\n]/g, "");
		return `Content-Type: ${part.type}${bodyText ? `; charset="${charset}"` : ""}\r\nContent-Transfer-Encoding: base64\r\n${cid ? `Content-ID: <${cid}>\r\nContent-Disposition: inline\r\n` : ""}\r\n${content.toString("base64")}`;
	}
	const mime = await render(root);
	const cleanHeaders = headers
		.replace(
			/^Content-(?:Type|Transfer-Encoding|Disposition):[^\r\n]*(?:\r?\n[ \t][^\r\n]*)*\r?\n/gim,
			"",
		)
		.trimEnd();
	return {
		parsed: await parseMail(
			Buffer.from(
				`${cleanHeaders ? `${cleanHeaders}\r\n` : ""}${mime || "Content-Type: text/plain; charset=utf-8\r\n\r\n"}`,
			),
		),
		attachments,
	};
}
