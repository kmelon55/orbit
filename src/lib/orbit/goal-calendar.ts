import type { Goal } from "./assistant-schema";
import { goalRoot } from "./goals";

export function goalCalendarDays(month: string) {
	const [year, number] = month.split("-").map(Number);
	const first = new Date(Date.UTC(year, number - 1, 1));
	const count = new Date(Date.UTC(year, number, 0)).getUTCDate();
	const cells = Math.ceil((first.getUTCDay() + count) / 7) * 7;
	return Array.from({ length: cells }, (_, index) => {
		const date = new Date(
			Date.UTC(year, number - 1, index - first.getUTCDay() + 1),
		);
		return date.toISOString().slice(0, 10);
	});
}

export function shiftGoalMonth(month: string, offset: number) {
	const [year, number] = month.split("-").map(Number);
	return new Date(Date.UTC(year, number - 1 + offset, 1))
		.toISOString()
		.slice(0, 7);
}

export function goalCalendarEntries(roots: Goal[], goals: Goal[]) {
	const unique = new Map(roots.map((goal) => [goal.id, goal]));
	return goals
		.flatMap((goal) => {
			const root = unique.get(goalRoot(goal, goals)?.id ?? "");
			return root ? [{ goal, root }] : [];
		})
		.sort(
			(a, b) =>
				(a.goal.targetDate ?? "9999").localeCompare(
					b.goal.targetDate ?? "9999",
				) || a.goal.createdAt.localeCompare(b.goal.createdAt),
		);
}
