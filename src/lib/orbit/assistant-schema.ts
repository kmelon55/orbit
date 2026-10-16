import { z } from "zod";
import { scheduleCategoryIdSchema } from "./schema";

export const assistantId = z.string().uuid();
export const daySchema = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/)
	.refine((value) => {
		const date = new Date(`${value}T00:00:00Z`);
		return (
			Number.isFinite(date.getTime()) &&
			date.toISOString().slice(0, 10) === value
		);
	}, "Invalid calendar date");
export const timezoneSchema = z
	.string()
	.max(80)
	.refine((value) => {
		try {
			new Intl.DateTimeFormat("en", { timeZone: value }).format();
			return true;
		} catch {
			return false;
		}
	}, "Invalid timezone");
// Orbit stores floating local wall time. Do not silently discard an offset.
export const scheduleSchema = z.union([
	daySchema,
	z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/)
		.refine(
			(value) =>
				daySchema.safeParse(value.slice(0, 10)).success &&
				Number(value.slice(11, 13)) < 24 &&
				Number(value.slice(14, 16)) < 60 &&
				(!value.slice(17) || Number(value.slice(17)) < 60),
			"Invalid local date/time",
		),
]);
const title = z.string().trim().min(1).max(160);
const text = z.string().trim().min(1).max(12000);
export const sourceSchema = z
	.object({
		name: z.string().trim().min(1).max(120),
		url: z
			.string()
			.url()
			.refine((value) => ["https:", "http:"].includes(new URL(value).protocol))
			.optional(),
		externalId: z.string().trim().min(1).max(300).optional(),
		observedAt: z.iso.datetime({ offset: true }),
	})
	.strict();
const roadmapStepSchema = z
	.object({
		outcome: z.string().trim().max(1000),
		reason: z.string().trim().max(1000).default(""),
	})
	.strict();
export const goalRoadmapSchema = z
	.object({
		anchorDate: daySchema,
		middleYears: z.union([z.literal(5), z.literal(6)]).default(5),
		steps: z
			.object({
				decade: roadmapStepSchema.optional(),
				middle: roadmapStepSchema.optional(),
				year: roadmapStepSchema.optional(),
				half: roadmapStepSchema.optional(),
				month: roadmapStepSchema.optional(),
			})
			.strict(),
	})
	.strict();
export const goalInputSchema = z
	.object({
		id: assistantId.optional(),
		expectedRevision: z.number().int().min(1).optional(),
		title,
		description: z.string().max(12000).default(""),
		brand: z.string().trim().min(1).max(120).optional(),
		projectName: z.string().trim().min(1).max(120).optional(),
		horizon: z.enum(["long_term", "quarter", "milestone"]).default("long_term"),
		parentId: assistantId.optional(),
		status: z.enum(["active", "done", "paused"]).default("active"),
		importance: z.number().int().min(1).max(5).default(3),
		targetDate: daySchema.optional(),
		projectFolders: z.array(z.string().min(1).max(500)).max(50).default([]),
		itemIds: z.array(z.string().min(1).max(200)).max(500).default([]),
		successCriteria: z.string().trim().max(1000).optional(),
		metric: z
			.object({
				current: z.number().finite().min(0),
				target: z.number().finite().positive(),
				unit: z.string().trim().max(30),
			})
			.strict()
			.optional(),
		focused: z.boolean().optional(),
		roadmap: goalRoadmapSchema.optional(),
		week: z
			.object({
				start: daySchema,
				outcome: z.string().trim().max(1000),
			})
			.strict()
			.refine(
				(week) => new Date(`${week.start}T12:00:00Z`).getUTCDay() === 0,
				"Goal planning weeks begin Sunday",
			)
			.optional(),
		today: z
			.object({
				date: daySchema,
				itemIds: z
					.array(z.string().min(1).max(200))
					.max(3)
					.refine(
						(ids) => new Set(ids).size === ids.length,
						"Duplicate focus task",
					),
			})
			.strict()
			.optional(),
	})
	.strict();
export const briefingKindSchema = z.enum([
	"daily",
	"evening",
	"weekly",
	"monthly",
]);
export const contextInputSchema = z
	.object({ date: daySchema, timezone: timezoneSchema.default("Asia/Seoul") })
	.strict();
