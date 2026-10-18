import type { Goal } from "./assistant-schema";
import { goalDescendants, goalWeekStart } from "./goals";
import type { OrbitFolder, OrbitItem } from "./schema";

export type GoalProjectGroup = {
	key: string;
	name: string;
	folders: string[];
	goals: Goal[];
};

export function goalProjectGroups(
	goals: Goal[],
	folders: OrbitFolder[],
): GoalProjectGroup[] {
	const groups = new Map<string, GoalProjectGroup>();
	const rootFolders = folders.filter((folder) => !folder.parent);
	for (const folder of rootFolders) {
		const key = `project:${folder.name}`;
		const group = groups.get(key) ?? {
			key,
			name: folder.name,
			folders: [],
			goals: [],
		};
		group.folders.push(folder.slug);
		groups.set(key, group);
	}
	for (const goal of goals.filter((goal) => !goal.parentId && !goal.roadmap)) {
		const names = [
			...new Set(
				[goal, ...goalDescendants(goal, goals)].flatMap((item) =>
					goalProjectNames(item, [...groups.values()]),
				),
			),
		];
		for (const name of names.length ? names : [""]) {
			const key = name ? `project:${name}` : "unassigned";
			const group = groups.get(key) ?? { key, name, folders: [], goals: [] };
			group.goals.push(goal);
			groups.set(key, group);
		}
	}
	return [...groups.values()].sort(
		(a, b) =>
			Number(a.key === "unassigned") - Number(b.key === "unassigned") ||
			a.name.localeCompare(b.name),
	);
}

function goalProjectNames(goal: Goal, groups: GoalProjectGroup[]) {
	const name = goal.projectName ?? goal.brand;
	if (name) return [name];
	return groups
		.filter((group) =>
			group.folders.some((folder) =>
				goal.projectFolders.some(
					(slug) => slug === folder || slug.startsWith(`${folder}/`),
				),
			),
		)
		.map((group) => group.name);
}

export type GoalContribution = {
	key: string;
	projects: GoalProjectGroup[];
	goals: Goal[];
};

// Folder links also belong to legacy milestones for task rollups. They alone
// must not turn a dated execution step into another project outcome.
export function isGoalProjectOutcome(goal: Goal, goals: Goal[]) {
	return Boolean(
		goal.projectName ||
			goal.brand ||
			goals.some((step) => step.parentId === goal.id) ||
			(goal.horizon !== "milestone" && goal.projectFolders.length),
	);
}

// A shared result has one lane even when several projects contribute to it.
export function goalContributions(
	goal: Goal,
	goals: Goal[],
	groups: GoalProjectGroup[],
): GoalContribution[] {
	const lanes = new Map<string, GoalContribution>();
	const ownNames = goalProjectNames(goal, groups);
	function lane(names: string[]) {
		const sorted = [...new Set(names)].sort();
		const key = JSON.stringify(sorted);
		let entry = lanes.get(key);
		if (!entry) {
			entry = {
				key,
				projects: sorted.map(
					(name) =>
						groups.find((group) => group.name === name) ?? {
							key: `project:${name}`,
							name,
							folders: [],
							goals: [],
						},
				),
				goals: [],
			};
			lanes.set(key, entry);
		}
		return entry;
	}
	for (const child of goalMilestones(goal, goals)) {
		const names = isGoalProjectOutcome(child, goals)
			? goalProjectNames(child, groups)
			: [];
		lane(names).goals.push(child);
	}
	for (const name of ownNames) {
		if (
			![...lanes.values()].some((entry) =>
				entry.projects.some((project) => project.name === name),
			)
		)
			lane([name]);
	}
	if (!lanes.size) lane([]);
	return [...lanes.values()].sort(
		(a, b) =>
			Number(!a.projects.length) - Number(!b.projects.length) ||
			a.key.localeCompare(b.key),
	);
}

export function goalMapRoots(groups: GoalProjectGroup[]) {
	return [
		...new Map(
			groups.flatMap((group) => group.goals).map((goal) => [goal.id, goal]),
		).values(),
	];
}

export function goalMilestones(goal: Goal, goals: Goal[]) {
	return goals
		.filter((item) => item.parentId === goal.id)
		.sort(
			(a, b) =>
				Number(a.status === "done") - Number(b.status === "done") ||
				(a.targetDate ?? "9999").localeCompare(b.targetDate ?? "9999") ||
				a.createdAt.localeCompare(b.createdAt),
		);
}

export function goalMapProgress(goal: Goal, goals: Goal[]) {
	const steps = goalMilestones(goal, goals);
	const completed = steps.filter((step) => step.status === "done").length;
	const next =
		goal.status === "active"
			? (steps.find((step) => step.status === "active" && step.focused) ??
				steps.find((step) => step.status === "active"))
			: undefined;
	return {
		completed,
		total: steps.length,
		percent:
			goal.status === "done"
				? 100
				: steps.length
					? Math.round((completed / steps.length) * 100)
					: 0,
		nextMilestoneId: next?.id ?? null,
	};
}

export function goalAttention(goal: Goal, goals: Goal[], day: string) {
	if (goal.status !== "active") return [];
	const steps = goalMilestones(goal, goals);
	const issues: string[] = [];
	if (goal.targetDate && goal.targetDate < day) issues.push("목표 기한 지남");
	if (
		goalDescendants(goal, goals).some(
			(step) =>
				step.status === "active" && step.targetDate && step.targetDate < day,
		)
	)
		issues.push("실행 단계 기한 지남");
	if (!goal.targetDate) issues.push("기한 미정");
	if (!goal.metric && !goal.successCriteria?.trim())
		issues.push("달성 기준 없음");
	if (!steps.some((step) => step.status === "active"))
		issues.push("다음 단계 없음");
	if (goal.week?.start !== goalWeekStart(day) || !goal.week.outcome.trim())
		issues.push("이번 주 계획 없음");
	return issues;
}

export function goalTasks(goal: Goal, goals: Goal[], items: OrbitItem[]) {
	const family = [goal, ...goalDescendants(goal, goals)];
	const ids = new Set(family.flatMap((item) => item.itemIds));
	const folders = new Set(family.flatMap((item) => item.projectFolders));
	return items
		.filter(
			(item) =>
				item.type === "task" &&
				item.space !== "archive" &&
				item.status !== "cancelled" &&
				(ids.has(item.id) ||
					[...folders].some(
						(folder) =>
							item.project === folder ||
							(item.space === "project" &&
								(item.folder === folder ||
									item.folder?.startsWith(`${folder}/`))),
					)),
		)
		.sort(
			(a, b) =>
				Number(a.status === "done") - Number(b.status === "done") ||
				(a.due ?? "9999").localeCompare(b.due ?? "9999"),
		);
}
