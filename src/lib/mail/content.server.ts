import { randomBytes } from "node:crypto";
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
			"caption",
			"tfoot",
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
			table: [
				"width",
				"align",
				"border",
				"cellpadding",
				"cellspacing",
				"bgcolor",
				"role",
			],
			"*": ["style"],
			td: [
				"colspan",
				"rowspan",
				"width",
				"height",
				"align",
				"valign",
				"bgcolor",
			],
			th: ["colspan", "rowspan", "width", "align", "valign", "bgcolor"],
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
				"font-family": [/^[a-zA-Z0-9\s,'"-]+$/],
				"line-height": [/^\d{1,3}(?:\.\d+)?(?:px|em|%)?$/],
				"letter-spacing": [/^-?\d(?:\.\d+)?(?:px|em)$/],
				"font-style": [/^(normal|italic)$/],
				"text-decoration": [/^(none|underline|line-through)$/],
				"vertical-align": [/^(top|middle|bottom|baseline)$/],
				"border-collapse": [/^(collapse|separate)$/],
				"border-spacing": [/^\d{1,3}px$/],
				"table-layout": [/^(auto|fixed)$/],
				display: [
					/^(block|inline|inline-block|table|table-row|table-cell|none)$/,
				],
				...Object.fromEntries(
					[
						"width",
						"height",
						"min-width",
						"max-width",
						"min-height",
						"max-height",
					].map((key) => [key, [/^(auto|\d{1,4}(?:\.\d+)?(?:px|%|em|rem)?)$/]]),
				),
				...Object.fromEntries(
					[
						"padding",
						"padding-top",
						"padding-right",
						"padding-bottom",
						"padding-left",
						"margin",
						"margin-top",
						"margin-right",
						"margin-bottom",
						"margin-left",
					].map((key) => [
						key,
						[/^(?:(?:auto|0|\d{1,3}(?:\.\d+)?(?:px|%|em|rem))\s*){1,4}$/],
					]),
				),
				...Object.fromEntries(
					[
						"border",
						"border-top",
						"border-bottom",
						"border-left",
						"border-right",
					].map((key) => [
						key,
						[
							/^(0|none|\d{1,2}px (?:solid|dashed|dotted) (?:#[a-f0-9]{3,8}|[a-z]+))$/i,
						],
					]),
				),
				"border-radius": [/^\d{1,3}(px|%)$/],
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
	const nonce = randomBytes(18).toString("base64");
	// Only this nonce-bound sizing script runs. Sender scripts, events, forms and CSS URLs are stripped.
	const sizing = `const root=document.getElementById('orbit-mail-content');let previous=0;const report=()=>{const height=Math.ceil(root.getBoundingClientRect().height);if(height!==previous){previous=height;parent.postMessage({type:'orbit-mail-height',height},'*')}};new ResizeObserver(report).observe(root);addEventListener('load',report);report();`;
	return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: ${remoteImages ? "https:" : ""}; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>html,body{margin:0;padding:0;background:#fff;color:#202124;font:14px/1.65 system-ui,sans-serif;overflow-wrap:anywhere}#orbit-mail-content{padding:24px;display:flow-root;box-sizing:border-box}img{max-width:100%!important;height:auto;object-fit:contain}table{max-width:100%}td,th{overflow-wrap:anywhere}pre{white-space:pre-wrap}blockquote{margin-left:12px;padding-left:12px;border-left:2px solid #ddd}a{color:#2563eb}@media(max-width:480px){#orbit-mail-content{padding:16px}table{width:100%!important}td,th{max-width:100%}}</style></head><body><div id="orbit-mail-content">${safeMailHtml(html, remoteImages)}</div><script nonce="${nonce}">${sizing}</script></body></html>`;
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
		hasRemoteImages: Boolean(
			parsed.html &&
				/<img\b[^>]*\bsrc\s*=\s*["']?https:\/\//i.test(parsed.html),
		),
		replyTo: addresses(parsed.replyTo),
		messageId: parsed.messageId || "",
		references: [
			...new Set([
				...(typeof parsed.references === "string"
					? [parsed.references]
					: parsed.references || []),
				...(parsed.inReplyTo ? [parsed.inReplyTo] : []),
			]),
		],
		attachments: parsed.attachments.flatMap((a, i) =>
			a.contentDisposition === "inline" && a.contentId
				? []
				: [
						{
							id: String(i),
							name: a.filename || `첨부파일 ${i + 1}`,
							type: a.contentType,
							size: a.size,
						},
					],
		),
	};
}
