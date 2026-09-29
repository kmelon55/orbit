import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { orbitAuthMiddleware } from "./auth";

export const searchCachedMail = createServerFn({ method: "POST" })
	.middleware([orbitAuthMiddleware])
	.validator((input: unknown) =>
		z.object({ query: z.string().trim().min(1).max(200) }).parse(input),
	)
	.handler(async ({ data }) => {
		const { mailStore } = await import("../mail/store.server");
		return mailStore()
			.searchMessages(data.query, 20)
			.map((message) => ({
				id: message.id,
				folder: message.folder,
				accountId: message.accountId,
				subject: message.subject,
				from:
					message.from[0]?.name || message.from[0]?.address || "보낸 사람 없음",
				snippet: message.snippet,
				date: message.date,
			}));
	});
