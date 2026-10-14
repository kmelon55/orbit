export type CalendarWindow = { start: number; end: number };

// Keep nearby dates mounted while releasing dates behind the scroll direction.
export function extendCalendarWindow(
	range: CalendarWindow,
	direction: -1 | 1,
	step: number,
	limit: number,
): CalendarWindow {
	if (direction === -1) {
		const start = range.start - step;
		return { start, end: Math.min(range.end, start + limit - 1) };
	}
	const end = range.end + step;
	return { start: Math.max(range.start, end - limit + 1), end };
}
