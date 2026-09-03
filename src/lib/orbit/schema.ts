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

export const paraFolderSpaceSchema = z.enum([
	"project",
	"area",
	"resource",
	"archive",
]);

export const orbitFolderColorSchema = z.enum([
	"amber",
	"red",
	"orange",
	"lime",
	"emerald",
	"cyan",
	"blue",
	"violet",
	"pink",
	"slate",
]);

export const orbitItemSchema = z.object({
	id: z.string().min(1),
	title: z.string().min(1),
	type: orbitItemTypeSchema,
	space: orbitSpaceSchema,
	status: orbitStatusSchema.optional(),
	project: z.string().optional(),
	folder: z.string().optional(),
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
	start: z.string().optional(),
	end: z.string().optional(),
	url: z.string().url().optional(),
});

export const createItemInputSchema = captureInputSchema.extend({
	space: orbitSpaceSchema.default("inbox"),
	folder: z.string().trim().min(1).max(500).optional(),
});

export const updateNoteInputSchema = z.object({
	title: z.string().trim().min(1).max(160),
	body: z.string().max(100_000),
	tags: z.array(z.string().trim().min(1).max(40)).max(30),
});

export const fileItemInputSchema = z.object({
	title: z.string().trim().min(1).max(160).optional(),
	body: z.string().max(100_000).optional(),
	type: orbitItemTypeSchema.optional(),
	space: orbitSpaceSchema,
	folder: z.string().trim().max(500).optional(),
	due: z.string().nullable().optional(),
	start: z.string().nullable().optional(),
	end: z.string().nullable().optional(),
	url: z.string().url().optional(),
	tags: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
	status: orbitStatusSchema.optional(),
});

export const createFolderInputSchema = z.object({
	space: paraFolderSpaceSchema,
	name: z.string().trim().min(1).max(80),
	parent: z.string().trim().min(1).max(500).optional(),
	color: orbitFolderColorSchema.optional(),
});

export const updateFolderInputSchema = z.object({
	space: paraFolderSpaceSchema,
	path: z.string().trim().min(1).max(500),
	name: z.string().trim().min(1).max(80).optional(),
	color: orbitFolderColorSchema.optional(),
});

export const deleteFolderInputSchema = z.object({
	space: paraFolderSpaceSchema,
	path: z.string().trim().min(1).max(500),
});

export const orbitMutationSchema = z.discriminatedUnion("action", [
	z.object({
		action: z.literal("capture"),
		input: captureInputSchema,
	}),
	z.object({
		action: z.literal("create-item"),
		input: createItemInputSchema,
	}),
	z.object({
		action: z.literal("create-folder"),
		input: createFolderInputSchema,
	}),
	z.object({
		action: z.literal("update-folder"),
		input: updateFolderInputSchema,
	}),
	z.object({
		action: z.literal("delete-folder"),
		input: deleteFolderInputSchema,
	}),
	z.object({
		action: z.literal("file-item"),
		id: z.string().min(1),
		input: fileItemInputSchema,
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
	z.object({
		action: z.literal("delete-item"),
		id: z.string().min(1),
	}),
	z.object({
		action: z.literal("save-canvas"),
		path: z.string().min(1).max(500),
		document: z.string().min(2).max(20_000_000),
	}),
	z.object({
		action: z.literal("create-canvas"),
		title: z.string().trim().min(1).max(160),
	}),
	z.object({
		action: z.literal("rename-canvas"),
		path: z.string().min(1).max(500),
		title: z.string().trim().min(1).max(160),
	}),
]);

export type OrbitItem = z.infer<typeof orbitItemSchema>;
export type OrbitItemType = z.infer<typeof orbitItemTypeSchema>;
export type OrbitSpace = z.infer<typeof orbitSpaceSchema>;
export type CaptureInput = z.infer<typeof captureInputSchema>;
export type CreateItemInput = z.infer<typeof createItemInputSchema>;
export type UpdateNoteInput = z.infer<typeof updateNoteInputSchema>;
export type FileItemInput = z.infer<typeof fileItemInputSchema>;
export type CreateFolderInput = z.infer<typeof createFolderInputSchema>;
export type UpdateFolderInput = z.infer<typeof updateFolderInputSchema>;
export type DeleteFolderInput = z.infer<typeof deleteFolderInputSchema>;
export type OrbitFolderColor = z.infer<typeof orbitFolderColorSchema>;
export type OrbitMutation = z.infer<typeof orbitMutationSchema>;

export type OrbitCanvas = {
	id: string;
	title: string;
	path: string;
	created: string;
	updated: string;
	elementCount: number;
	fileCount: number;
	format: "excalidraw" | "excalidraw.md";
};

export type OrbitFolder = {
	space: "project" | "area" | "resource" | "archive";
	slug: string;
	name: string;
	parent?: string;
	depth: number;
	color: OrbitFolderColor;
	count: number;
	descendantCount: number;
};

export type OrbitSnapshot = {
	items: OrbitItem[];
	canvases: OrbitCanvas[];
	today: {
		tasks: OrbitItem[];
		events: OrbitItem[];
	};
	folders: {
		project: OrbitFolder[];
		area: OrbitFolder[];
		resource: OrbitFolder[];
		archive: OrbitFolder[];
	};
	counts: {
		inbox: number;
		project: number;
		area: number;
		resource: number;
		archive: number;
		event: number;
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
