import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { goalInputSchema } from "./assistant-schema";
import { orbitAuthMiddleware } from "./auth";

export const loadGoals = createServerFn({ method: "GET" })
	.middleware([orbitAuthMiddleware])
	.handler(async () => {
		const { loadAssistantState } = await import("./assistant.server");
		return (await loadAssistantState()).goals;
	});

export const writeGoal = createServerFn({ method: "POST" })
	.middleware([orbitAuthMiddleware])
	.validator((input: unknown) => goalInputSchema.parse(input))
	.handler(async ({ data }) => {
		const { mutateAssistant } = await import("./assistant.server");
		return (await mutateAssistant({ action: "goal", input: data })).goals;
	});

export const removeGoal = createServerFn({ method: "POST" })
	.middleware([orbitAuthMiddleware])
	.validator((input: unknown) =>
		z
			.object({ id: z.string().uuid(), revision: z.number().int().positive() })
			.strict()
			.parse(input),
	)
	.handler(async ({ data }) => {
		const { mutateAssistant } = await import("./assistant.server");
		return (await mutateAssistant({ action: "delete-goal", ...data })).goals;
	});
