import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { orbitAuthMiddleware } from "./auth";
import { orbitMutationSchema } from "./schema";

export const loadOrbit = createServerFn({ method: "GET" })
	.middleware([orbitAuthMiddleware])
	.handler(async () => {
		const { getOrbitSnapshot } = await import("./store");
		return getOrbitSnapshot();
	});

const mutateOrbitRequest = createServerFn({ method: "POST" })
	.middleware([orbitAuthMiddleware])
	.validator((input: unknown) => orbitMutationSchema.parse(input))
	.handler(async ({ data }) => {
		const {
			withItemUndo,
			moveOrbitTreeEntry,
			archiveOrbitItem,
			captureOrbitItem,
			createOrbitFolder,
			createOrbitItem,
			deleteOrbitFolder,
			deleteOrbitItem,
			fileOrbitItem,
			renameOrbitCanvas,
			updateOrbitFolder,
			toggleOrbitTask,
			updateOrbitNote,
			saveOrbitCanvas,
			createOrbitCanvas,
		} = await import("./store");
		return withItemUndo(data, async () => {
			switch (data.action) {
				case "move-tree-entry":
					return moveOrbitTreeEntry(data.input);
				case "capture":
					return captureOrbitItem(data.input);
				case "create-item":
					return createOrbitItem(data.input);
				case "create-folder":
					return createOrbitFolder(data.input);
				case "update-folder":
					return updateOrbitFolder(data.input);
				case "delete-folder":
					return deleteOrbitFolder(data.input);
				case "file-item":
					return fileOrbitItem(data.id, data.input);
				case "toggle-task":
					return toggleOrbitTask(data.id);
				case "update-note":
					return updateOrbitNote(data.id, data.input);
				case "archive-item":
					return archiveOrbitItem(data.id);
				case "delete-item":
					return deleteOrbitItem(data.id);
				case "save-canvas":
					return saveOrbitCanvas(data.path, data.document);
				case "create-canvas":
					return createOrbitCanvas(data.title);
				case "rename-canvas":
					return renameOrbitCanvas(data.path, data.title);
			}
		});
	});

export async function mutateOrbit(
	options: Parameters<typeof mutateOrbitRequest>[0],
) {
	try {
		const response = await mutateOrbitRequest(options);
		if (response.undo && typeof window !== "undefined")
			window.dispatchEvent(
				new CustomEvent("orbit:mutation", { detail: response.undo }),
			);
		return response.result;
	} catch (error) {
		const action = orbitMutationSchema.safeParse(options?.data).data?.action;
		if (
			typeof window !== "undefined" &&
			action !== "update-note" &&
			action !== "save-canvas"
		)
			window.dispatchEvent(new Event("orbit:mutation-failed"));
		throw error;
	}
}

export const undoOrbit = createServerFn({ method: "POST" })
	.middleware([orbitAuthMiddleware])
	.validator((input: unknown) =>
		z.object({ id: z.string().uuid() }).parse(input),
	)
	.handler(async ({ data }) => {
		const { undoOrbitMutation } = await import("./store");
		return undoOrbitMutation(data.id);
	});

export const loadOrbitCanvas = createServerFn({ method: "GET" })
	.middleware([orbitAuthMiddleware])
	.validator((input: unknown) =>
		z.object({ path: z.string().min(1) }).parse(input),
	)
	.handler(async ({ data }) => {
		const { getOrbitCanvas } = await import("./store");
		return getOrbitCanvas(data.path);
	});
