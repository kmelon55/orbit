import assert from "node:assert/strict";
import { test } from "node:test";
import type { MailDetail } from "../mail/types";
import { buildMailContext, MAIL_CONTEXT_CHAR_BUDGET } from "./mail-ai-context";

function entry(id: number, text: string) {
	const body: MailDetail = {
		id: `mail-${id}`,
		accountId: "account",
		remoteId: `${id}`,
		folder: "inbox",
		subject: "계약",
		from: [{ name: "Kim", address: "kim@example.com" }],
		to: [],
		cc: [],
		date: id,
		unread: true,
		snippet: "preview",
		hasAttachments: false,
		text,
		html: "",
		replyTo: [],
		messageId: `<${id}>`,
		references: [],
		attachments: [],
	};
	return { message: body, body };
}

test("thread context removes verified repeated quotes but keeps inline replies and unavailable originals", () => {
	const original =
		"첫 제안은 다음 주 금요일까지 계약서 검토를 완료하는 일정이에요.";
	const unknown = "이전에 전달받은 별도 견적은 부가세를 포함해 백만원이에요.";
	const result = buildMailContext(
		[
			entry(
				2,
				`확인했어요.\n> ${original}\n월요일로 변경해 주세요.\n> ${unknown}`,
			),
			entry(1, original),
		],
		"일정",
	);
	assert.deepEqual(
		result.sources.map((s) => s.id),
		["mail-1", "mail-2"],
	);
	assert.match(result.sources[0].excerpt, /금요일/);
	assert.doesNotMatch(result.sources[1].excerpt, /금요일/);
	assert.match(result.sources[1].excerpt, /월요일로 변경/);
	assert.match(result.sources[1].excerpt, /부가세를 포함해 백만원/);
	assert.equal(result.summarized, 0);
	assert.equal(result.missing, 0);
	const missing = buildMailContext(
		[{ message: entry(1, original).message }, entry(2, `답장\n> ${original}`)],
		"일정",
	);
	assert.match(missing.sources[1].excerpt, /금요일/);
	assert.equal(missing.missing, 1);
});

test("known reply tails and repeated signatures are compacted while unique signatures survive", () => {
	const signature = "Kim / Example Company / +82-10-1234-5678";
	const original = `다음 주 금요일 계약 검토를 부탁드려요.\n-- \n${signature}`;
	const result = buildMailContext(
		[
			entry(1, original),
			entry(2, `확인했어요.\nOn Tuesday Kim wrote:\n${original}`),
			entry(3, `감사해요.\n-- \n${signature}`),
			entry(4, "확인했어요.\n-- \nLee / Other Company / 다른 연락처"),
		],
		"요약",
	);
	assert.match(result.sources[1].excerpt, /확인했어요/);
	assert.doesNotMatch(result.sources[1].excerpt, /금요일/);
	assert.doesNotMatch(result.sources[2].excerpt, /1234-5678/);
	assert.match(result.sources[3].excerpt, /다른 연락처/);
});

test("long conversations retain recent originals and bounded excerpts from every older mail", () => {
	const entries = Array.from({ length: 8 }, (_, i) =>
		entry(
			i,
			`시작-${i}\n${"검토할 내용이에요.\n".repeat(1800)}\n마지막 합의-${i}`,
		),
	);
	const recent = entry(9, "최종 마감은 월요일이고 금액은 백만원이에요.");
	const result = buildMailContext([...entries, recent], "마지막 합의");
	assert.equal(result.sources.length, 9);
	assert.ok(result.summarized > 0);
	assert.equal(result.sources.at(-1)?.scope, "full");
	assert.match(result.sources.at(-1)?.excerpt || "", /최종 마감은 월요일/);
	let bodySize = 0;
	for (const [i, source] of result.sources.entries()) {
		const content = source.excerpt.split("\n내용: ")[1].split("\n첨부파일")[0];
		bodySize += content.length;
		if (i < 8) {
			assert.ok(content.includes(`시작-${i}`));
			assert.ok(content.includes(`마지막 합의-${i}`));
		}
	}
	assert.ok(bodySize <= MAIL_CONTEXT_CHAR_BUDGET);
	assert.match(result.sources[0].excerpt, /발췌 요약/);
});

test("ordinary mail beyond the old per-message cap stays complete; HTML-only mail excludes scripts", () => {
	const long = entry(1, `${"가".repeat(25_000)}전체 내용 끝`);
	const html = entry(2, "");
	html.body.html =
		"<style>SECRET_STYLE</style><p>HTML 답장</p><script>SECRET_SCRIPT</script>";
	const result = buildMailContext([long, html], "요약");
	assert.equal(result.summarized, 0);
	assert.match(result.sources[0].excerpt, /전체 내용 끝/);
	assert.match(result.sources[1].excerpt, /HTML 답장/);
	assert.doesNotMatch(result.sources[1].excerpt, /SECRET/);
});
