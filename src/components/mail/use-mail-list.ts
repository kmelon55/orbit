import { useCallback, useEffect, useRef, useState } from "react";
import { mailApi } from "#/lib/mail/client";
import { mailScopes } from "#/lib/mail/identities";
import type { MailFolder, MailMessage, MailStatus } from "#/lib/mail/types";

type SessionCache = {
	status: MailStatus | null;
	pages: Map<string, MailMessage[]>;
	statusRequest?: Promise<MailStatus>;
};
const sessions = new WeakMap<typeof mailApi, SessionCache>();
function sessionFor(api: typeof mailApi) {
	let session = sessions.get(api);
	if (!session) {
		session = { status: null, pages: new Map() };
		sessions.set(api, session);
	}
	return session;
}
type Page = { messages: MailMessage[]; cursor: string | null };
export function useMailList(
	accountIds: string[] | null,
	folder: MailFolder,
	search: string,
	api: typeof mailApi = mailApi,
) {
	const session = sessionFor(api);
	const [status, setStatus] = useState<MailStatus | null>(session.status);
	const [messages, setMessagesState] = useState<MailMessage[]>([]);
	const [loading, setLoading] = useState(true);
	const [syncing, setSyncing] = useState<string[]>([]);
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [error, setError] = useState("");
	const [cursors, setCursors] = useState<Record<string, string | null>>({});
	const [updated, setUpdated] = useState<Record<string, number>>({});
	const generation = useRef(0);
	const cache = useRef(session.pages);
	const mutations = useRef(0);
	const controller = useRef<AbortController | null>(null);
	const active = useRef(false);
	const scope = JSON.stringify([
		accountIds === null ? null : [...accountIds].sort(),
		folder,
		search,
		status?.accounts.map((account) => [
			account.id,
			account.email,
			account.aliases || [],
		]),
	]);
	const scopeRef = useRef(scope);
	scopeRef.current = scope;
	const setMessages = useCallback(
		(update: React.SetStateAction<MailMessage[]>) => {
			setMessagesState((previous) => {
				const next = typeof update === "function" ? update(previous) : update;
				cache.current.set(scopeRef.current, next);
				return next;
			});
		},
		[],
	);
	const beginMutation = useCallback(() => {
		mutations.current++;
		const originalScope = scopeRef.current;
		for (const key of cache.current.keys())
			if (key !== originalScope) cache.current.delete(key);
		generation.current++;
		controller.current?.abort();
		controller.current = new AbortController();
		active.current = false;
		setLoading(false);
		setSyncing([]);
		return () => {
			mutations.current = Math.max(0, mutations.current - 1);
			if (!mutations.current && scopeRef.current !== originalScope)
				void refreshRef.current(true);
		};
	}, []);
	const statusRef = useRef(status);
	statusRef.current = status;
	const cursorsRef = useRef(cursors);
	cursorsRef.current = cursors;
	const refreshStatus = useCallback(async () => {
		const request = session.statusRequest ?? api<MailStatus>("status");
		session.statusRequest = request;
		try {
			const next = await request;
			session.status = next;
			setStatus(next);
			statusRef.current = next;
			return next;
		} finally {
			if (session.statusRequest === request) session.statusRequest = undefined;
		}
	}, [api, session]);
	const refresh = useCallback(
		async (remote = true, more = false) => {
			if (active.current || mutations.current) return;
			const current = generation.current;
			const abort = controller.current;
			const valid = () =>
				current === generation.current && !abort?.signal.aborted;
			active.current = true;
			setError("");
			try {
				const next = statusRef.current || (await refreshStatus());
				if (!valid()) return;
				const scopes = mailScopes(next.accounts, accountIds);
				if (!remote) {
					const pages = await Promise.all(
						scopes.map(async (account) => {
							const params = new URLSearchParams({
								account: account.id,
								folder,
								q: search,
							});
							for (const address of account.addresses)
								params.append("address", address);
							return api<Page>(`messages?${params}`, undefined, abort?.signal);
						}),
					);
					if (valid()) {
						const messages = pages
							.flatMap((page) => page.messages)
							.sort((a, b) => b.date - a.date);
						setMessages(messages);
						cache.current.set(scope, messages);
					}
					return;
				}
				setLoading(true);
				const accounts = scopes.filter(
					(a) => !more || cursorsRef.current[a.id],
				);
				setSyncing(accounts.map((a) => a.id));
				if (!more) setErrors({});
				await Promise.all(
					accounts.map(async (a) => {
						try {
							const params = new URLSearchParams({
								account: a.id,
								folder,
								q: search,
								remote: "1",
							});
							for (const address of a.addresses)
								params.append("address", address);
							if (more && cursorsRef.current[a.id])
								params.set("cursor", cursorsRef.current[a.id] as string);
							const page = await api<Page>(
								`messages?${params}`,
								undefined,
								abort?.signal,
							);
							if (!valid()) return;
							setMessages((previous) => {
								const ids = new Set(page.messages.map((m) => m.id));
								const cutoff = Math.min(...page.messages.map((m) => m.date));
								const retained = previous.filter(
									(m) =>
										!ids.has(m.id) &&
										(m.accountId !== a.id ||
											more ||
											(page.cursor && m.date < cutoff)),
								);
								const merged = [...retained, ...page.messages].sort(
									(a, b) => b.date - a.date,
								);
								cache.current.set(scope, merged);
								if (cache.current.size > 12)
									cache.current.delete(
										cache.current.keys().next().value as string,
									);
								return merged;
							});
							setCursors((prev) => ({ ...prev, [a.id]: page.cursor }));
							setUpdated((prev) => ({ ...prev, [a.id]: Date.now() }));
							setErrors((prev) => {
								const next = { ...prev };
								delete next[a.id];
								return next;
							});
						} catch (e) {
							if (valid())
								setErrors((prev) => ({
									...prev,
									[a.id]:
										e instanceof Error
											? e.message
											: "메일을 불러오지 못했습니다.",
								}));
						} finally {
							if (valid())
								setSyncing((prev) => prev.filter((id) => id !== a.id));
						}
					}),
				);
			} catch (e) {
				if (valid())
					setError(
						e instanceof Error ? e.message : "메일을 불러오지 못했습니다.",
					);
			} finally {
				if (valid()) {
					active.current = false;
					setLoading(false);
				}
			}
		},
		[accountIds, folder, search, scope, refreshStatus, api, setMessages],
	);
	const refreshRef = useRef(refresh);
	refreshRef.current = refresh;
	useEffect(() => {
		void refreshStatus().catch((e) => setError(e.message));
	}, [refreshStatus]);
	useEffect(() => {
		generation.current++;
		controller.current?.abort();
		controller.current = new AbortController();
		active.current = false;
		const cached = cache.current.get(scope);
		setMessagesState(cached || []);
		setCursors({});
		setSyncing([]);
		setErrors({});
		setLoading(true);
		const current = generation.current;
		void refreshRef.current(Boolean(cached)).then(() => {
			if (cached) return;
			if (current === generation.current) void refreshRef.current(true);
		});
		return () => {
			generation.current++;
			controller.current?.abort();
		};
	}, [scope]);
	useEffect(() => {
		const refreshVisible = () => {
			if (document.visibilityState === "visible") void refreshRef.current(true);
		};
		const timer = setInterval(refreshVisible, 60_000);
		document.addEventListener("visibilitychange", refreshVisible);
		return () => {
			clearInterval(timer);
			document.removeEventListener("visibilitychange", refreshVisible);
		};
	}, []);
	return {
		status,
		messages,
		setMessages,
		loading,
		syncing,
		errors,
		error,
		setError,
		cursors,
		updated,
		refresh,
		refreshStatus,
		beginMutation,
		refreshRef,
	};
}
