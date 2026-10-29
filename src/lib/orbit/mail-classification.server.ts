import { mailDirectory } from "../mail/store.server";
import { gatewayApiKey } from "./ai.server";
import type { MailClassificationState } from "./classification";
import { cachedClassification, classifySource } from "./classification.server";
import { getOrbitSnapshot } from "./store";

type Job = { id: string; directory: string };
type Failure = { error: string; retryAt: number };
const runtime = globalThis as typeof globalThis & {
	orbitClassificationQueue?: {
		waiting: Map<string, Job>;
		active: Set<string>;
		failures: Map<string, Failure>;
	};
};
runtime.orbitClassificationQueue ??= {
	waiting: new Map(),
	active: new Set(),
	failures: new Map(),
};
const queue = runtime.orbitClassificationQueue;

// The existing mail runtime and the visible mailbox both feed this queue.
// Persisted result caching makes a restart safe: the next sync picks up misses.
function drain() {
	while (queue.active.size < 2 && queue.waiting.size) {
		const entry = queue.waiting.entries().next().value;
		if (!entry) break;
		const [key, job] = entry;
		queue.waiting.delete(key);
		queue.active.add(key);
		void Promise.resolve()
			.then(async () => {
				if (mailDirectory() !== job.directory) return;
				await classifySource({ kind: "mail", id: job.id });
				queue.failures.delete(key);
			})
			.catch((error: unknown) => {
				queue.failures.set(key, {
					error:
						error instanceof Error
							? error.message
							: "메일을 분류하지 못했어요.",
					retryAt: Date.now() + 60_000,
				});
				const oldest = queue.failures.keys().next().value;
				if (queue.failures.size > 1000 && oldest) queue.failures.delete(oldest);
			})
			.finally(() => {
				queue.active.delete(key);
				drain();
			});
	}
}

export async function requestMailClassifications(ids: string[]) {
	const results: Record<string, MailClassificationState> = {};
	const unique = [...new Set(ids)].slice(0, 100);
	if (!unique.length) return results;
	if (!gatewayApiKey()) {
		for (const id of unique) results[id] = { status: "unconfigured" };
		return results;
	}
	const directory = mailDirectory();
	const snapshot = await getOrbitSnapshot();
	for (const id of unique) {
		try {
			const cached = await cachedClassification({ kind: "mail", id }, snapshot);
			if (cached) {
				results[id] = { status: "ready", result: cached };
				continue;
			}
			const key = JSON.stringify([directory, id]);
			const failure = queue.failures.get(key);
			if (failure && failure.retryAt > Date.now()) {
				results[id] = { status: "error", error: failure.error };
				continue;
			}
			if (!queue.active.has(key) && queue.waiting.size < 200)
				queue.waiting.set(key, { id, directory });
			results[id] = { status: "pending" };
		} catch {
			results[id] = { status: "error", error: "메일을 찾을 수 없어요." };
		}
	}
	drain();
	return results;
}
