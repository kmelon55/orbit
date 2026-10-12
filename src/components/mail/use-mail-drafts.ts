import { useCallback, useEffect, useRef, useState } from "react";
import type { mailApi } from "#/lib/mail/client";
import type { DraftSummary } from "#/lib/mail/drafts";
import { mailSessionFor } from "#/lib/mail/session-cache";

export function useMailDrafts(api: typeof mailApi) {
	const session = mailSessionFor(api);
	const [drafts, setDrafts] = useState(session.drafts ?? []);
	const [loading, setLoading] = useState(!session.drafts);
	const [error, setError] = useState("");
	const generation = useRef(0);
	const refresh = useCallback(async () => {
		const current = ++generation.current;
		try {
			const next = await api<DraftSummary[]>("drafts");
			if (current !== generation.current) return;
			session.drafts = next;
			setDrafts(next);
			setError("");
		} catch (e) {
			if (current === generation.current)
				setError(
					e instanceof Error ? e.message : "초안을 불러오지 못했습니다.",
				);
		} finally {
			if (current === generation.current) setLoading(false);
		}
	}, [api, session]);
	const changed = useCallback(
		(draft: DraftSummary | null, id: string) => {
			generation.current++;
			const next = (session.drafts ?? []).filter((d) => d.id !== id);
			if (draft) next.push(draft);
			next.sort((a, b) => b.updatedAt - a.updatedAt);
			session.drafts = next;
			setDrafts(next);
			setLoading(false);
		},
		[session],
	);
	useEffect(() => {
		void refresh();
		const visible = () => {
			if (document.visibilityState === "visible") void refresh();
		};
		document.addEventListener("visibilitychange", visible);
		window.addEventListener("focus", visible);
		return () => {
			generation.current++;
			document.removeEventListener("visibilitychange", visible);
			window.removeEventListener("focus", visible);
		};
	}, [refresh]);
	return { drafts, loading, error, refresh, changed };
}
