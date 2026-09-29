import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { orbitAuthMiddleware } from "./auth";

export const loadAiSettings = createServerFn({ method: "GET" })
	.middleware([orbitAuthMiddleware])
	.handler(async () => {
		const { gatewaySettings } = await import("./ai.server");
		return gatewaySettings();
	});

export const saveAiKey = createServerFn({ method: "POST" })
	.middleware([orbitAuthMiddleware])
	.validator((input: unknown) =>
		z.object({ key: z.string().trim().min(10).max(1000) }).parse(input),
	)
	.handler(async ({ data }) => {
		const { saveGatewayKey } = await import("./ai.server");
		return saveGatewayKey(data.key);
	});

export const removeAiKey = createServerFn({ method: "POST" })
	.middleware([orbitAuthMiddleware])
	.handler(async () => {
		const { removeGatewayKey } = await import("./ai.server");
		return removeGatewayKey();
	});

export const loadAiModels = createServerFn({ method: "GET" })
	.middleware([orbitAuthMiddleware])
	.handler(async () => {
		const { gatewayModels } = await import("./ai.server");
		return gatewayModels();
	});

export const refreshAiModels = createServerFn({ method: "POST" })
	.middleware([orbitAuthMiddleware])
	.handler(async () => {
		const { gatewayModels } = await import("./ai.server");
		return gatewayModels(true);
	});

export const loadAiHistory = createServerFn({ method: "GET" })
	.middleware([orbitAuthMiddleware])
	.handler(async () => {
		const { aiChats } = await import("./ai-history.server");
		return aiChats();
	});

export const loadAiChat = createServerFn({ method: "GET" })
	.middleware([orbitAuthMiddleware])
	.validator((input: unknown) => z.object({ id: z.uuid() }).parse(input))
	.handler(async ({ data }) => {
		const { aiChat } = await import("./ai-history.server");
		const chat = aiChat(data.id);
		if (!chat) throw new Error("대화 기록을 찾을 수 없습니다.");
		return chat;
	});

export const deleteAiChat = createServerFn({ method: "POST" })
	.middleware([orbitAuthMiddleware])
	.validator((input: unknown) => z.object({ id: z.uuid() }).parse(input))
	.handler(async ({ data }) => {
		const { deleteAiChat } = await import("./ai-history.server");
		deleteAiChat(data.id);
		return { deleted: true };
	});

export const askOrbitAi = createServerFn({ method: "POST" })
	.middleware([orbitAuthMiddleware])
	.validator((input: unknown) =>
		z
			.object({
				question: z.string().trim().min(2).max(1000),
				model: z.string().min(3).max(200),
				chatId: z.uuid().optional(),
				requestId: z.uuid(),
				references: z
					.array(
						z.discriminatedUnion("kind", [
							z.object({
								kind: z.literal("item"),
								id: z.string().min(1).max(500),
							}),
							z.object({
								kind: z.literal("mail"),
								id: z.string().min(1).max(500),
							}),
						]),
					)
					.max(8)
					.default([]),
			})
			.parse(input),
	)
	.handler(async ({ data }) => {
		const { askOrbit } = await import("./ai.server");
		return askOrbit(
			data.question,
			data.model,
			data.references,
			data.chatId,
			data.requestId,
		);
	});
