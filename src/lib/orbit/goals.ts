import type { z } from "zod";
import type { Goal, goalInputSchema } from "./assistant-schema";
import { formatDayKey } from "./para";

export type GoalInput = z.input<typeof goalInputSchema>;

export function goalInput(goal: Goal): GoalInput {
	const {
		revision,
		createdAt: _created,
		updatedAt: _updated,
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
	return goal.metric
		? Math.min(
				100,
				Math.max(0, (goal.metric.current / goal.metric.target) * 100),
			)
		: null;
}
