import type { CalendarDragTarget } from "./calendar-resize";
import { formatDayKey, itemDayKey } from "./para";
import type { OrbitItem } from "./schema";

export function scheduleTime(value?: string) {
	return value?.match(/T(\d{2}:\d{2})/)?.[1];
}

function dateTime(date: Date) {
	return `${formatDayKey(date)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:00`;
}

export function spansMultipleDays(item: OrbitItem) {
	return Boolean(
		item.start && item.end && item.end.slice(0, 10) > item.start.slice(0, 10),
	);
}

export function visibleEndDayKey(item: OrbitItem) {
	const startKey = itemDayKey(item);
	const endKey = item.end?.slice(0, 10);
	if (!startKey || !endKey) return endKey;
	if (
		scheduleTime(item.start) &&
		scheduleTime(item.end) === "00:00" &&
		endKey > startKey
	) {
		const date = new Date(`${endKey}T00:00:00`);
		date.setDate(date.getDate() - 1);
		return formatDayKey(date);
	}
	return endKey;
}

export function visibleDayKeys(item: OrbitItem) {
	const startKey = itemDayKey(item);
	if (!startKey || !spansMultipleDays(item)) return startKey ? [startKey] : [];
	const endKey = visibleEndDayKey(item) ?? startKey;
	const cursor = new Date(`${startKey}T00:00:00`);
	const keys: string[] = [];
	while (formatDayKey(cursor) <= endKey && keys.length < 367) {
		keys.push(formatDayKey(cursor));
		cursor.setDate(cursor.getDate() + 1);
	}
	return keys;
}

export function moveCalendarItem(
	item: OrbitItem,
	target: CalendarDragTarget,
): OrbitItem {
	if (item.type === "task" && !item.start) {
		const nextTime =
			target.mode === "time"
				? target.time
				: target.mode === "keep-time"
					? scheduleTime(item.due)
					: undefined;
		return {
			...item,
			due: nextTime ? `${target.date}T${nextTime}:00` : target.date,
		};
	}
	if (!item.start) return item;
	let start: string;
	let end: string | undefined;
	if (
		target.mode === "all-day" ||
		(!scheduleTime(item.start) && target.mode !== "time")
	) {
		const span = item.end
			? Math.max(
					0,
					Math.round(
						(new Date(`${item.end.slice(0, 10)}T00:00:00`).getTime() -
							new Date(`${item.start.slice(0, 10)}T00:00:00`).getTime()) /
							86_400_000,
					),
				)
			: 0;
		const nextEnd = new Date(`${target.date}T00:00:00`);
		nextEnd.setDate(nextEnd.getDate() + span);
		start = target.date;
		end = item.end ? formatDayKey(nextEnd) : undefined;
	} else {
		const nextTime =
			target.mode === "time" ? target.time : scheduleTime(item.start);
		if (!nextTime) return item;
		const nextStart = new Date(`${target.date}T${nextTime}:00`);
		const duration = item.end
			? new Date(item.end).getTime() - new Date(item.start).getTime()
			: 0;
		start = dateTime(nextStart);
		end = item.end
			? dateTime(
					new Date(
						nextStart.getTime() +
							(Number.isFinite(duration) && duration > 0
								? duration
								: (item.type === "task" ? 30 : 60) * 60_000),
					),
				)
			: undefined;
	}
	return { ...item, start, end, due: item.type === "task" ? start : item.due };
}

export function taskDatePatch(item: OrbitItem, day: string) {
	if (!day) return { due: null, start: null, end: null };
	const moved = moveCalendarItem(item, { date: day, mode: "keep-time" });
	return {
		due: moved.due ?? null,
		start: moved.start ?? null,
		end: moved.end ?? null,
	};
}

export function timedRangeForDay(item: OrbitItem, dayKey: string) {
	const startKey = itemDayKey(item) ?? dayKey;
	const endKey = item.end?.slice(0, 10);
	const minuteOf = (value?: string) => {
		const time = scheduleTime(value);
		if (!time) return undefined;
		const [hour, minute] = time.split(":").map(Number);
		return hour * 60 + minute;
	};
	const point = minuteOf(item.start ?? item.due) ?? 0;
	const start = dayKey === startKey ? point : 0;
	const end =
		endKey && dayKey === endKey
			? (minuteOf(item.end) ?? 1440)
			: endKey && dayKey < endKey
				? 1440
				: (minuteOf(item.end) ??
					Math.min(1440, start + (item.type === "task" ? 30 : 60)));
	const startTime = scheduleTime(item.start ?? item.due);
	const endTime = scheduleTime(item.end);
	const label =
		startKey !== endKey && endKey
			? dayKey === startKey
				? `${startTime ?? "00:00"}–24:00`
				: dayKey === endKey
					? `00:00–${endTime ?? "24:00"}`
					: "종일 계속"
			: endTime
				? `${startTime}–${endTime}`
				: startTime;
	return { start, end: Math.max(start + 1, end), label };
}
