import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { orbitAuthMiddleware } from "./auth";
import { classificationSourceSchema } from "./classification";

export const loadClassification = createServerFn({ method: "GET" })
	.middleware([orbitAuthMiddleware])
	.validator((input: unknown) => classificationSourceSchema.parse(input))
	.handler(async ({ data }) => {
		const { cachedClassification } = await import("./classification.server");
		return cachedClassification(data);
	});

export const classifyOrbitSource = createServerFn({ method: "POST" })
	.middleware([orbitAuthMiddleware])
	.validator((input: unknown) => classificationSourceSchema.parse(input))
	.handler(async ({ data }) => {
		const { classifySource } = await import("./classification.server");
		return classifySource(data);
	});

export const classifyMailbox = createServerFn({ method: "POST" })
	.middleware([orbitAuthMiddleware])
	.validator((input: unknown) =>
		z.array(z.string().min(1).max(500)).max(100).parse(input),
	)
	.handler(async ({ data }) => {
		const { requestMailClassifications } = await import(
			"./mail-classification.server"
		);
		return requestMailClassifications(data);
	});
