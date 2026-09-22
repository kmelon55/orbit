import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import MailComposer from "nodemailer/lib/mail-composer";
import { z } from "zod";
import { parseMail, toDetail } from "./content.server";
import { relatedMessages } from "./conversations";
import {
	canPreview,
	type MailAccount,
	type MailDetail,
	type MailMessage,
	sendSchema,
} from "./types";

const accounts: MailAccount[] = [
	{
		id: "11111111-1111-4111-8111-111111111111",
		provider: "icloud",
		name: "김민아 · 개인",
		email: "mina.personal@example.com",
		notifications: false,
		createdAt: 0,
		lastSync: null,
		error: null,
	},
	{
		id: "22222222-2222-4222-8222-222222222222",
		provider: "icloud",
		name: "김민아 · 업무",
		email: "mina.studio@example.com",
		notifications: false,
		createdAt: 0,
		lastSync: null,
		error: null,
	},
];
type DemoMail = {
	message: MailMessage;
	parsed: Awaited<ReturnType<typeof parseMail>>;
};
type DemoState = {
	mails: Map<string, DemoMail>;
	drafts: Map<string, { revision: number; value: unknown }>;
	sends: Set<string>;
};
const globalDemo = globalThis as typeof globalThis & {
	orbitMailDemo?: Promise<DemoState>;
};
const imagePath = "mail-demo/forest.jpg";
const forest = () =>
	readFileSync(
		resolve(
			existsSync(`public/${imagePath}`) ? "public" : ".output/public",
			imagePath,
		),
	);
