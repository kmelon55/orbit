import { randomUUID } from "node:crypto";
import type { z } from "zod";
import {
	type AssistantAudit,
	type AssistantInboxItem,
	type AssistantMutation,
	type AssistantState,
	assistantMutationSchema,
	type Briefing,
	briefingInputSchema,
	contextInputSchema,
	decisionSchema,
	type Goal,
	goalInputSchema,
	inboxInputSchema,
	type ProposalAction,
	type Recommendation,
	recommendationInputSchema,
} from "./assistant-schema";
import { databaseFor, sha256, withDatabase } from "./database";
import { recordGoalMeasurement } from "./goal-metrics";
import { goalTasks } from "./goal-portfolio";
import { goalInput } from "./goals";
import { DEFAULT_SCHEDULE_CATEGORIES } from "./schedule-categories";
import { agentScheduleIssue, inferScheduleCategory } from "./schedule-intent";
import type { OrbitItem } from "./schema";
import {
	archiveOrbitItem,
	createOrbitItem,
	fileOrbitItem,
	getOrbitSnapshot,
} from "./store";

const PREFIX = "assistant.v1/";
type Records = {
	goal: Goal;
	briefing: Briefing;
	inbox: AssistantInboxItem;
	recommendation: Recommendation;
	audit: AssistantAudit;
};
type Kind = keyof Records;
export class AssistantError extends Error {
	constructor(
		readonly code: string,
		message: string,
	) {
		super(message);
	}
}
function fail(code: string, message: string): never {
	throw new AssistantError(code, message);
}
function read<K extends Kind>(kind: K, id: string): Records[K] | null {
	return databaseFor().metadata(`${PREFIX}${kind}/${id}`);
}
function write<K extends Kind>(kind: K, value: Records[K]) {
	databaseFor().setMetadata(`${PREFIX}${kind}/${value.id}`, value);
	return value;
}
function list<K extends Kind>(kind: K): Records[K][] {
	const rows = databaseFor()
		.sql.prepare("SELECT value FROM metadata WHERE key GLOB ? ORDER BY key")
		.all(`${PREFIX}${kind}/*`) as { value: string }[];
	return rows.map((r) => JSON.parse(r.value) as Records[K]);
}
function audit(
	actor: AssistantAudit["actor"],
	action: string,
	ids: string[],
	outcome: AssistantAudit["outcome"] = "success",
	code?: string,
) {
	write("audit", {
		id: randomUUID(),
		at: new Date().toISOString(),
		actor,
		action,
		ids,
		outcome,
		...(code ? { code } : {}),
	});
}
function same(a: unknown, b: unknown) {
	return JSON.stringify(a) === JSON.stringify(b);
}
function itemFingerprint(id: string) {
	const doc = databaseFor().byId(id);
	if (!doc?.item) return fail("item_missing", "대상 항목을 찾을 수 없습니다.");
	return sha256(`${doc.path}\0${doc.raw}`);
}
function item(id: string) {
	const value = databaseFor().byId(id)?.item;
	if (!value) return fail("item_missing", "대상 항목을 찾을 수 없습니다.");
	return value;
}
function state(): AssistantState {
	return {
		goals: list("goal"),
		briefings: list("briefing").sort((a, b) =>
			b.periodStart.localeCompare(a.periodStart),
		),
		inbox: list("inbox")
			.map((record) => {
				const linked = record.itemId
					? databaseFor().byId(record.itemId)?.item
					: undefined;
				return linked?.space === "archive"
					? { ...record, status: "archived" as const }
					: linked &&
							(linked.space !== "inbox" ||
								!["note", "link"].includes(linked.type))
						? { ...record, status: "applied" as const }
						: record;
			})
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
		recommendations: list("recommendation").sort((a, b) =>
			b.createdAt.localeCompare(a.createdAt),
		),
		audit: list("audit")
			.sort((a, b) => b.at.localeCompare(a.at))
			.slice(0, 100),
	};
}
export function loadAssistantState() {
	return withDatabase(state);
}

