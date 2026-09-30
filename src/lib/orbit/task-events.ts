import { formatDayKey } from "./para";
import type { OrbitItem } from "./schema";

export function isCurrentEvent(item: OrbitItem, now: Date) {
	if (
		item.type !== "event" ||
		item.space === "archive" ||
		item.status === "done" ||
		item.status === "cancelled" ||
		!item.start
	)
		return false;
	const today = formatDayKey(now);
	const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
	const start = dateOnly.test(item.start)
		? new Date(`${item.start}T00:00:00`).getTime()
		: new Date(item.start).getTime();
	if (!Number.isFinite(start) || start > now.getTime()) return false;
	const until = item.end || item.start;
	// All-day events include their final day, matching the calendar editor.
	if (dateOnly.test(until)) return until >= today;
	const end = new Date(until).getTime();
	return Number.isFinite(end) && end > now.getTime();
}
