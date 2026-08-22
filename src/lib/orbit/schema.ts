import { z } from "zod";

export const orbitItemTypeSchema = z.enum(["note", "task", "event", "link"]);

export const orbitSpaceSchema = z.enum([
	"inbox",
	"project",
	"area",
	"resource",
	"event",
	"archive",
]);

export const orbitStatusSchema = z.enum([
	"open",
	"in_progress",
	"done",
	"cancelled",
]);

export const orbitItemSchema = z.object({
	id: z.string().min(1),
	title: z.string().min(1),
	type: orbitItemTypeSchema,
	space: orbitSpaceSchema,
	status: orbitStatusSchema.optional(),
	project: z.string().optional(),
	due: z.string().optional(),
	start: z.string().optional(),
	end: z.string().optional(),
	url: z.string().url().optional(),
	tags: z.array(z.string()).default([]),
	created: z.string(),
	updated: z.string(),
	body: z.string().default(""),
	path: z.string(),
});

export const captureInputSchema = z.object({
	title: z.string().trim().min(1).max(160),
	body: z.string().trim().max(20_000).default(""),
	type: orbitItemTypeSchema.default("note"),
	due: z.string().optional(),
});

export const updateNoteInputSchema = z.object({
	title: z.string().trim().min(1).max(160),
	body: z.string().max(100_000),
	tags: z.array(z.string().trim().min(1).max(40)).max(30),
});

export const orbitMutationSchema = z.discriminatedUnion("action", [
	z.object({
		action: z.literal("capture"),
		input: captureInputSchema,
	}),
	z.object({
		action: z.literal("toggle-task"),
		id: z.string().min(1),
	}),
	z.object({
		action: z.literal("update-note"),
		id: z.string().min(1),
		input: updateNoteInputSchema,
	}),
	z.object({
		action: z.literal("archive-item"),
		id: z.string().min(1),
	}),
]);

export type OrbitItem = z.infer<typeof orbitItemSchema>;
export type OrbitItemType = z.infer<typeof orbitItemTypeSchema>;
export type CaptureInput = z.infer<typeof captureInputSchema>;
export type UpdateNoteInput = z.infer<typeof updateNoteInputSchema>;
export type OrbitMutation = z.infer<typeof orbitMutationSchema>;

export type OrbitSnapshot = {
	items: OrbitItem[];
	today: {
		tasks: OrbitItem[];
		events: OrbitItem[];
	};
	counts: {
		inbox: number;
		projects: number;
		areas: number;
		resources: number;
	};
	vaultPath: string;
	generatedAt: string;
	displayDate: {
		day: string;
		month: string;
		weekday: string;
		longLabel: string;
	};
};
