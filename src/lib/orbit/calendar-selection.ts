import { formatDayKey } from "./para";

/** Snap a dragged time range to 15-minute boundaries, including midnight. */
export function calendarSelection(
	date: string,
	anchor: number,
	current: number,
) {
	const snap = (minutes: number) =>
		Math.max(0, Math.min(1440, Math.round(minutes / 15) * 15));
	const start = Math.min(1425, snap(Math.min(anchor, current)));
	const end = Math.min(
		1440,
		Math.max(start + 15, snap(Math.max(anchor, current))),
	);
	const time = (minutes: number) =>
		`${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
	const [year, month, day] = date.split("-").map(Number);
	const endDate =
		end === 1440 ? formatDayKey(new Date(year, month - 1, day + 1)) : date;
	return {
		start,
		end,
		time: time(start),
		endAt: `${endDate}T${time(end % 1440)}:00`,
	};
}

export function calendarRangeSelection(
	date: string,
	anchor: number,
	currentDate: string,
	current: number,
) {
	if (date === currentDate) {
		return { date, ...calendarSelection(date, anchor, current) };
	}
	const forward = date < currentDate;
	const firstDate = forward ? date : currentDate;
	const lastDate = forward ? currentDate : date;
	const first = calendarSelection(
		firstDate,
		forward ? anchor : current,
		forward ? anchor : current,
	);
	const lastMinute = Math.max(
		0,
		Math.min(1440, Math.round((forward ? current : anchor) / 15) * 15),
	);
	const [year, month, day] = lastDate.split("-").map(Number);
	const endDate =
		lastMinute === 1440
			? formatDayKey(new Date(year, month - 1, day + 1))
			: lastDate;
	const endTime = `${String(Math.floor((lastMinute % 1440) / 60)).padStart(2, "0")}:${String(lastMinute % 60).padStart(2, "0")}`;
	return { ...first, date: firstDate, endAt: `${endDate}T${endTime}:00` };
}

/** Clip a continuous multi-day selection to one visible timeline column. */
export function calendarSelectionDay(
	range: ReturnType<typeof calendarRangeSelection>,
	date: string,
) {
	const endDate = range.endAt.slice(0, 10);
	if (date < range.date || date > endDate) return null;
	const start = date === range.date ? range.start : 0;
	const end =
		date === endDate
			? Number(range.endAt.slice(11, 13)) * 60 +
				Number(range.endAt.slice(14, 16))
			: 1440;
	return end > start ? { start, end } : null;
}
