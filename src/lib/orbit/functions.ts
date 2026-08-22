import { createServerFn } from "@tanstack/react-start";
import { orbitMutationSchema } from "./schema";

export const loadOrbit = createServerFn({ method: "GET" }).handler(async () => {
	const { getOrbitSnapshot } = await import("./store");
	return getOrbitSnapshot();
});

export const mutateOrbit = createServerFn({ method: "POST" })
	.validator((input: unknown) => orbitMutationSchema.parse(input))
	.handler(async ({ data }) => {
		const {
			archiveOrbitItem,
			captureOrbitItem,
			toggleOrbitTask,
			updateOrbitNote,
		} = await import("./store");
		switch (data.action) {
			case "capture":
				return captureOrbitItem(data.input);
			case "toggle-task":
				return toggleOrbitTask(data.id);
			case "update-note":
				return updateOrbitNote(data.id, data.input);
			case "archive-item":
				return archiveOrbitItem(data.id);
		}
	});
