import type { MailMessage } from "./types";

// Provider thread IDs and RFC reply references are stronger than matching subjects.
// Never combine unrelated invoices/newsletters just because their subjects match.
export function conversations(messages: MailMessage[]) {
	const parents = new Map<string, string>();
	function root(key: string): string {
		const parent = parents.get(key);
		if (!parent) {
			parents.set(key, key);
			return key;
		}
		if (parent === key) return key;
		const value = root(parent);
		parents.set(key, value);
		return value;
	}
	const keys = (m: MailMessage) =>
		[
			`message:${m.id}`,
			...(m.threadId ? [`thread:${m.threadId}`] : []),
			...[m.messageId, ...(m.references || [])]
				.filter(Boolean)
				.map((id) => `rfc:${id}`),
		].map((id) => `${m.accountId}:${id}`);
	for (const m of messages) {
		const ids = keys(m);
		for (const id of ids.slice(1)) parents.set(root(id), root(ids[0]));
	}
	const groups = new Map<string, MailMessage[]>();
	for (const m of messages) {
		const key = root(keys(m)[0]);
		const group = groups.get(key) || [];
		if (
			!group.some(
				(entry) =>
					entry.id === m.id ||
					(entry.accountId === m.accountId &&
						((entry.remoteId === m.remoteId && entry.mailbox === m.mailbox) ||
							(m.messageId && entry.messageId === m.messageId))),
			)
		)
			group.push(m);
		groups.set(key, group);
	}
	return [...groups.values()]
		.map((group) => group.sort((a, b) => b.date - a.date))
		.sort((a, b) => b[0].date - a[0].date);
}

export function relatedMessages(
	selected: MailMessage,
	messages: MailMessage[],
) {
	return (
		conversations([selected, ...messages]).find((group) =>
			group.some((m) => m.id === selected.id),
		) || [selected]
	);
}