async function prepareGoal(input: z.input<typeof goalInputSchema>) {
	const parsed = goalInputSchema.parse(input);
	const existing = parsed.id ? read("goal", parsed.id) : null;
	if (parsed.id && !existing) fail("goal_missing", "목표를 찾을 수 없습니다.");
	if (existing && parsed.expectedRevision !== existing.revision)
		fail("conflict", "목표가 변경되었습니다. 새로고침 후 확인해 주세요.");
	const id = existing?.id ?? randomUUID();
	let parent = parsed.parentId;
	const visited = new Set([id]);
	while (parent) {
		if (visited.has(parent)) fail("goal_cycle", "목표 관계에 순환이 있습니다.");
		visited.add(parent);
		const found = read("goal", parent);
		if (!found) fail("goal_missing", "상위 목표를 찾을 수 없습니다.");
		parent = found.parentId;
	}
	const snapshot = await getOrbitSnapshot();
	const goals = list("goal");
	// Validate the whole moved subtree, including when an existing goal is reparented.
	const subtree = [{ id, depth: visited.size }];
	for (let index = 0; index < subtree.length; index++) {
		const entry = subtree[index];
		if (entry.depth > 3)
			fail(
				"goal_depth",
				"목표는 전체 목표, 프로젝트 목표, 마일스톤의 세 단계까지만 만들 수 있습니다.",
			);
		for (const child of goals.filter((goal) => goal.parentId === entry.id))
			subtree.push({ id: child.id, depth: entry.depth + 1 });
	}
	for (const taskId of same(parsed.today, existing?.today)
		? []
		: (parsed.today?.itemIds ?? [])) {
		const task = item(taskId);
		if (
			task.type !== "task" ||
			task.space === "archive" ||
			task.status === "cancelled"
		)
			fail("goal_task", "진행 가능한 할 일을 선택해 주세요.");
	}
	for (const folder of parsed.projectFolders)
		if (
			!snapshot.folders.project.some((f) => f.slug === folder) &&
			!existing?.projectFolders.includes(folder)
		)
			fail("project_missing", "프로젝트를 찾을 수 없습니다.");
	for (const id of parsed.itemIds)
		if (!existing?.itemIds.includes(id)) item(id);
	return { parsed, existing, id, goals };
}
async function saveGoal(input: z.input<typeof goalInputSchema>) {
	const { parsed, existing, id, goals } = await prepareGoal(input);
	const now = new Date().toISOString();
	if (parsed.focused && parsed.status === "active") {
		for (const other of goals) {
			if (
				other.id !== id &&
				other.parentId === parsed.parentId &&
				other.focused
			) {
				write("goal", {
					...other,
					focused: false,
					revision: other.revision + 1,
					updatedAt: now,
				});
			}
		}
	}
	const { expectedRevision: _, ...values } = parsed;
	return write("goal", {
		...values,
		metricHistory: recordGoalMeasurement(existing, parsed.metric, now),
		focused: parsed.status === "active" && Boolean(parsed.focused),
		id,
		revision: (existing?.revision ?? 0) + 1,
		createdAt: existing?.createdAt ?? now,
		updatedAt: now,
	});
}
export function briefingKey(
	input: Pick<Briefing, "kind" | "periodStart" | "timezone">,
) {
	return sha256(`${input.kind}\0${input.timezone}\0${input.periodStart}`);
}
async function saveBriefing(input: z.input<typeof briefingInputSchema>) {
	const parsed = briefingInputSchema.parse(input);
	const weekday = new Date(`${parsed.periodStart}T00:00:00Z`).getUTCDay();
	if (
		(parsed.kind === "weekly" && weekday !== 1) ||
		(parsed.kind === "monthly" && !parsed.periodStart.endsWith("-01"))
	)
		fail("period", "주간은 월요일, 월간은 1일을 기간 시작일로 지정해 주세요.");
	const id = briefingKey(parsed),
		existing = read("briefing", id);
	if (existing) {
		const { id: _, createdAt: __, itemId: ___, ...saved } = existing;
		if (!same(saved, parsed))
			fail("briefing_exists", "이 기간의 브리핑이 이미 저장되어 있습니다.");
		return existing;
	}
	const headings: Record<keyof Briefing["sections"], string> = {
		importantGoals: "현재 가장 중요한 목표",
		progress: "목표 달성 진행 상황",
		priorities: "오늘 가장 중요한 업무",
		rationale: "우선순위 선정 이유",
		overdue: "미뤄지고 있는 중요한 작업",
		intelligence: "사업적으로 유용한 정보",
		risksAndOpportunities: "위험 요소 및 새로운 기회",
		schedule: "오늘의 추천 일정",
	};
	const note = await createOrbitItem({
		title: parsed.title,
		type: "note",
		space: "inbox",
		body: [
			`${parsed.periodStart} · ${parsed.timezone} · ${parsed.origin}`,
			...Object.entries(headings).map(
				([key, heading]) =>
					`## ${heading}\n\n${parsed.sections[key as keyof Briefing["sections"]]}`,
			),
			...parsed.sources.map(
				(source) =>
					`출처: ${source.name} · ${source.url ?? ""}\n확인: ${source.observedAt}`,
			),
		].join("\n\n"),
	});
	if (!note) fail("capture_failed", "브리핑 메모를 저장하지 못했습니다.");
	return write("briefing", {
		...parsed,
		id,
		itemId: note.id,
		createdAt: new Date().toISOString(),
	});
}
export function inboxIdentity(input: z.infer<typeof inboxInputSchema>) {
	if (input.source.externalId)
		return sha256(`${input.source.name}\0${input.source.externalId}`);
	let url = input.source.url ?? "";
	if (url) {
		const parsed = new URL(url);
		parsed.hash = "";
		for (const key of [...parsed.searchParams.keys()])
			if (/^(utm_|fbclid$|gclid$)/i.test(key)) parsed.searchParams.delete(key);
		parsed.searchParams.sort();
		url = parsed.href;
	}
	// Same source URL may contain multiple real findings. Keep content in the key.
	return sha256(
		`${url || input.source.name}\0${input.title}\0${input.body}`
			.normalize("NFC")
			.replace(/\s+/g, " ")
			.trim()
			.toLocaleLowerCase(),
	);
}
async function saveInbox(input: z.input<typeof inboxInputSchema>) {
	const parsed = inboxInputSchema.parse(input),
		identity = inboxIdentity(parsed);
	const existing = list("inbox").find(
		(record) => inboxIdentity(record) === identity,
	);
	if (existing) return existing;
	const note = await createOrbitItem({
		title: parsed.title,
		body: `${parsed.body}\n\n---\n\n${parsed.reason}\n\n출처: ${parsed.source.name} · ${parsed.source.url ?? ""}\n발견: ${parsed.source.observedAt}`,
		type: "note",
		space: "inbox",
	});
	if (!note) fail("capture_failed", "발견 정보를 저장하지 못했습니다.");
	const now = new Date().toISOString();
	return write("inbox", {
		itemId: note.id,
		...parsed,
		id: randomUUID(),
		status: "unread",
		revision: 1,
		createdAt: now,
		updatedAt: now,
	});
}
type GoalAction = Extract<
	ProposalAction,
	{ kind: "create-goal" | "update-goal" }
