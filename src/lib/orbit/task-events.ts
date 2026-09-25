import { formatDayKey } from "./para";
import type { OrbitItem } from "./schema";

export function isCurrentOrUpcomingEvent(item: OrbitItem, now: Date) {
	if (item.type !== "event" || item.space === "archive") return false;
	const until = item.end || item.start;
	if (!until) return true;
	// Date-only events include their final day, as in the calendar editor.
	if (/^\d{4}-\d{2}-\d{2}$/.test(until)) {
		return until >= formatDayKey(now);
	}
	const timestamp = new Date(until).getTime();
	return Number.isNaN(timestamp) || timestamp > now.getTime();
}
