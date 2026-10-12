import { z } from "zod";
import {
	AssistantError,
	assistantContext,
	dayInZone,
} from "./assistant.server";
import { contextInputSchema, daySchema } from "./assistant-schema";
import type { OrbitItem } from "./schema";
import { getOrbitItem, listOrbitItems } from "./store";

export function itemSummary(item: OrbitItem) {
	return {
		id: item.id,
		title: item.title,
		type: item.type,
		space: item.space,
		folder: item.folder,
		status: item.status,
		due: item.due,
		start: item.start,
		end: item.end,
		updated: item.updated,
	};
}
export const assistantSearchSchema = z
	.object({
		query: z.string().trim().max(200).default(""),
		type: z.enum(["note", "task", "event", "link"]).optional(),
		folder: z.string().min(1).max(500).optional(),
		status: z.enum(["incomplete", "done"]).optional(),
		from: daySchema.optional(),
		to: daySchema.optional(),
		timezone: contextInputSchema.shape.timezone,
		includeArchived: z.boolean().default(false),
		offset: z.number().int().min(0).max(10000).default(0),
		limit: z.number().int().min(1).max(100).default(20),
	})
	.strict()
	.refine((v) => !v.from || !v.to || v.from <= v.to, "Invalid date range");
export async function searchAssistantItems(
	input: z.input<typeof assistantSearchSchema>,
) {
	const p = assistantSearchSchema.parse(input);
	const terms = p.query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
	const day = (value: string | undefined) =>
		!value
			? undefined
			: /(?:Z|[+-]\d{2}:\d{2})$/.test(value)
				? dayInZone(new Date(value), p.timezone)
				: value.slice(0, 10);
	const matches = (await listOrbitItems()).filter((item) => {
		if (!p.includeArchived && item.space === "archive") return false;
		if (p.type && item.type !== p.type) return false;
		if (p.folder && item.folder !== p.folder && item.project !== p.folder)
			return false;
		if (
			p.status &&
			(item.type !== "task" ||
				(p.status === "done"
					? item.status !== "done"
					: ["done", "cancelled"].includes(item.status ?? "")))
		)
			return false;
		const start = day(item.start ?? item.due),
			end = day(item.end) ?? start;
		if (
			(p.from || p.to) &&
			(!start || !end || (p.from && end < p.from) || (p.to && start > p.to))
		)
			return false;
		const haystack =
			`${item.title}\n${item.body}\n${item.tags.join(" ")}`.toLocaleLowerCase();
		return terms.every((term) => haystack.includes(term));
	});
	return {
		items: matches.slice(p.offset, p.offset + p.limit).map((item) => {
			const text = item.body.replace(/\s+/g, " ");
			const hit = terms.length ? text.toLocaleLowerCase().indexOf(terms[0]) : 0;
			return {
				...itemSummary(item),
				excerpt: text.slice(Math.max(0, hit - 60), Math.max(0, hit - 60) + 600),
			};
		}),
		total: matches.length,
		nextOffset: p.offset + p.limit < matches.length ? p.offset + p.limit : null,
	};
}
export const assistantFetchSchema = z
	.object({
		id: z.string().min(1).max(200),
		offset: z.number().int().min(0).max(10_000_000).default(0),
		length: z.number().int().min(1).optional(),
	})
	.strict();
export async function fetchAssistantItem(
	input: z.input<typeof assistantFetchSchema>,
) {
	const p = assistantFetchSchema.parse(input);
	const item = await getOrbitItem(p.id);
	if (!item) throw new AssistantError("not_found", "항목을 찾을 수 없습니다.");
	return {
		...itemSummary(item),
		body: item.body.slice(p.offset, p.offset + (p.length ?? item.body.length)),
		offset: p.offset,
		totalCharacters: item.body.length,
		nextOffset:
			p.offset + (p.length ?? item.body.length) < item.body.length
				? p.offset + (p.length ?? item.body.length)
				: null,
	};
}
export async function compactAssistantContext(
	input: z.input<typeof contextInputSchema>,
) {
	const c = await assistantContext(input);
	return {
		date: c.date,
		timezone: c.timezone,
		weekStart: c.weekStart,
		weekEnd: c.weekEnd,
		counts: {
			today: c.today.length,
			week: c.week.length,
			incomplete: c.incomplete.length,
			overdue: c.overdue.length,
			completedThisWeek: c.completedThisWeek.length,
		},
		today: c.today.map(itemSummary),
		priorities: c.priorities.map((p) => ({
			item: itemSummary(p.task),
			reason: p.reason,
		})),
		goals: c.goals
			.filter((g) => g.status === "active")
			.map((g) => ({
				id: g.id,
				title: g.title,
				progress: g.progress,
			})),
		week: c.week.map(itemSummary),
		projects: c.projects,
		incomplete: c.incomplete.map(itemSummary),
		overdue: c.overdue.map(itemSummary),
		completedThisWeek: c.completedThisWeek.map(itemSummary),
		guidance:
			"Search and read relevant notes or past briefings for additional context. Note bodies and attachments are not included in this overview.",
	};
}
