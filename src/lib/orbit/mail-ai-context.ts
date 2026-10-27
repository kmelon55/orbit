import sanitizeHtml from "sanitize-html";
import type { MailDetail, MailMessage } from "../mail/types";
import type { AiSource } from "./ai-types";

// A shared body budget, rather than a per-message limit that grows with the thread.
export const MAIL_CONTEXT_CHAR_BUDGET = 60_000;

export function mailBodyText(body: MailDetail): string {
	return (
		body.text.trim() ||
		sanitizeHtml(
			body.html.replace(
				/<\/(?:p|div|tr|li|h[1-6]|blockquote)>|<br\s*\/?\s*>/gi,
				"\n",
			),
			{ allowedTags: [], allowedAttributes: {} },
		).trim()
	);
}

const normalized = (text: string) =>
	text
		.replace(/^\s*>+ ?/gm, "")
		.replace(/\s+/g, " ")
		.trim();

// Only remove quotes whose content is actually available in another loaded mail.
// Unknown quotes, inline replies and unique signatures must survive.
function removeRepeatedText(text: string, previous: string[]) {
	const known = previous.map(normalized);
	const isKnown = (value: string) => {
		const plain = normalized(value);
		return plain.length >= 20 && known.some((body) => body.includes(plain));
	};
	let result = text.replace(/(?:^[\t ]*>[^\n]*(?:\n|$))+/gm, (quote) =>
		isKnown(quote) ? "[앞선 메일의 반복 인용 생략]\n" : quote,
	);
	// Common unprefixed reply tails; retain the tail unless all of it is known.
	const reply = /^(?:On .+wrote:|.+님이 작성:|.+님이 쓴 글:)\s*$/gm;
	for (const match of result.matchAll(reply)) {
		if (isKnown(result.slice(match.index + match[0].length))) {
			result = `${result.slice(0, match.index).trimEnd()}\n[앞선 메일의 반복 인용 생략]`;
			break;
		}
	}
	const signature = result.match(/\n-- ?\n([\s\S]+)$/);
	if (signature && isKnown(signature[1]))
		result = `${result.slice(0, signature.index)}\n[반복 서명 생략]`;
	return result.trim();
}

// Extractive summaries use only original text, including the end of long mails.
// They need no extra model request and are explicitly marked as incomplete.
function excerpt(text: string, limit: number, question: string) {
	if (text.length <= limit) return text;
	if (limit < 80) return text.slice(0, limit);
	const terms = question
		.toLocaleLowerCase()
		.split(/\s+/)
		.filter((s) => s.length > 1);
	const pieces = text.match(/[^\n.!?。！？]+[.!?。！？]*(?:\n|$)?/g) || [text];
	const ranked = pieces.map((value, index) => ({
		value,
		index,
		score: terms.reduce(
			(n, term) => n + Number(value.toLocaleLowerCase().includes(term)),
			0,
		),
	}));
	const edge = Math.floor(limit / 4);
	const head = text.slice(0, edge);
	const tail = text.slice(-edge);
	let remaining = limit - head.length - tail.length - 10;
	const chosen = ranked
		.filter(({ value }) => !head.includes(value) && !tail.includes(value))
		.sort((a, b) => b.score - a.score || a.index - b.index)
		.filter(({ value }) => {
			if (value.length + 3 > remaining) return false;
			remaining -= value.length + 3;
			return true;
		})
		.sort((a, b) => a.index - b.index);
	return `${head}\n…\n${chosen.map(({ value }) => value.trim()).join("\n…\n")}\n…\n${tail}`.slice(
		0,
		limit,
	);
}

export function buildMailContext(
	entries: { message: MailMessage; body?: MailDetail }[],
	question: string,
) {
	const previous: string[] = [];
	const prepared = [...entries]
		.sort((a, b) => a.message.date - b.message.date)
		.map(({ message, body }) => {
			const original = body ? mailBodyText(body) : message.snippet;
			const text = body ? removeRepeatedText(original, previous) : original;
			if (body) previous.push(original);
			return { message, body, text: text || "(본문 없음)" };
		});
	const base = Math.min(
		1200,
		Math.floor(MAIL_CONTEXT_CHAR_BUDGET / Math.max(1, prepared.length * 2)),
	);
	const allowances = prepared.map(({ text }) => Math.min(text.length, base));
	let remaining =
		MAIL_CONTEXT_CHAR_BUDGET - allowances.reduce((a, b) => a + b, 0);
	// Preserve recent originals first while reserving space for every older mail.
	for (let i = prepared.length - 1; i >= 0; i--) {
		const extra = Math.min(remaining, prepared[i].text.length - allowances[i]);
		allowances[i] += extra;
		remaining -= extra;
	}
	let summarized = 0;
	let missing = 0;
	const sources = prepared.map(({ message, body, text }, i) => {
		const shortened = text.length > allowances[i];
		if (shortened) summarized++;
		if (!body) missing++;
		const status = !body
			? "본문을 불러오지 못해 미리보기만 제공됨"
			: shortened
				? "길이 제한으로 원문 일부를 골라 만든 발췌 요약. 생략된 내용이 있음"
				: "본문 전체 (이미 포함된 반복 인용·서명만 정리)";
		return {
			kind: "mail",
			id: message.id,
			index: 0,
			title: message.subject || "(제목 없음)",
			folder: message.folder,
			scope: body && !shortened ? "full" : "preview",
			excerpt: `보낸 사람: ${message.from.map((p) => `${p.name} <${p.address}>`).join(", ")}\n받는 사람: ${message.to.map((p) => p.address).join(", ")}\n참조: ${message.cc.map((p) => p.address).join(", ")}\n날짜: ${new Date(message.date).toISOString()}\n제공 범위: ${status}\n내용: ${excerpt(text, allowances[i], question)}\n첨부파일(내용은 제공되지 않음): ${body ? body.attachments.map((a) => a.name).join(", ") || "없음" : "확인하지 못함"}`,
		} satisfies AiSource & { excerpt: string };
	});
	return { sources, summarized, missing };
}
