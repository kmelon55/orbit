import { timedRangeForDay } from "./calendar-schedule";
import type { OrbitItem } from "./schema";

export const HOUR_HEIGHT = 120;

export function layoutTimedItems(items: OrbitItem[], dayKey: string) {
	type Entry = {
		item: OrbitItem;
		start: number;
		end: number;
		label?: string;
		column: number;
		columns: number;
	};
	const entries: Entry[] = items
		.map((item) => {
			const range = timedRangeForDay(item, dayKey);
			return {
				item,
				start: range.start,
				end: range.end,
				label: range.label,
				column: 0,
				columns: 1,
			};
		})
		.sort((left, right) => left.start - right.start || left.end - right.end);
	const result: Entry[] = [];
	let cluster: Entry[] = [];
	let clusterEnd = -1;

	function flush() {
		if (cluster.length === 0) return;
		const columnEnds: number[] = [];
		for (const entry of cluster) {
			const available = columnEnds.findIndex((end) => end <= entry.start);
			entry.column = available === -1 ? columnEnds.length : available;
			columnEnds[entry.column] = entry.end;
		}
		for (const entry of cluster) entry.columns = columnEnds.length;
		result.push(...cluster);
		cluster = [];
	}

	for (const entry of entries) {
		if (cluster.length > 0 && entry.start >= clusterEnd) flush();
		cluster.push(entry);
		clusterEnd = Math.max(clusterEnd, entry.end);
	}
	flush();
	return result;
}

// Keep the card's bounds proportional to its scheduled time, even at day boundaries.
export function timedCardHeight(start: number, end: number) {
	return ((end - start) / 60) * HOUR_HEIGHT;
}
