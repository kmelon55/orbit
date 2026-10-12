import { z } from "zod";
import { mailScopes } from "./identities";
import { type MailAccount, sendSchema } from "./types";

export const draftValueSchema = sendSchema.omit({ requestId: true }).extend({
	to: z.array(z.string().max(500)).max(50),
	cc: z.array(z.string().max(500)).max(50),
	bcc: z.array(z.string().max(500)).max(50),
});
export const draftWriteSchema = z.object({
	id: z.string().uuid(),
	revision: z.number().int().min(0),
	baseRevision: z.number().int().min(0).optional(),
	value: draftValueSchema.nullable(),
});
export type DraftValue = z.infer<typeof draftValueSchema>;
export type MailDraft = {
	id: string;
	revision: number;
	updatedAt: number;
	value: DraftValue;
};
export type DraftSummary = Omit<MailDraft, "value"> & {
	accountId: string;
	from?: string;
	to: string[];
	cc: string[];
	bcc: string[];
	subject: string;
	snippet: string;
	attachmentCount: number;
	replyId?: string;
	forwardId?: string;
};
export function hasDraftContent(value: DraftValue) {
	return Boolean(
		value.to.some((v) => v.trim()) ||
			value.cc.some((v) => v.trim()) ||
			value.bcc.some((v) => v.trim()) ||
			value.subject.trim() ||
			value.text.trim() ||
			value.attachments.length,
	);
}
export function summarizeDraft(draft: MailDraft): DraftSummary {
	const { value, ...metadata } = draft;
	return {
		...metadata,
		accountId: value.accountId,
		from: value.from,
		to: value.to,
		cc: value.cc,
		bcc: value.bcc,
		subject: value.subject,
		snippet: value.text.replace(/\s+/g, " ").trim().slice(0, 240),
		attachmentCount: value.attachments.length,
		replyId: value.replyId,
		forwardId: value.forwardId,
	};
}
export function filterDrafts(
	drafts: DraftSummary[],
	accounts: MailAccount[],
	selected: string[] | null,
	query = "",
) {
	const scopes = mailScopes(accounts, selected);
	const q = query.trim().toLowerCase();
	return drafts.filter((draft) => {
		const scope = scopes.find((a) => a.id === draft.accountId);
		return (
			scope &&
			(!scope.addresses.length ||
				scope.addresses.includes((draft.from || scope.email).toLowerCase())) &&
			[
				draft.subject,
				draft.snippet,
				draft.from,
				...draft.to,
				...draft.cc,
				...draft.bcc,
			]
				.join(" ")
				.toLowerCase()
				.includes(q)
		);
	});
}