export const briefingInputSchema = z
	.object({
		kind: briefingKindSchema,
		periodStart: daySchema,
		timezone: timezoneSchema,
		title,
		origin: z.enum(["chatgpt", "internal_summary", "api"]),
		sections: z
			.object({
				importantGoals: text,
				progress: text,
				priorities: text,
				rationale: text,
				overdue: text,
				intelligence: text,
				risksAndOpportunities: text,
				schedule: text,
			})
			.strict(),
		sources: z.array(sourceSchema).max(100).default([]),
	})
	.strict();
export const inboxInputSchema = z
	.object({
		title,
		body: text,
		importance: z.number().int().min(1).max(5),
		reason: text,
		source: sourceSchema,
	})
	.strict();
export const inboxStatusSchema = z.enum([
	"unread",
	"reviewing",
	"applied",
	"archived",
]);
const fields = {
	category: scheduleCategoryIdSchema.optional(),
	title,
	body: z.string().max(20000).default(""),
	due: scheduleSchema.optional(),
	start: scheduleSchema.optional(),
	end: scheduleSchema.optional(),
};
const goalPatchSchema = z
	.object({
		title: title.optional(),
		description: goalInputSchema.shape.description.removeDefault().optional(),
		horizon: goalInputSchema.shape.horizon.removeDefault().optional(),
		parentId: assistantId.nullable().optional(),
		status: goalInputSchema.shape.status.removeDefault().optional(),
		importance: goalInputSchema.shape.importance.removeDefault().optional(),
		targetDate: daySchema.nullable().optional(),
		projectFolders: goalInputSchema.shape.projectFolders
			.removeDefault()
			.optional(),
		itemIds: goalInputSchema.shape.itemIds.removeDefault().optional(),
		successCriteria: goalInputSchema.shape.successCriteria,
		metric: goalInputSchema.shape.metric.nullable(),
		focused: goalInputSchema.shape.focused,
		brand: goalInputSchema.shape.brand.nullable(),
		projectName: goalInputSchema.shape.projectName.nullable(),
		roadmap: goalInputSchema.shape.roadmap.nullable(),
		week: goalInputSchema.shape.week.nullable(),
		today: goalInputSchema.shape.today.nullable(),
	})
	.strict()
	.refine(
		(patch) => Object.values(patch).some((value) => value !== undefined),
		"Empty goal update",
	);
export const proposalActionSchema = z.discriminatedUnion("kind", [
	z
		.object({
			kind: z.literal("create"),
			type: z.enum(["task", "event", "note"]),
			...fields,
			projectFolder: z.string().min(1).max(500).optional(),
		})
		.strict(),
	z
		.object({
			kind: z.literal("update"),
			itemId: z.string().min(1).max(200),
			patch: z
				.object({
					title: title.optional(),
					category: scheduleCategoryIdSchema.nullable().optional(),
					body: fields.body.optional(),
					due: scheduleSchema.nullable().optional(),
					start: scheduleSchema.nullable().optional(),
					end: scheduleSchema.nullable().optional(),
					status: z
						.enum(["open", "in_progress", "done", "cancelled"])
						.optional(),
				})
				.strict()
				.refine((p) => Object.keys(p).length > 0, "Empty update"),
		})
		.strict(),
	z
		.object({
			kind: z.literal("create-goal"),
			input: goalInputSchema.omit({ id: true, expectedRevision: true }),
		})
		.strict(),
	z
		.object({
			kind: z.literal("update-goal"),
			goalId: assistantId,
			expectedRevision: z.number().int().positive(),
			patch: goalPatchSchema,
		})
		.strict(),
]);
// This entry point only creates new items; it cannot overwrite an existing ID.
export const createAssistantItemSchema = proposalActionSchema.options[0]
	.omit({ kind: true })
	.extend({
		requestKey: z.string().trim().min(1).max(160),
		goalId: assistantId.optional(),
	})
	.strict();
export const recommendationInputSchema = z
	.object({
		requestKey: z.string().trim().min(1).max(160),
		title,
		reason: text,
		goalId: assistantId.optional(),
		action: proposalActionSchema,
	})
	.strict();
