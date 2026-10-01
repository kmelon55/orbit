import { formatDayKey } from "./para";
import type { OrbitItem } from "./schema";

export type CalendarDragTarget = {
	date: string;
	mode: "time" | "all-day" | "keep-time";
	time?: string;
};
function timeOf(value?: string) {
	return value?.match(/T(\d{2}:\d{2})/)?.[1];
}
function dateTime(date: Date) {
	return `${formatDayKey(date)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`;
}

export function resizeCalendarItem(
	item: OrbitItem,
	target: CalendarDragTarget,
): OrbitItem {
	if (item.type !== "event" || !item.start) return item;
	const startKey = item.start.slice(0, 10);
	const endKey = target.date < startKey ? startKey : target.date;
	const startTime = timeOf(item.start);

	if (!startTime || target.mode !== "time" || !target.time) {
		const currentEndTime = timeOf(item.end);
		if (currentEndTime) {
			const start = new Date(item.start);
			const candidate = new Date(`${endKey}T${currentEndTime}:00`);
			return {
				...item,
				end: dateTime(
					candidate.getTime() > start.getTime()
						? candidate
						: new Date(start.getTime() + 30 * 60_000),
				),
			};
		}
		return {
			...item,
			end: endKey,
		};
	}

	const start = new Date(item.start);
	let end = new Date(`${endKey}T${target.time}:00`);
	if (end.getTime() <= start.getTime()) {
		end = new Date(start.getTime() + 30 * 60_000);
	}
	return { ...item, end: dateTime(end) };
}

export function calendarResizeTime(
	clientY: number,
	top: number,
	hourHeight: number,
) {
	const minutes = Math.max(
		0,
		Math.min(1440, Math.round(((clientY - top) / hourHeight) * 4) * 15),
	);
	return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
