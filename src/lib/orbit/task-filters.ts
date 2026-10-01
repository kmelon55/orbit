import { formatDayKey } from "./para";
import type { OrbitItem } from "./schema";

export type TaskCompletionFilter = "open" | "today" | "done";

export function completedOnDay(item: OrbitItem, day: string) {
	if (item.type !== "task" || item.status !== "done") return false;
	// Older tasks predate completion timestamps; use their last saved date.
	const date = new Date(item.completedAt ?? item.updated);
	return Number.isFinite(date.getTime()) && formatDayKey(date) === day;
}

export function taskListDay(item: OrbitItem, today: string) {
	if (item.type === "task") {
		return completedOnDay(item, today) ? today : item.due?.slice(0, 10);
	}
	const start = item.start?.slice(0, 10);
	const end = item.end?.slice(0, 10) ?? start;
	return start && end && start <= today && end >= today ? today : start;
}

export function isVisibleTaskEvent(item: OrbitItem, today: string) {
	return (
		item.type === "event" &&
		item.space !== "archive" &&
		item.status !== "cancelled" &&
		item.status !== "done" &&
		Boolean(item.start) &&
		(item.end ?? item.start ?? "").slice(0, 10) >= today
	);
}