>;
function goalActionInput(action: GoalAction) {
	if (action.kind === "create-goal") return action.input;
	const current = read("goal", action.goalId);
	if (!current) fail("goal_missing", "목표를 찾을 수 없습니다.");
	return goalInputSchema.parse({
		...goalInput(current),
		...Object.fromEntries(
			Object.entries(action.patch)
				.filter(([, value]) => value !== undefined)
				.map(([key, value]) => [key, value === null ? undefined : value]),
		),
		expectedRevision: action.expectedRevision,
	});
}
async function validateAction(action: ProposalAction) {
	if (action.kind === "create-goal" || action.kind === "update-goal") {
		await prepareGoal(goalActionInput(action));
		return;
	}
	const current = action.kind === "update" ? item(action.itemId) : undefined;
	if (current && !["note", "task", "event"].includes(current.type))
		fail("unsupported", "이 항목 유형은 수정할 수 없습니다.");
	const next =
		action.kind === "create"
			? action
			: { ...item(action.itemId), ...action.patch };
	if (next.category) {
		const snapshot = await getOrbitSnapshot();
		if (
			!(snapshot.scheduleCategories ?? DEFAULT_SCHEDULE_CATEGORIES).some(
				(category) => category.id === next.category,
			)
		)
			fail(
				"category_missing",
				"기존 카테고리 ID를 사용해 주세요. 업무는 business, 개인 용무는 personal입니다.",
			);
	}
	// Validate intent when creating or changing a schedule/type, without blocking
	// a category-only repair of a legacy all-day record.
	if (
		action.kind === "create" ||
		(action.kind === "update" &&
			["type", "start", "end", "allDay"].some((key) => key in action.patch))
	) {
		const issue = agentScheduleIssue(next);
		if (issue) fail("schedule_intent", issue);
	}
	if (action.kind === "update" && action.patch.type && current?.type === "note")
		fail(
			"unsupported",
			"유형 변경은 기존 할 일과 일정에만 사용할 수 있습니다.",
		);
	if (next.type === "event" && !next.start)
		fail("schedule", "일정 시작일이 필요합니다.");
	if (next.end && (!next.start || next.end < next.start))
		fail("schedule", "종료일은 시작일 이후여야 합니다.");
	if (
		next.start &&
		next.end &&
		next.start.includes("T") !== next.end.includes("T")
	)
		fail("schedule", "시작과 종료의 시간 형식을 맞춰 주세요.");
	if (action.kind === "update" && action.patch.status && next.type !== "task")
		fail("status", "할 일만 완료 상태를 변경할 수 있습니다.");
	if (action.kind === "create" && action.projectFolder) {
		const snapshot = await getOrbitSnapshot();
		if (!snapshot.folders.project.some((f) => f.slug === action.projectFolder))
			fail("project_missing", "프로젝트를 찾을 수 없습니다.");
	}
}
async function propose(input: z.input<typeof recommendationInputSchema>) {
	const parsed = recommendationInputSchema.parse(input);
	const existing = list("recommendation").find(
		(r) => r.requestKey === parsed.requestKey,
	);
	if (existing) {
		const original = recommendationInputSchema.parse({
			requestKey: existing.requestKey,
			title: existing.title,
			reason: existing.reason,
			goalId: existing.goalId,
			action: existing.action,
		});
		if (!same(original, parsed))
			fail("request_conflict", "동일 요청 키에 다른 추천이 있습니다.");
		return existing;
	}
	if (parsed.goalId && !read("goal", parsed.goalId))
		fail("goal_missing", "목표를 찾을 수 없습니다.");
	if (
		parsed.goalId &&
		(parsed.action.kind === "create-goal" ||
			parsed.action.kind === "update-goal")
	)
		fail(
			"goal_link",
			"목표 추천은 action 안의 parentId 또는 goalId를 사용해 주세요.",
		);
	await validateAction(parsed.action);
	const now = new Date().toISOString();
	return write("recommendation", {
		...parsed,
		id: randomUUID(),
		revision: 1,
		state: "pending",
		createdAt: now,
		updatedAt: now,
		...(parsed.action.kind === "update"
			? { fingerprint: itemFingerprint(parsed.action.itemId) }
			: {}),
	});
}
async function decide(input: z.input<typeof decisionSchema>) {
	const parsed = decisionSchema.parse(input);
	const results: Recommendation[] = [];
	for (const selection of parsed.selections) {
		const rec = read("recommendation", selection.id);
		if (!rec) fail("recommendation_missing", "추천을 찾을 수 없습니다.");
		const action = selection.action ?? rec.action;
		if (rec.state === "applied") {
			if (
				parsed.decision === "apply" &&
				(!selection.action || same(action, rec.appliedAction))
			) {
				results.push(rec);
				continue;
			}
			fail("already_applied", "이미 적용된 추천입니다.");
		}
		if (rec.state === "rejected")
			fail("rejected", "거절한 추천은 적용할 수 없습니다.");
		if (rec.revision !== selection.revision)
			fail("conflict", "추천이 변경되었습니다. 새로고침 후 확인해 주세요.");
		if (
			action.kind !== rec.action.kind ||
			(action.kind === "update" &&
				rec.action.kind === "update" &&
				action.itemId !== rec.action.itemId) ||
			(action.kind === "update-goal" &&
				rec.action.kind === "update-goal" &&
				(action.goalId !== rec.action.goalId ||
					action.expectedRevision !== rec.action.expectedRevision))
		)
			fail("target_changed", "수정 대상을 바꾸려면 새 추천을 만들어 주세요.");
		const now = new Date().toISOString();
		if (parsed.decision !== "apply") {
			results.push(
				write("recommendation", {
					...rec,
					state: parsed.decision === "defer" ? "deferred" : "rejected",
					deferUntil:
						parsed.decision === "defer" ? parsed.deferUntil : undefined,
					revision: rec.revision + 1,
					updatedAt: now,
				}),
			);
			continue;
		}
		await validateAction(action);
		if (
			action.kind === "update" &&
			itemFingerprint(action.itemId) !== rec.fingerprint
		)
			fail(
				"item_conflict",
				"추천 이후 원본이 변경되었습니다. 새 추천을 만들어 주세요.",
			);
		const result =
			action.kind === "create-goal" || action.kind === "update-goal"
				? await saveGoal(goalActionInput(action))
				: action.kind === "create"
					? await createOrbitItem({
							title: action.title,
							body: action.body,
							type: action.type,
							category:
								action.category === null ? null : inferScheduleCategory(action),
							due: action.due,
							start: action.start,
							end: action.end,
							space:
								action.type === "event"
									? "event"
									: action.projectFolder
										? "project"
										: "inbox",
							folder:
								action.type !== "event" ? action.projectFolder : undefined,
						})
					: await fileOrbitItem(action.itemId, {
							...action.patch,
							project: item(action.itemId).project ?? null,
							space:
								action.patch.type === "task" &&
								item(action.itemId).space === "event"
									? "inbox"
									: item(action.itemId).space,
							folder: item(action.itemId).folder,
						});
		if (!result) fail("apply_failed", "변경 결과를 확인할 수 없습니다.");
		const goalResult =
			action.kind === "create-goal" || action.kind === "update-goal";
		if (rec.goalId && !goalResult) {
			const goal = read("goal", rec.goalId);
			if (!goal) fail("goal_missing", "목표를 찾을 수 없습니다.");
			if (!goal.itemIds.includes(result.id))
				write("goal", {
					...goal,
					itemIds: [...goal.itemIds, result.id],
					revision: goal.revision + 1,
					updatedAt: now,
				});
		}
		results.push(
			write("recommendation", {
				...rec,
				state: "applied",
				appliedAction: action,
				...(goalResult
					? { resultGoalId: result.id }
					: { resultItemId: result.id }),
				revision: rec.revision + 1,
				updatedAt: now,
				deferUntil: undefined,
			}),
		);
	}
	return results;
}

