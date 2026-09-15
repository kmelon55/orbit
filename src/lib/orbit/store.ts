import { withDatabase } from "./database";
import * as operations from "./store-operations";
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
