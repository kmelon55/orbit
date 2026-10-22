import { withDatabase } from "./database";
import { indexFolderTree } from "./folder-tree";
import { type TreeSelectionInput, treeSelectionInputSchema } from "./schema";
import * as operations from "./store-operations";
import { treeMoveEntries, treeSelectionRoots } from "./tree-move";

export function operateOrbitTreeSelection(input: TreeSelectionInput) {
	return withDatabase(async () => {
		const parsed = treeSelectionInputSchema.parse(input);
		const snapshot = await operations.getOrbitSnapshot();
		const entries = treeMoveEntries(
			indexFolderTree(
				snapshot.items.filter((item) => item.space === parsed.space),
				snapshot.folders[parsed.space],
				snapshot.treeOrder?.[parsed.space],
			),
		);
		const keys = treeSelectionRoots(entries, parsed.keys);
		if (parsed.operation === "delete" && !parsed.confirmDelete)
			throw new Error("삭제할 항목과 폴더 내용을 확인해 주세요.");
		if (
			parsed.operation === "move" &&
			parsed.target &&
			parsed.keys.includes(parsed.target)
		)
			throw new Error("선택한 항목으로 이동할 수 없습니다.");
		// Repeated after-insertions must run backwards to retain selection order.
		if (parsed.position === "after") keys.reverse();
		for (const key of keys) {
			if (parsed.operation === "move") {
				await operations.moveOrbitTreeEntry({
					space: parsed.space,
					key,
					target: parsed.target,
					position: parsed.position,
				});
			} else {
				const entry = entries.get(key);
				if (!entry) throw new Error("선택한 항목을 찾을 수 없습니다.");
				if (entry.folder)
					await operations.deleteOrbitFolder({
						space: parsed.space,
						path: entry.folder.slug,
						deleteContents: true,
						confirmationName: entry.folder.name,
					});
				else if (entry.item) await operations.deleteOrbitItem(entry.item.id);
			}
		}
		const after = await operations.getOrbitSnapshot();
		const remaining = new Map(after.items.map((item) => [item.id, item]));
		const beforeById = new Map(snapshot.items.map((item) => [item.id, item]));
		return {
			ok: true,
			removedIds: snapshot.items
				.filter((item) => !remaining.has(item.id))
				.map((item) => item.id),
			items: after.items.filter(
				(item) =>
					beforeById.get(item.id)?.path !== item.path ||
					beforeById.get(item.id)?.updated !== item.updated,
			),
		};
	}, true);
}
export function listOrbitItems(
	...args: Parameters<typeof operations.listOrbitItems>
) {
	return withDatabase(() => operations.listOrbitItems(...args), false);
}
export function getOrbitSnapshot(
	...args: Parameters<typeof operations.getOrbitSnapshot>
) {
	return withDatabase(() => operations.getOrbitSnapshot(...args), false);
}
export function getOrbitCanvas(
	...args: Parameters<typeof operations.getOrbitCanvas>
) {
	return withDatabase(() => operations.getOrbitCanvas(...args), false);
}
export function saveOrbitCanvas(
	...args: Parameters<typeof operations.saveOrbitCanvas>
) {
	return withDatabase(() => operations.saveOrbitCanvas(...args), true);
}
export function createOrbitCanvas(
	...args: Parameters<typeof operations.createOrbitCanvas>
) {
	return withDatabase(() => operations.createOrbitCanvas(...args), true);
}
export function renameOrbitCanvas(
	...args: Parameters<typeof operations.renameOrbitCanvas>
) {
	return withDatabase(() => operations.renameOrbitCanvas(...args), true);
}
export function captureOrbitItem(
	...args: Parameters<typeof operations.captureOrbitItem>
) {
	return withDatabase(() => operations.captureOrbitItem(...args), true);
}
export function createOrbitItem(
	...args: Parameters<typeof operations.createOrbitItem>
) {
	return withDatabase(() => operations.createOrbitItem(...args), true);
}
export function createOrbitFolder(
	...args: Parameters<typeof operations.createOrbitFolder>
) {
	return withDatabase(() => operations.createOrbitFolder(...args), true);
}
export function updateOrbitFolder(
	...args: Parameters<typeof operations.updateOrbitFolder>
) {
	return withDatabase(() => operations.updateOrbitFolder(...args), true);
}
export function deleteOrbitFolder(
	...args: Parameters<typeof operations.deleteOrbitFolder>
) {
	return withDatabase(() => operations.deleteOrbitFolder(...args), true);
}
export function fileOrbitItem(
	...args: Parameters<typeof operations.fileOrbitItem>
) {
	return withDatabase(() => operations.fileOrbitItem(...args), true);
}
export function toggleOrbitTask(
	...args: Parameters<typeof operations.toggleOrbitTask>
) {
	return withDatabase(() => operations.toggleOrbitTask(...args), true);
}
export function updateOrbitNote(
	...args: Parameters<typeof operations.updateOrbitNote>
) {
	return withDatabase(() => operations.updateOrbitNote(...args), true);
}
export function archiveOrbitItem(
	...args: Parameters<typeof operations.archiveOrbitItem>
) {
	return withDatabase(() => operations.archiveOrbitItem(...args), true);
}
export function deleteOrbitItem(
	...args: Parameters<typeof operations.deleteOrbitItem>
) {
	return withDatabase(() => operations.deleteOrbitItem(...args), true);
}
export function getOrbitItem(
	...args: Parameters<typeof operations.getOrbitItem>
) {
	return withDatabase(() => operations.getOrbitItem(...args), false);
}
export function moveOrbitTreeEntry(
	...args: Parameters<typeof operations.moveOrbitTreeEntry>
) {
	return withDatabase(() => operations.moveOrbitTreeEntry(...args), true);
}
export function withItemUndo<T>(
	data: Parameters<typeof operations.withItemUndo>[0],
	work: () => Promise<T>,
) {
	return withDatabase(() => operations.withItemUndo(data, work), true);
}
export function undoOrbitMutation(
	...args: Parameters<typeof operations.undoOrbitMutation>
) {
	return withDatabase(() => operations.undoOrbitMutation(...args), true);
}

export function saveScheduleCategory(
	...args: Parameters<typeof operations.saveScheduleCategory>
) {
	return withDatabase(() => operations.saveScheduleCategory(...args), true);
}
