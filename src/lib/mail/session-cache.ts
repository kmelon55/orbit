import type { mailApi } from "./client";
import type { MailDetail, MailMessage, MailStatus } from "./types";

export type MailConversation = {
	messages: MailMessage[];
	incomplete: boolean;
	error?: string;
};

type SessionCache = {
	status: MailStatus | null;
	pages: Map<string, MailMessage[]>;
	details: Map<string, MailDetail>;
	threads: Map<string, MailConversation>;
	statusRequest?: Promise<MailStatus>;
};

const sessions = new WeakMap<typeof mailApi, SessionCache>();

export function mailSessionFor(api: typeof mailApi) {
	let session = sessions.get(api);
	if (!session) {
		session = {
			status: null,
			pages: new Map(),
			details: new Map(),
			threads: new Map(),
		};
		sessions.set(api, session);
	}
	return session;
}
