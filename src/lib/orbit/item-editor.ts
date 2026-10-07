import type { FileItemInput, OrbitItem } from "./schema";

export type EditableItemType = "note" | "task" | "event";

export function itemEditorInput(
	item: OrbitItem | undefined,
	fields: {
		type: EditableItemType;
		title: string;
		body: string;
		category?: string;
		start?: string;
		end?: string;
		due?: string;
	},
): FileItemInput {
	const scheduled = fields.type !== "note";
	const space =
		fields.type === "event"
			? "event"
			: item?.space === "event"
				? "inbox"
				: (item?.space ?? "inbox");
	return {
		...fields,
		space,
		folder:
			space === "event" || item?.space === "event" ? undefined : item?.folder,
		status: fields.type === "task" ? item?.status : undefined,
		start: scheduled ? (fields.start ?? null) : null,
		end: scheduled ? (fields.end ?? null) : null,
		due: fields.type === "task" ? (fields.due ?? null) : null,
		category: fields.category ?? null,
	};
}
