import { createHash } from "node:crypto";
import { detailMessage } from "../mail/service.server";
import { mailDirectory, mailStore } from "../mail/store.server";
import { gatewayApiKey } from "./ai.server";
import {
	CLASSIFICATION_MODEL,
	type Classification,
	type ClassificationSource,
	classificationFolders,
	classificationItemRevision,
	classificationQuestions,
	inboxClassificationItem,
	parseClassification,
} from "./classification";
import { mailBodyText } from "./mail-ai-context";
import type { OrbitSnapshot } from "./schema";
import { getOrbitSnapshot } from "./store";

const VERSION = 2;
const CACHE_AGE = 7 * 24 * 60 * 60_000;
type CacheEntry = { fingerprint: string; result: Classification };
const pending = new Map<string, Promise<Classification>>();
const hash = (value: unknown) =>
	createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function contextFor(
	source: ClassificationSource,
	fetchBody: boolean,
	snapshot?: OrbitSnapshot,
) {
	snapshot ??= await getOrbitSnapshot();
	let content: string;
	let title: string;
	let previewOnly = false;
	let metadata: unknown;
	let sourceRevision: string | undefined;
	if (source.kind === "item") {
		const item = inboxClassificationItem(snapshot, source.id);
		title = item.title;
		content = item.body;
		metadata = { tags: item.tags, url: item.url };
		sourceRevision = classificationItemRevision(item);
	} else {
		const store = mailStore();
		const message = store.message(source.id);
		let body = store.body(source.id)?.hidden;
		if (!body && fetchBody)
			body = await detailMessage(source.id, false, true).catch(() => undefined);
		title = message.subject;
		content = body ? mailBodyText(body) : message.snippet;
		previewOnly = !body;
		metadata = {
			from: message.from,
			to: message.to,
			date: message.date,
			attachments: body?.attachments.map((a) => a.name).slice(0, 20),
		};
	}
	const { folders, limited } = classificationFolders(
		snapshot,
		`${title} ${content.slice(0, 12000)}`,
	);
	const state = {
		source: {
			kind: source.kind,
			title,
			content: content.slice(0, 12000),
			metadata,
			previewOnly,
			truncated: content.length > 12000,
		},
		folders: folders.map(({ key, space, label, examples }) => ({
			key,
			space,
			label,
			examples,
		})),
	};
	const questions = classificationQuestions(source.kind, folders);
	return {
		state,
		sourceRevision,
		questions,
		folders,
		limited,
		cacheKey: `classification:${hash([snapshot.vaultPath, source])}`,
		fingerprint: hash([
			VERSION,
			CLASSIFICATION_MODEL,
			state,
			questions,
			content,
		]),
	};
}

export async function cachedClassification(
	source: ClassificationSource,
	snapshot?: OrbitSnapshot,
): Promise<Classification | null> {
	const context = await contextFor(source, false, snapshot);
	const cached = mailStore().setting<CacheEntry>(context.cacheKey);
	return cached?.fingerprint === context.fingerprint &&
		Date.now() - cached.result.createdAt < CACHE_AGE
		? cached.result
		: null;
}

export async function classifySource(
	source: ClassificationSource,
): Promise<Classification> {
	const key = gatewayApiKey();
	if (!key) throw new Error("설정 → AI에서 Gateway API 키를 저장해 주세요.");
	const context = await contextFor(source, true);
	const store = mailStore();
	const cached = store.setting<CacheEntry>(context.cacheKey);
	if (
		cached?.fingerprint === context.fingerprint &&
		Date.now() - cached.result.createdAt < CACHE_AGE
	)
		return cached.result;
	const requestKey = hash([
		mailDirectory(),
		context.cacheKey,
		context.fingerprint,
	]);
	const running = pending.get(requestKey);
	if (running) return running;
	const operation = (async () => {
		let parsed: ReturnType<typeof parseClassification> = {
			folders: [],
			folderStatus: "no-folders",
		};
		if (Object.keys(context.questions).length) {
			let response: Response;
			try {
				response = await fetch("https://ai-gateway.vercel.sh/v1/evaluate", {
					method: "POST",
					headers: {
						Authorization: `Bearer ${key}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						model: CLASSIFICATION_MODEL,
						state: context.state,
						questions: context.questions,
					}),
					signal: AbortSignal.timeout(25_000),
				});
			} catch {
				throw new Error(
					"분류 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
				);
			}
			if (!response.ok) {
				if (response.status === 401 || response.status === 403)
					throw new Error("Gateway API 키와 모델 접근 권한을 확인해 주세요.");
				if (response.status === 402)
					throw new Error("AI Gateway 잔액이나 사용 한도를 확인해 주세요.");
				if (response.status === 429)
					throw new Error("분류 요청이 많아요. 잠시 후 다시 시도해 주세요.");
				throw new Error("분류하지 못했어요. 잠시 후 다시 시도해 주세요.");
			}
			try {
				parsed = parseClassification(
					await response.json(),
					source.kind,
					context.folders,
				);
			} catch {
				throw new Error("분류 결과를 확인하지 못했어요. 다시 시도해 주세요.");
			}
		}
		const result: Classification = {
			...parsed,
			model: CLASSIFICATION_MODEL,
			createdAt: Date.now(),
			sourceRevision: context.sourceRevision,
			previewOnly: context.state.source.previewOnly,
			truncated: context.state.source.truncated,
			candidatesLimited: context.limited,
		};
		store.setSetting(context.cacheKey, {
			fingerprint: context.fingerprint,
			result,
		});
		return result;
	})();
	pending.set(requestKey, operation);
	try {
		return await operation;
	} finally {
		if (pending.get(requestKey) === operation) pending.delete(requestKey);
	}
}
