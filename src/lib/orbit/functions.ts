import { createServerFn } from "@tanstack/react-start";
import { orbitMutationSchema } from "./schema";

export const loadOrbit = createServerFn({ method: "GET" }).handler(async () => {
	const { getOrbitSnapshot } = await import("./store");
	return getOrbitSnapshot();
});

export const mutateOrbit = createServerFn({ method: "POST" })
	.validator((input: unknown) => orbitMutationSchema.parse(input))
	.handler(async ({ data }) => {
		const { captureOrbitItem, toggleOrbitTask } = await import("./store");
		if (data.action === "capture") return captureOrbitItem(data.input);
		return toggleOrbitTask(data.id);
	});