const textAttachment = {
	filename: "프로젝트-검토사항.txt",
	content: Buffer.from(
		"Orbit 프로젝트 검토사항\n\n1. 계정별 메일 구분\n2. HTML 뉴스레터와 이미지 표시\n3. 받은 메일과 보낸 답장을 연결한 대화 보기\n",
		"utf8",
	),
};
async function seed(): Promise<DemoState> {
	const now = Date.now();
	const photo = forest();
	const specs = [
		{
			id: "demo-newsletter",
			a: 0,
			from: "Sunday Letter <letter@example.com>",
			subject: "이번 주말에는, 잠시 숲으로",
			minutes: 4,
			html: `<table role="presentation" width="640" align="center" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;margin:0 auto;background-color:#faf9f5"><tr><td style="padding:28px 32px"><p style="font-size:12px;letter-spacing:2px;color:#697761">SUNDAY LETTER / VOL. 028</p><h1 style="font-family:Georgia,serif;font-size:32px;line-height:1.3;margin:14px 0;color:#203a2d">가끔은, 아무것도<br>하지 않는 주말.</h1><p style="color:#657268">바쁜 한 주를 지나온 당신에게 보내는 작은 쉼표.</p></td></tr><tr><td><img src="cid:forest" width="640" alt="초록빛 나무 사이로 햇살이 들어오는 숲" style="display:block;width:100%"></td></tr><tr><td style="padding:28px 32px"><h2 style="font-size:20px;margin:0 0 12px">천천히 걸어도 괜찮아요.</h2><p>알림을 잠깐 내려놓고 나무 사이를 걸어보세요. 어디에 도착하는지보다, 지금 어떤 풍경을 보고 있는지가 더 중요한 날도 있으니까요.</p><table role="presentation" width="100%" style="margin:24px 0;border-top:1px solid #dce1d7"><tr><td style="padding:16px 0"><b>이번 주의 작은 제안</b><br>산책 30분 · 따뜻한 차 한 잔 · 읽다 만 책 한 권</td></tr></table><a href="https://unsplash.com/s/photos/forest" style="display:inline-block;padding:12px 20px;background-color:#244735;color:#ffffff;text-decoration:none;border-radius:6px">숲의 사진 더 보기</a><p style="margin-top:32px;font-size:12px;color:#7b8278">Sunday Letter · 편안한 주말을 보낼 수 있기를.<br>사진: Unsplash · 데모 뉴스레터</p></td></tr></table>`,
			image: true,
		},
		{
			id: "demo-review-latest",
			a: 1,
			from: "서윤 <seoyun@example.com>",
			subject: "Re: Orbit 메일 화면, 최종 검토 부탁드려요",
			minutes: 17,
			root: "demo-review-root",
			text: "민아님, 보내주신 수정안 확인했어요.\n\n계정 주소가 바로 보여서 훨씬 좋네요. 뉴스레터 이미지와 첨부파일도 한 번 더 확인 부탁드려요.\n검토 사항을 파일로 첨부했습니다. 내일 오전에 이야기 나눠요!\n\n서윤 드림",
			attachment: true,
		},
		{
			id: "demo-receipt",
			a: 0,
			from: "모노 북스 <books@example.com>",
			subject: "주문하신 책이 오늘 출발했어요",
			minutes: 48,
			html: `<div style="max-width:600px;margin:0 auto;padding:24px"><p style="font-size:13px;letter-spacing:2px;color:#737373">MONO BOOKS</p><h1 style="font-size:28px;margin:24px 0">좋은 책이 가고 있어요.</h1><p>민아님, 주문해 주셔서 감사합니다.<br>책은 오늘 오후에 출발했습니다.</p><table width="100%" cellpadding="14" cellspacing="0" style="margin:28px 0;border-collapse:collapse"><tr style="background-color:#f4f4f1"><th align="left">주문 내역</th><th align="right">금액</th></tr><tr><td style="border-bottom:1px solid #e5e5e5">느리게 읽는 시간 · 1권</td><td align="right" style="border-bottom:1px solid #e5e5e5">18,000원</td></tr><tr><td>배송비</td><td align="right">무료</td></tr><tr><td><b>결제 금액</b></td><td align="right"><b>18,000원</b></td></tr></table><p style="font-size:12px;color:#777777">주문 번호 DEMO-20260922<br>실제 주문이 아닌 화면 확인용 메일입니다.</p></div>`,
		},
		{
			id: "demo-photo",
			a: 0,
			from: "지훈 <jihoon@example.com>",
			subject: "지난 주말 산책 사진 보내요 🌿",
			minutes: 85,
			text: "지난 주말에 찍은 사진이에요. 다음에는 같이 걸어요!",
			html: '<p>지난 주말에 찍은 사진이에요. 다음에는 같이 걸어요!</p><img src="cid:forest" width="760" alt="주말 산책길의 숲 사진"><p>지훈</p>',
			image: true,
		},
		{
			id: "demo-remote-image",
			a: 1,
			from: "Field Notes <notes@example.com>",
			subject: "Field Notes — 이번 달의 영감",
			minutes: 130,
			html: '<div style="max-width:640px;margin:0 auto"><p style="letter-spacing:2px;color:#566348">FIELD NOTES</p><h1 style="font-size:30px">화면 밖에서 찾은 영감</h1><p>이 사진은 HTTPS 외부 이미지입니다. 메일을 열면 자동으로 표시됩니다.</p><img src="https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=900&amp;q=75&amp;fit=crop" width="640" alt="나무와 햇살이 있는 숲"><p style="color:#6b7280">이미지 숨기기를 누르면 외부 이미지 표시를 끌 수 있어요.</p></div>',
		},
		{
			id: "demo-review-sent",
			a: 1,
			from: "김민아 <mina.studio@example.com>",
			subject: "Re: Orbit 메일 화면, 최종 검토 부탁드려요",
			minutes: 180,
			root: "demo-review-root",
			sent: true,
			text: "서윤님, 계정 구분과 대화 보기를 반영했습니다.\n\nHTML 메일도 실제 레이아웃으로 확인할 수 있게 정리할게요.\n감사합니다.\n\n민아",
		},
		{
			id: "demo-review-root",
			a: 1,
			from: "서윤 <seoyun@example.com>",
			subject: "Orbit 메일 화면, 최종 검토 부탁드려요",
			minutes: 240,
			text: "민아님 안녕하세요.\n\n메일 화면에서 개인·업무 계정을 한눈에 구분할 수 있으면 좋겠어요.\n주고받은 메일도 하나의 대화로 볼 수 있을까요?\n\n서윤 드림",
		},
		{
			id: "demo-meeting",
			a: 1,
			from: "도현 <dohyun@example.com>",
			subject: "목요일 디자인 리뷰 일정",
			minutes: 360,
			text: "이번 디자인 리뷰는 목요일 오후 2시입니다.\n\n• 메일 목록과 본문\n• 모바일 검색\n• 계정 전환과 답장\n\n위 세 가지 흐름을 함께 확인해요.",
		},
	];
	const mails = new Map<string, DemoMail>();
	for (const spec of specs) {
		const account = accounts[spec.a];
		const raw = await new MailComposer({
			from: spec.from,
			to: spec.sent ? "seoyun@example.com" : account.email,
			subject: spec.subject,
			text: spec.text,
			html: spec.html,
			messageId: `<${spec.id}@orbit.demo>`,
			references: spec.root ? [`<${spec.root}@orbit.demo>`] : undefined,
			attachments: [
				...(spec.image
					? [
							{
								filename: "숲의-산책.jpg",
								content: photo,
								cid: "forest",
								contentDisposition: "inline",
							},
						]
					: []),
				...(spec.attachment ? [textAttachment] : []),
				...(spec.id === "demo-photo"
					? [{ filename: "산책-원본.jpg", content: photo }]
					: []),
			],
		})
			.compile()
			.build();
		const parsed = await parseMail(raw);
		const summary: MailMessage = {
			id: spec.id,
			accountId: account.id,
			remoteId: spec.id,
			folder: spec.sent ? "sent" : "inbox",
			subject: spec.subject,
			from: [],
			to: [],
			cc: [],
			date: now - spec.minutes * 60_000,
			unread: !spec.sent && spec.minutes < 60,
			snippet: (parsed.text || "").replace(/\s+/g, " ").slice(0, 140),
			hasAttachments: Boolean(spec.id === "demo-photo" || spec.attachment),
		};
		const detail = toDetail(summary, parsed, true);
		mails.set(spec.id, {
			message: {
				...summary,
				from: detail.from,
				to: detail.to,
				messageId: detail.messageId,
				references: detail.references,
			},
			parsed,
		});
	}
	return { mails, drafts: new Map(), sends: new Set() };
}
const privateHeaders = {
	"Cache-Control": "no-store",
	"X-Content-Type-Options": "nosniff",
};
const json = (data: unknown, status = 200) =>
	Response.json(data, { status, headers: privateHeaders });