export function dayInZone(date: Date, timezone: string) {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: timezone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(date);
}
function scheduleDay(value: string | undefined, timezone: string) {
	if (!value) return undefined;
	return /(?:Z|[+-]\d{2}:\d{2})$/.test(value)
		? dayInZone(new Date(value), timezone)
		: value.slice(0, 10);
}
function addDays(day: string, days: number) {
	const d = new Date(`${day}T12:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}
export function assistantContext(
	input: z.input<typeof contextInputSchema>,
	canRead: (item: OrbitItem) => boolean = () => true,
) {
	return withDatabase(async () => {
		const { date, timezone } = contextInputSchema.parse(input);
		const rawSnapshot = await getOrbitSnapshot();
		const snapshot = {
				...rawSnapshot,
				items: rawSnapshot.items.filter(canRead),
			},
			saved = state();
		const active = snapshot.items.filter(
			(i) => i.space !== "archive" && i.status !== "cancelled",
		);
		const weekday = new Date(`${date}T12:00:00Z`).getUTCDay(),
			weekStart = addDays(date, -((weekday + 6) % 7)),
			weekEnd = addDays(weekStart, 6);
		const overlaps = (i: OrbitItem, from: string, to: string) => {
			const start = scheduleDay(i.start ?? i.due, timezone),
				end = scheduleDay(i.end, timezone) ?? start;
			return Boolean(start && end && start <= to && end >= from);
		};
		const goals = saved.goals.map((goal) => {
			const linked = goalTasks(goal, saved.goals, snapshot.items);
			return {
				...goal,
				progress: {
					completed: linked.filter((i) => i.status === "done").length,
					total: linked.length,
				},
				linkedTaskIds: linked.map((i) => i.id),
			};
		});
		const incomplete = active.filter(
			(i) => i.type === "task" && i.status !== "done",
		);
		const ranked = incomplete
			.map((task) => {
				const linked = goals.filter(
					(g) => g.status === "active" && g.linkedTaskIds.includes(task.id),
				);
				const due = scheduleDay(task.due ?? task.start, timezone);
				const score =
					(linked.length
						? Math.max(...linked.map((g) => g.importance)) * 100
						: 0) + (due && due < date ? 20 : due === date ? 10 : 0);
				return {
					task,
					goalIds: linked.map((g) => g.id),
					score,
					reason: linked.length
						? `목표 기여: ${linked.map((g) => g.title).join(", ")}`
						: due && due <= date
							? "기한 도래 · 목표 연결 없음"
							: "미완료 · 목표 연결 없음",
				};
			})
			.sort((a, b) => b.score - a.score || a.task.id.localeCompare(b.task.id));
		return {
			date,
			timezone,
			weekStart,
			weekEnd,
			generatedAt: new Date().toISOString(),
			goals,
			projects: snapshot.folders.project,
			scheduleCategories: snapshot.scheduleCategories,
			today: active.filter(
				(i) =>
					(i.type === "event" || i.type === "task") && overlaps(i, date, date),
			),
			week: active.filter(
				(i) =>
					(i.type === "event" || i.type === "task") &&
					overlaps(i, weekStart, weekEnd),
			),
			incomplete,
			overdue: incomplete.filter((i) => {
				const due = scheduleDay(i.due ?? i.start, timezone);
				return Boolean(due && due < date);
			}),
			priorities: ranked.slice(0, 5),
			completedThisWeek: snapshot.items.filter(
				(i) =>
					i.type === "task" &&
					i.status === "done" &&
					i.completedAt &&
					(scheduleDay(i.completedAt, timezone) ?? "") >= weekStart &&
					(scheduleDay(i.completedAt, timezone) ?? "") <= date,
			),
			notes: active.filter((i) => i.type === "note").slice(0, 30),
			noteTotal: active.filter((i) => i.type === "note").length,
			briefings: saved.briefings
				.filter((b) => b.periodStart <= date)
				.slice(0, 14),
			inbox: saved.inbox.filter((i) => i.status !== "archived").slice(0, 50),
			recommendations: saved.recommendations.filter(
				(r) => r.state === "pending" || r.state === "deferred",
			),
			sources: [
				{
					id: "orbit",
					status: "available" as const,
					observedAt: new Date().toISOString(),
				},
			],
			limitations: [
				"외부 소스는 아직 연결되지 않았습니다.",
				"과거 계획 및 반복 연기 이력은 아직 수집하지 않습니다.",
				"목표 진행률은 연결된 할 일의 완료 수이며 사업 성과 지표가 아닙니다.",
				"최근 메모 최대 30개, 브리핑 14개, Inbox 50개가 포함됩니다.",
			],
		};
	});
}
export type AssistantContext = Awaited<ReturnType<typeof assistantContext>>;
// Source adapters produce observations, not executable instructions or item mutations.
export interface AssistantSourceAdapter {
	id: string;
	read(input: {
		date: string;
		timezone: string;
		signal: AbortSignal;
	}): Promise<{
		observedAt: string;
		status: "available" | "unavailable";
		findings: z.infer<typeof inboxInputSchema>[];
	}>;
}
export function mutateAssistant(
	input: AssistantMutation,
	actor: AssistantAudit["actor"] = "owner",
) {
	return mutate(input, actor, false);
}
// Only callers that already verified the OAuth principal may pass these scopes.
// Host confirmation is a client responsibility; no model-supplied approval flag.
export function mutateAssistantWithScopes(
	input: AssistantMutation,
	scopes: readonly string[],
) {
	const needed = input.action === "decide" ? "orbit.apply" : "orbit.write";
	if (!scopes.includes("orbit.read") || !scopes.includes(needed))
		fail("forbidden", "연결 권한이 없습니다.");
	return mutate(input, "mcp", input.action === "decide");
}
async function mutate(
	input: AssistantMutation,
	actor: AssistantAudit["actor"],
	canDecide: boolean,
) {
	const mutation = assistantMutationSchema.parse(input);
	// Unscoped MCP callers cannot apply proposals or alter owner-only records.
	if (
		actor !== "owner" &&
		!["briefing", "inbox", "recommend", "create"].includes(mutation.action) &&
		!(canDecide && mutation.action === "decide")
	)
		fail("forbidden", "이 작업에는 검증된 사용자 승인 경로가 필요합니다.");
	try {
		return await withDatabase(async () => {
			const createdIds: string[] = [];
			switch (mutation.action) {
				case "create": {
					const { requestKey, goalId, ...fields } = mutation.input;
					const record = await propose({
						requestKey,
						goalId,
						title: fields.title,
						reason: "사용자가 요청한 새 항목 저장",
						action: { kind: "create", ...fields },
					});
					createdIds.push(record.id);
					await decide({
						decision: "apply",
						selections: [{ id: record.id, revision: record.revision }],
					});
					break;
				}
				case "goal":
					await saveGoal(mutation.input);
					break;
				case "delete-goal": {
					const goal = read("goal", mutation.id);
					if (!goal || goal.revision !== mutation.revision)
						fail(
							"conflict",
							"목표가 변경되었습니다. 새로고침 후 확인해 주세요.",
						);
					const ids = new Set([goal.id]);
					const goals = list("goal");
					for (let i = 0; i < goals.length; i++)
						for (const child of goals)
							if (child.parentId && ids.has(child.parentId)) ids.add(child.id);
					for (const id of ids)
						databaseFor()
							.sql.prepare("DELETE FROM metadata WHERE key = ?")
							.run(`${PREFIX}goal/${id}`);
					break;
				}
				case "briefing":
					await saveBriefing(mutation.input);
					break;
				case "inbox":
					await saveInbox(mutation.input);
					break;
				case "recommend":
					await propose(mutation.input);
					break;
				case "decide":
					await decide(mutation.input);
					break;
				case "inbox-status": {
					const record = read("inbox", mutation.id);
					if (!record) fail("inbox_missing", "Inbox 항목을 찾을 수 없습니다.");
					if (record.revision !== mutation.revision)
						fail("conflict", "Inbox가 변경되었습니다. 새로고침해 주세요.");
					if (mutation.status === "archived" && record.itemId) {
						const note = databaseFor().byId(record.itemId)?.item;
						if (note?.space === "inbox") await archiveOrbitItem(note.id);
					}
					write("inbox", {
						...record,
						status: mutation.status,
						revision: record.revision + 1,
						updatedAt: new Date().toISOString(),
					});
					break;
				}
			}
			audit(
				actor,
				mutation.action,
				mutation.action === "decide"
					? mutation.input.selections.map((s) => s.id)
					: "id" in mutation
						? [mutation.id]
						: createdIds,
			);
			return state();
		}, true);
	} catch (error) {
		await withDatabase(
			() =>
				audit(
					actor,
					mutation.action,
					mutation.action === "decide"
						? mutation.input.selections.map((s) => s.id)
						: [],
					"failure",
					error instanceof AssistantError ? error.code : "internal_error",
				),
			true,
		);
		throw error;
	}
}
