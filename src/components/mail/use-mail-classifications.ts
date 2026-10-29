import { useEffect, useState } from "react";
import { createMailClient } from "#/lib/mail/client";
import type { MailClassificationState } from "#/lib/orbit/classification";
import { classifyMailbox } from "#/lib/orbit/classification-functions";

export function useMailClassifications(
	ids: string[],
	enabled: boolean,
	demo = false,
) {
	const [cache, setCache] = useState<{
		demo: boolean;
		states: Record<string, MailClassificationState>;
	}>({ demo, states: {} });
	const key = JSON.stringify([...new Set(ids)]);
	useEffect(() => {
		if (!enabled) return;
		const currentIds = JSON.parse(key) as string[];
		if (!currentIds.length) return;
		let cancelled = false;
		let timer: ReturnType<typeof setTimeout>;
		async function refresh() {
			let pending = false;
			try {
				for (let offset = 0; offset < currentIds.length; offset += 100) {
					if (cancelled) return;
					const batch = currentIds.slice(offset, offset + 100);
					const next = demo
						? await createMailClient(true)<
								Record<string, MailClassificationState>
							>("classifications", { ids: batch })
						: await classifyMailbox({ data: batch });
					if (cancelled) return;
					pending ||= Object.values(next).some(
						(entry) => entry.status === "pending",
					);
					setCache((previous) => ({
						demo,
						states: {
							...(previous.demo === demo ? previous.states : {}),
							...next,
						},
					}));
				}
			} catch {
				if (!cancelled)
					setCache((previous) => ({
						demo,
						states: {
							...(previous.demo === demo ? previous.states : {}),
							...Object.fromEntries(
								currentIds.map((id) => [
									id,
									{
										status: "error",
										error: "메일을 분류하지 못했어요.",
									} satisfies MailClassificationState,
								]),
							),
						},
					}));
			}
			if (!cancelled && !demo)
				timer = setTimeout(() => void refresh(), pending ? 2000 : 30_000);
		}
		void refresh();
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [key, enabled, demo]);
	return enabled && cache.demo === demo ? cache.states : {};
}