export async function demoMailRequest(
	request: Request,
	path: string,
	input?: unknown,
) {
	globalDemo.orbitMailDemo ??= seed();
	const state = await globalDemo.orbitMailDemo;
	const url = new URL(request.url);
	if (request.method === "GET") {
		if (path === "status")
			return json({
				accounts: accounts.map((a) => ({ ...a, lastSync: Date.now() })),
				gmailConfigured: false,
				pushConfigured: false,
				publicKey: null,
				notificationPreview: false,
			});
		if (path === "messages") {
			const q = (url.searchParams.get("q") || "").toLowerCase();
			const account = url.searchParams.get("account");
			const folder = url.searchParams.get("folder") || "inbox";
			if (url.searchParams.has("remote"))
				await new Promise((resolve) =>
					setTimeout(resolve, account === accounts[1].id ? 700 : 300),
				);
			return json({
				messages: [...state.mails.values()]
					.filter(
						({ message: m, parsed }) =>
							(!account || m.accountId === account) &&
							m.folder === folder &&
							[
								m.subject,
								parsed.text,
								...m.from.map((a) => a.name + a.address),
								...m.to.map((a) => a.address),
							]
								.join(" ")
								.toLowerCase()
								.includes(q),
					)
					.map((m) => m.message)
					.sort((a, b) => b.date - a.date),
				cursor: null,
			});
		}
		if (path === "draft")
			return json(state.drafts.get(url.searchParams.get("id") || "") || null);
		const mail = state.mails.get(
			url.searchParams.get(path === "attachment" ? "message" : "id") || "",
		);
		if (!mail) return json({ error: "데모 메일을 찾을 수 없습니다." }, 404);
		if (path === "message")
			return json(
				toDetail(
					mail.message,
					mail.parsed,
					url.searchParams.get("images") !== "0",
				),
			);
		if (path === "conversation")
			return json({
				messages: relatedMessages(
					mail.message,
					[...state.mails.values()].map((m) => m.message),
				).sort((a, b) => a.date - b.date),
				incomplete: false,
			});
		if (path === "attachment") {
			const a = mail.parsed.attachments[Number(url.searchParams.get("part"))];
			if (!a) return json({ error: "첨부파일을 찾을 수 없습니다." }, 404);
			return new Response(new Uint8Array(a.content), {
				headers: {
					...privateHeaders,
					"Content-Type": a.contentType,
					"Content-Disposition": `${url.searchParams.has("download") || !canPreview(a.contentType) ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(a.filename || "attachment")}`,
					"Content-Security-Policy": "sandbox; default-src 'none'",
				},
			});
		}
	}
	if (request.method === "POST") {
		if (path === "reset") {
			globalDemo.orbitMailDemo = seed();
			await globalDemo.orbitMailDemo;
			return json({ ok: true });
		}
		if (path === "action") {
			const v = z
				.object({
					id: z.string(),
					action: z.enum(["read", "unread", "archive", "trash"]),
				})
				.parse(input);
			const mail = state.mails.get(v.id);
			if (!mail) return json({ error: "데모 메일을 찾을 수 없습니다." }, 404);
			if (v.action === "read" || v.action === "unread")
				mail.message.unread = v.action === "unread";
			else mail.message.folder = v.action;
			return json({ ok: true });
		}
		if (path === "draft") {
			const v = z
				.object({
					id: z.string().uuid(),
					revision: z.number().int().min(0),
					value: z.unknown(),
				})
				.parse(input);
			if (v.value == null) state.drafts.delete(v.id);
			else {
				if (state.drafts.size >= 20 && !state.drafts.has(v.id))
					state.drafts.delete(state.drafts.keys().next().value as string);
				state.drafts.set(v.id, { revision: v.revision, value: v.value });
			}
			return json({ ok: true });
		}
		if (path === "send") {
			const v = sendSchema.parse(input);
			if (state.sends.has(v.requestId)) return json({ status: "sent" });
			const account = accounts.find((a) => a.id === v.accountId);
			if (!account) return json({ error: "데모 계정을 선택해 주세요." }, 400);
			const original = state.mails.get(v.replyId || v.forwardId || "");
			const raw = await new MailComposer({
				from: account.email,
				to: v.to,
				cc: v.cc,
				subject: v.subject,
				text: v.text,
				messageId: `<${randomUUID()}@orbit.demo>`,
				references: original
					? [
							...(original.message.references || []),
							original.message.messageId || "",
						].filter(Boolean)
					: undefined,
				attachments: v.attachments.map((a) => ({
					filename: a.name,
					content: Buffer.from(a.content, "base64"),
				})),
			})
				.compile()
				.build();
			const parsed = await parseMail(raw);
			const summary: MailMessage = {
				id: `demo-sent-${v.requestId}`,
				remoteId: v.requestId,
				accountId: account.id,
				folder: "sent",
				subject: v.subject,
				from: [],
				to: [],
				cc: [],
				date: Date.now(),
				unread: false,
				snippet: v.text.slice(0, 140),
				hasAttachments: v.attachments.length > 0,
			};
			const detail: MailDetail = toDetail(summary, parsed, true);
			if (state.mails.size >= 30)
				return json({ error: "데모를 초기화한 뒤 다시 사용해 주세요." }, 400);
			state.mails.set(summary.id, {
				message: {
					...summary,
					from: detail.from,
					to: detail.to,
					cc: detail.cc,
					messageId: detail.messageId,
					references: detail.references,
				},
				parsed,
			});
			state.sends.add(v.requestId);
			return json({
				status: "sent",
				warning: "데모 보낸 메일함에 저장했습니다. 실제로 발송하지 않았습니다.",
			});
		}
	}
	return json({ error: "데모에서는 지원하지 않는 기능입니다." }, 400);
}
