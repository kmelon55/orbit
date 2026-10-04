import { formatDayKey } from "./para";
import type { OrbitItem } from "./schema";

type MonthSegment = {
	item: OrbitItem;
	row: number;
	startColumn: number;
	endColumn: number;
	startKey: string;
	endKey: string;
	lane: number;
};

export function isCalendarHeaderItem(item: OrbitItem) {
	return (
		!/(?:T\d{2}:\d{2})/.test(item.start ?? item.due ?? "") ||
		(item.type === "event" &&
			Boolean(
				item.start &&
					item.end &&
					item.end.slice(0, 10) > item.start.slice(0, 10),
			))
	);
}

export function buildWeekLayout(byDay: Map<string, OrbitItem[]>, days: Date[]) {
	const headerByDay = new Map<string, OrbitItem[]>();
	const timedByDay = new Map<string, OrbitItem[]>();
	for (const day of days) {
		const key = formatDayKey(day);
		const items = byDay.get(key) ?? [];
		headerByDay.set(key, items.filter(isCalendarHeaderItem));
		timedByDay.set(
			key,
			items.filter((item) => !isCalendarHeaderItem(item)),
		);
	}
	const { segments, rowLaneCounts } = buildMonthLayout(
		headerByDay,
		days,
		days.length || 1,
	);
	return { segments, laneCount: rowLaneCounts[0], timedByDay };
}

export function buildMonthLayout(
	byDay: Map<string, OrbitItem[]>,
	days: Date[],
	columns = 7,
) {
	const dayKeys = days.map((day) => formatDayKey(day));
	const uniqueItems = new Map<string, OrbitItem>();
	for (const key of dayKeys) {
		for (const item of byDay.get(key) ?? []) uniqueItems.set(item.id, item);
	}

	const segments: MonthSegment[] = [];
	for (const item of uniqueItems.values()) {
		const indices = dayKeys.flatMap((key, index) =>
			(byDay.get(key) ?? []).some((entry) => entry.id === item.id)
				? [index]
				: [],
		);
		if (indices.length === 0) continue;
		let index = Math.min(...indices);
		const lastIndex = Math.max(...indices);
		while (index <= lastIndex) {
			const row = Math.floor(index / columns);
			const segmentEnd = Math.min(lastIndex, (row + 1) * columns - 1);
			segments.push({
				item,
				row,
				startColumn: index % columns,
				endColumn: segmentEnd % columns,
				startKey: dayKeys[index],
				endKey: dayKeys[segmentEnd],
				lane: 0,
			});
			index = segmentEnd + 1;
		}
	}

	segments.sort((left, right) => {
		if (left.row !== right.row) return left.row - right.row;
		const leftSpan = left.endColumn - left.startColumn;
		const rightSpan = right.endColumn - right.startColumn;
		if (leftSpan !== rightSpan) return rightSpan - leftSpan;
		if (left.startColumn !== right.startColumn) {
			return left.startColumn - right.startColumn;
		}
		return (left.item.start ?? left.item.due ?? "").localeCompare(
			right.item.start ?? right.item.due ?? "",
		);
	});

	const rowLanes = new Map<number, MonthSegment[][]>();
	for (const segment of segments) {
		const lanes = rowLanes.get(segment.row) ?? [];
		const available = lanes.findIndex((lane) =>
			lane.every(
				(existing) =>
					existing.endColumn < segment.startColumn ||
					existing.startColumn > segment.endColumn,
			),
		);
		segment.lane = available === -1 ? lanes.length : available;
		if (!lanes[segment.lane]) lanes[segment.lane] = [];
		lanes[segment.lane].push(segment);
		rowLanes.set(segment.row, lanes);
	}

	return {
		segments,
		rowLaneCounts: Array.from(
			{ length: Math.max(1, Math.ceil(days.length / columns)) },
			(_, row) => rowLanes.get(row)?.length ?? 0,
		),
	};
}
