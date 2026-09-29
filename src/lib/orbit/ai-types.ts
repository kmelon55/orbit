import type { MailFolder } from "../mail/types";
import type { OrbitItemType } from "./schema";

export type AiReference =
	| { kind: "item"; id: string }
	| { kind: "mail"; id: string };

export type AiSource = AiReference & {
	index: number;
	title: string;
	type?: OrbitItemType;
	folder?: MailFolder | string;
	scope: "full" | "preview";
};

export type AiChatMessage = {
	id: string;
	role: "user" | "assistant";
	content: string;
	createdAt: number;
	model?: string;
	references?: AiReference[];
	sources?: AiSource[];
	status?: "pending" | "failed";
};

export type AiChat = {
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	messages: AiChatMessage[];
};

export type AiChatSummary = Pick<
	AiChat,
	"id" | "title" | "createdAt" | "updatedAt"
>;
