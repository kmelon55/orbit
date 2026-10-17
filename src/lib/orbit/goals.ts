import type { z } from "zod";
import type { Goal, goalInputSchema } from "./assistant-schema";
import { formatDayKey } from "./para";

export type GoalInput = z.input<typeof goalInputSchema>;

export function goalDepth(goal: Goal, goals: Goal[]) {
	const byId = new Map(goals.map((item) => [item.id, item]));
	const visited = new Set([goal.id]);
	let current = goal;
	while (current.parentId) {
		const parent = byId.get(current.parentId);
		if (!parent || visited.has(parent.id)) return Infinity;
		visited.add(parent.id);
		current = parent;
	}
	return visited.size;
}

export function goalRoot(goal: Goal, goals: Goal[]) {
	const byId = new Map(goals.map((item) => [item.id, item]));
	const visited = new Set<string>();
	let current: Goal | undefined = goal;
	while (current?.parentId) {
		if (visited.has(current.id)) return undefined;
		visited.add(current.id);
		current = byId.get(current.parentId);
	}
	return current;
}

export function goalDescendants(goal: Goal, goals: Goal[]) {
	const ids = new Set([goal.id]);
	const result: Goal[] = [];
	const queue = [goal];
	for (let index = 0; index < queue.length; index++) {
		for (const child of goals) {
			if (child.parentId !== queue[index].id || ids.has(child.id)) continue;
			ids.add(child.id);
			queue.push(child);
			result.push(child);
		}
	}
	return result;
}

export function goalInput(goal: Goal): GoalInput {
	const {
		revision,
		createdAt: _created,
		updatedAt: _updated,
		metricHistory: _history,
		expectedRevision: _expected,
		...input
	} = goal;
	return { ...input, expectedRevision: revision };
}

export function goalWeekStart(day: string) {
	const date = new Date(`${day}T12:00:00`);
	date.setDate(date.getDate() - date.getDay());
	return formatDayKey(date);
}

export function focusedGoal(goals: Goal[]) {
	return goals.find(
		(goal) => !goal.parentId && goal.status === "active" && goal.focused,
	);
}

export function goalPercent(goal: Goal) {
	return goal.metric && goal.metric.current !== null
		? Math.min(
				100,
				Math.max(0, (goal.metric.current / goal.metric.target) * 100),
			)
		: null;
}
