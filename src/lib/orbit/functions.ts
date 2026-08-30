import { createServerFn } from "@tanstack/react-start";
import { orbitAuthMiddleware } from "./auth";
import { orbitMutationSchema } from "./schema";

export const loadOrbit = createServerFn({ method: "GET" })
	.middleware([orbitAuthMiddleware])
	.handler(async () => {
		const { getOrbitSnapshot } = await import("./store");
		return getOrbitSnapshot();
	});

export const mutateOrbit = createServerFn({ method: "POST" })
	.middleware([orbitAuthMiddleware])
	.validator((input: unknown) => orbitMutationSchema.parse(input))
	.handler(async ({ data }) => {
		const {
			archiveOrbitItem,
			captureOrbitItem,
			createOrbitFolder,
			createOrbitItem,
			deleteOrbitItem,
			fileOrbitItem,
			toggleOrbitTask,
			updateOrbitNote,
		} = await import("./store");
		switch (data.action) {
			case "capture":
				return captureOrbitItem(data.input);
			case "create-item":
				return createOrbitItem(data.input);
			case "create-folder":
				return createOrbitFolder(data.input);
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
		}
	});
