import { z } from "zod";
import {
	AssistantError,
	assistantContext,
	dayInZone,
} from "./assistant.server";
import { contextInputSchema, daySchema } from "./assistant-schema";
import { goalMapProgress, goalProjectGroups } from "./goal-portfolio";
import { focusedGoal, goalWeekStart } from "./goals";
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
	const activeRootIds = new Set(
		c.goals
			.filter((g) => !g.parentId && g.status === "active")
			.map((g) => g.id),
	);
	// Include every stage of active goals so completed and paused work stays visible.
	const goals = c.goals.filter((g) => activeRootIds.has(g.parentId ?? g.id));
	return {
		date: c.date,
		timezone: c.timezone,
		weekStart: c.weekStart,
		weekEnd: c.weekEnd,
		goalWeekStart: goalWeekStart(c.date),
		focusedGoalId: focusedGoal(c.goals)?.id ?? null,
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
		goalProjects: goalProjectGroups(goals, c.projects)
			.filter((group) => group.goals.length)
			.map((group) => ({
				key: group.key,
				name: group.name,
				folders: group.folders,
				goalIds: group.goals.map((goal) => goal.id),
			})),
		goals: goals.map((g) => ({
			id: g.id,
			title: g.title,
			revision: g.revision,
			status: g.status,
			horizon: g.horizon,
			projectName: g.projectName ?? g.brand ?? null,
			brand: g.brand ?? null,
			roadmap: g.roadmap ?? null,
			parentId: g.parentId ?? null,
			focused: Boolean(g.focused),
			targetDate: g.targetDate ?? null,
			successCriteria: g.successCriteria ?? "",
			metric: g.metric ?? null,
			week: g.week ?? null,
			today: g.today ?? null,
			projectFolders: g.projectFolders,
			linkedTaskIds: g.linkedTaskIds,
			milestoneProgress: goalMapProgress(g, c.goals),
			taskProgress: g.progress,
			// Retain the original task-count field for existing MCP clients.
			progress: g.progress,
		})),
		week: c.week.map(itemSummary),
		projects: c.projects,
		incomplete: c.incomplete.map(itemSummary),
		overdue: c.overdue.map(itemSummary),
		completedThisWeek: c.completedThisWeek.map(itemSummary),
		guidance:
			"Use focusedGoalId as the chosen main goal. goalProjects matches the project groups in the Goals UI; roadmap goals are separate backward plans. goals includes active roots and all their stages, including done and paused stages: respect status and do not propose completed stages again. Read orbit_assistant_records for done or paused root goals. milestoneProgress is the Goals map's stage completion count and percent, with nextMilestoneId; a done goal displays 100 percent. taskProgress counts linked tasks excluding archived/cancelled tasks; progress is its legacy alias. Neither measures business results: metric is the separately recorded outcome. Roadmap steps are planning horizons, not nested milestones or completion measurements. Goal weekly plans start Sunday (goalWeekStart), while briefing weeks start Monday (weekStart). Compare goal.week.start and goal.today.date to the current period; never silently carry stale plans forward. Read a goal record for details before proposing edits with its expectedRevision. Nested roadmap, week, today and metric patch fields replace the whole object: preserve their other values when editing. Use existing task IDs for daily focus; do not duplicate tasks or move their deadlines merely to focus on them. Search and read relevant notes or past briefings for additional context.",
	};
}
