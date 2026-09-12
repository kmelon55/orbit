import type { OrbitItem } from "./schema";

export type MutationReceipt = {
	id: string;
	itemId: string;
	title: string;
	message: string;
};
export type UndoResult = {
	itemId: string;
	item: OrbitItem | null;
	fields: string[];
};

export function onItemUndone(listener: (result: UndoResult) => void) {
	const handle = (event: Event) =>
		listener((event as CustomEvent<UndoResult>).detail);
	window.addEventListener("orbit:item-undone", handle);
	return () => window.removeEventListener("orbit:item-undone", handle);
}
