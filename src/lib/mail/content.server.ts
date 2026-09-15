import { type AddressObject, type ParsedMail, simpleParser } from "mailparser";
import sanitizeHtml from "sanitize-html";
import type { MailAddress, MailDetail, MailMessage } from "./types";

export function addresses(
	value: AddressObject | AddressObject[] | undefined,
): MailAddress[] {
	return (Array.isArray(value) ? value : value ? [value] : []).flatMap((v) =>
		v.value.flatMap((a) =>
			a.address ? [{ name: a.name || "", address: a.address }] : [],
		),
	);
}
export function safeMailHtml(html: string, remoteImages = false) {
	return sanitizeHtml(html, {
		allowedTags: [
			"p",
			"div",
			"span",
			"br",
			"hr",
			"b",
			"strong",
			"i",
			"em",
			"u",
			"s",
			"blockquote",
			"pre",
			"code",
			"a",
			"img",
			"table",
			"thead",
			"tbody",
			"tr",
			"td",
			"th",
			"ul",
			"ol",
			"li",
			"h1",
			"h2",
			"h3",
			"h4",
			"h5",
			"h6",
		],
		allowedAttributes: {
			a: ["href", "target", "rel"],
			img: ["src", "alt", "width", "height"],
			"*": ["style"],
			td: ["colspan", "rowspan"],
			th: ["colspan", "rowspan"],
		},
		allowedSchemes: ["https", "http", "mailto"],
		allowedSchemesByTag: { img: remoteImages ? ["https", "data"] : ["data"] },
		allowProtocolRelative: false,
		allowedStyles: {
			"*": {
				color: [/^(#[a-f0-9]{3,8}|[a-z]+|rgba?\([\d\s,.%]+\))$/i],
				"background-color": [/^(#[a-f0-9]{3,8}|[a-z]+|rgba?\([\d\s,.%]+\))$/i],
				"text-align": [/^(left|right|center|justify)$/],
				"font-weight": [/^(bold|normal|[1-9]00)$/],
				"font-size": [/^\d{1,2}(px|pt)$/],
				"white-space": [/^(pre-wrap|normal)$/],
			},
		},
		transformTags: {
			a: (_tag, attrs) => ({
				tagName: "a",
				attribs: { ...attrs, target: "_blank", rel: "noopener noreferrer" },
			}),
		},
		exclusiveFilter: (frame) =>
			frame.tag === "img" &&
			(!frame.attribs.src ||
				(frame.attribs.src.startsWith("data:") &&
					!/^data:image\/(png|jpeg|gif|webp|avif);base64,/i.test(
						frame.attribs.src,
					))),
	});
}
export function mailDocument(html: string, remoteImages = false) {
	return `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: ${remoteImages ? "https:" : ""}; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>body{margin:16px;font:14px/1.65 system-ui,sans-serif;color:#202124;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap}blockquote{margin-left:12px;padding-left:12px;border-left:2px solid #ddd}a{color:#2563eb}</style></head><body>${safeMailHtml(html, remoteImages)}</body></html>`;
}
export async function parseMail(raw: Buffer) {
	return simpleParser(raw, {
		keepCidLinks: false,
		maxHtmlLengthToParse: 2_000_000,
		skipTextLinks: true,
	});
}
export function toDetail(
	message: MailMessage,
	parsed: ParsedMail,
	remoteImages = false,
): MailDetail {
	return {
		...message,
		subject: parsed.subject || message.subject,
		from: addresses(parsed.from),
		to: addresses(parsed.to),
		cc: addresses(parsed.cc),
		text: parsed.text || "",
		html: parsed.html ? mailDocument(parsed.html, remoteImages) : "",
		replyTo: addresses(parsed.replyTo),
		messageId: parsed.messageId || "",
		references:
			typeof parsed.references === "string"
				? [parsed.references]
				: parsed.references || [],
		attachments: parsed.attachments.map((a, i) => ({
			id: String(i),
			name: a.filename || `첨부파일 ${i + 1}`,
			type: a.contentType,
			size: a.size,
		})),
	};
}
