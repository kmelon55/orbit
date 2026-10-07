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
	if (item.type !== "event" && item.type !== "task") return item;
	const value = item.start ?? item.due;
	if (!value) return item;
	// A legacy point task becomes a range when its edge is resized.
	item = item.type === "task" ? { ...item, start: value, due: value } : item;
	const startKey = value.slice(0, 10);
	const endKey = target.date < startKey ? startKey : target.date;
	const startTime = timeOf(value);

	if (!startTime || target.mode !== "time" || !target.time) {
		const currentEndTime =
			timeOf(item.end) ??
			(startTime
				? timeOf(dateTime(new Date(new Date(value).getTime() + 30 * 60_000)))
				: undefined);
		if (currentEndTime) {
			const start = new Date(value);
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

	const start = new Date(value);
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

// Move the card's top edge, preserving the point where it was grabbed.
export function calendarMoveTime(
	clientY: number,
	top: number,
	hourHeight: number,
	grabOffset = 0,
) {
	const minutes = Math.max(
		0,
		Math.min(
			1410,
			Math.round(((clientY - top - grabOffset) / hourHeight) * 4) * 15,
		),
	);
	return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