export const decisionSchema = z
	.object({
		decision: z.enum(["apply", "defer", "reject"]),
		selections: z
			.array(
				z
					.object({
						id: assistantId,
						revision: z.number().int().min(1),
						action: proposalActionSchema.optional(),
					})
					.strict(),
			)
			.min(1)
			.max(50),
		deferUntil: daySchema.optional(),
	})
	.strict()
	.refine(
		(v) => new Set(v.selections.map((s) => s.id)).size === v.selections.length,
		"Duplicate selection",
	)
	.refine(
		(v) => v.decision !== "defer" || Boolean(v.deferUntil),
		"Deferral date required",
	)
	.refine(
		(v) => v.decision === "apply" || v.selections.every((s) => !s.action),
		"Edits require apply",
	);
export type ProposalAction = z.infer<typeof proposalActionSchema>;
export type Goal = z.infer<typeof goalInputSchema> & {
	id: string;
	revision: number;
	createdAt: string;
	updatedAt: string;
};
export type Briefing = z.infer<typeof briefingInputSchema> & {
	id: string;
	itemId?: string;
	createdAt: string;
};
export type AssistantInboxItem = z.infer<typeof inboxInputSchema> & {
	id: string;
	status: z.infer<typeof inboxStatusSchema>;
	itemId?: string;
	createdAt: string;
	updatedAt: string;
	revision: number;
};
export type Recommendation = z.infer<typeof recommendationInputSchema> & {
	id: string;
	revision: number;
	state: "pending" | "deferred" | "rejected" | "applied";
	fingerprint?: string;
	resultItemId?: string;
	resultGoalId?: string;
	appliedAction?: ProposalAction;
	deferUntil?: string;
	createdAt: string;
	updatedAt: string;
};
export type AssistantAudit = {
	id: string;
	at: string;
	actor: "owner" | "mcp" | "system";
	action: string;
	ids: string[];
	outcome: "success" | "failure";
	code?: string;
};
export type AssistantState = {
	goals: Goal[];
	briefings: Briefing[];
	inbox: AssistantInboxItem[];
	recommendations: Recommendation[];
	audit: AssistantAudit[];
};
export const assistantMutationSchema = z.discriminatedUnion("action", [
	z.object({ action: z.literal("create"), input: createAssistantItemSchema }),
	z.object({ action: z.literal("goal"), input: goalInputSchema }),
	z.object({
		action: z.literal("delete-goal"),
		id: assistantId,
		revision: z.number().int().min(1),
	}),
	z.object({ action: z.literal("briefing"), input: briefingInputSchema }),
	z.object({ action: z.literal("inbox"), input: inboxInputSchema }),
	z.object({
		action: z.literal("inbox-status"),
		id: assistantId,
		revision: z.number().int().min(1),
		status: inboxStatusSchema,
	}),
	z.object({
		action: z.literal("recommend"),
		input: recommendationInputSchema,
	}),
	z.object({ action: z.literal("decide"), input: decisionSchema }),
]);
export type AssistantMutation = z.infer<typeof assistantMutationSchema>;

const timestamps = {
	createdAt: z.iso.datetime({ offset: true }),
	updatedAt: z.iso.datetime({ offset: true }),
};
export const assistantRecordSchemas = {
	goal: goalInputSchema.omit({ expectedRevision: true }).extend({
		id: assistantId,
		revision: z.number().int().min(1),
		...timestamps,
	}),
	briefing: briefingInputSchema.extend({
		id: z.string().regex(/^[a-f0-9]{64}$/),
		itemId: z.string().min(1).optional(),
		createdAt: timestamps.createdAt,
	}),
	inbox: inboxInputSchema.extend({
		id: assistantId,
		status: inboxStatusSchema,
		itemId: z.string().min(1).optional(),
		revision: z.number().int().min(1),
		...timestamps,
	}),
	recommendation: recommendationInputSchema.extend({
		id: assistantId,
		revision: z.number().int().min(1),
		state: z.enum(["pending", "deferred", "rejected", "applied"]),
		fingerprint: z
			.string()
			.regex(/^[a-f0-9]{64}$/)
			.optional(),
		resultItemId: z.string().min(1).optional(),
		resultGoalId: assistantId.optional(),
		appliedAction: proposalActionSchema.optional(),
		deferUntil: daySchema.optional(),
		...timestamps,
	}),
	audit: z
		.object({
			id: assistantId,
			at: timestamps.createdAt,
			actor: z.enum(["owner", "mcp", "system"]),
			action: z.string().max(80),
			ids: z.array(z.string().max(200)).max(50),
			outcome: z.enum(["success", "failure"]),
			code: z.string().max(80).optional(),
		})
		.strict(),
};
