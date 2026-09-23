import { useCallback, useEffect, useRef, useState } from "react";
import { mailApi } from "#/lib/mail/client";
import { mailScopes } from "#/lib/mail/identities";
import type { MailFolder, MailMessage, MailStatus } from "#/lib/mail/types";

type Page = { messages: MailMessage[]; cursor: string | null };
export function useMailList(
	accountIds: string[] | null,
	folder: MailFolder,
	search: string,
	api: typeof mailApi = mailApi,
) {
	const [status, setStatus] = useState<MailStatus | null>(null);
	const [messages, setMessages] = useState<MailMessage[]>([]);
	const [loading, setLoading] = useState(true);
	const [syncing, setSyncing] = useState<string[]>([]);
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [error, setError] = useState("");
	const [cursors, setCursors] = useState<Record<string, string | null>>({});
	const [updated, setUpdated] = useState<Record<string, number>>({});
	const generation = useRef(0);
	const cache = useRef(new Map<string, MailMessage[]>());
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
	const statusRef = useRef(status);
	statusRef.current = status;
	const cursorsRef = useRef(cursors);
	cursorsRef.current = cursors;
	const refreshStatus = useCallback(async () => {
		const next = await api<MailStatus>("status");
		setStatus(next);
		statusRef.current = next;
		return next;
	}, [api]);
	const refresh = useCallback(
		async (remote = true, more = false) => {
			if (active.current) return;
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
		[accountIds, folder, search, scope, refreshStatus, api],
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
		setMessages(cache.current.get(scope) || []);
		setCursors({});
		setSyncing([]);
		setErrors({});
		setLoading(true);
		const current = generation.current;
		void refreshRef.current(false).then(() => {
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
		refreshRef,
	};
}
