import { timedRangeForDay } from "./calendar-schedule";
import type { OrbitItem } from "./schema";

export const HOUR_HEIGHT = 120;
export const MIN_HOUR_HEIGHT = 48;
export const MAX_HOUR_HEIGHT = 240;
export const MIN_TIMED_CARD_HEIGHT = 22;

export function clampHourHeight(height: number) {
	return Math.min(MAX_HOUR_HEIGHT, Math.max(MIN_HOUR_HEIGHT, height));
}

// Keep the time under the gesture at the same position in the viewport.
export function zoomedScrollTop(
	scrollTop: number,
	anchorOffset: number,
	previousHeight: number,
	nextHeight: number,
) {
	return Math.max(
		0,
		((scrollTop + anchorOffset) / previousHeight) * nextHeight - anchorOffset,
	);
}

export function layoutTimedItems(
	items: OrbitItem[],
	dayKey: string,
	hourHeight = HOUR_HEIGHT,
) {
	type Entry = {
		item: OrbitItem;
		start: number;
		end: number;
		label?: string;
		top: number;
		height: number;
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
				top: (range.start / 60) * hourHeight,
				height: Math.max(
					MIN_TIMED_CARD_HEIGHT,
					timedCardHeight(range.start, range.end, hourHeight),
				),
				column: 0,
				columns: 1,
			};
		})
		.sort((left, right) => left.start - right.start || left.end - right.end);
	const result: Entry[] = [];
	let cluster: Entry[] = [];
	let clusterEnd = -1;

	function flush(nextTop?: number) {
		if (cluster.length === 0) return;
		const columnLast: Entry[] = [];
		for (const entry of cluster) {
			// Collision detection must not depend on zoom or minimum card height.
			const available = columnLast.findIndex((last) => last.end <= entry.start);
			entry.column = available === -1 ? columnLast.length : available;
			const previous = columnLast[entry.column];
			if (previous) {
				previous.height = Math.min(previous.height, entry.top - previous.top);
			}
			columnLast[entry.column] = entry;
		}
		// Preserve readable minimum heights only where there is room before the
		// next card, including the next cluster whose columns may have other widths.
		if (nextTop !== undefined) {
			for (const entry of columnLast) {
				entry.height = Math.min(entry.height, nextTop - entry.top);
			}
		}
		for (const entry of cluster) entry.columns = columnLast.length;
		result.push(...cluster);
		cluster = [];
	}

	for (const entry of entries) {
		if (cluster.length > 0 && entry.start >= clusterEnd) flush(entry.top);
		cluster.push(entry);
		clusterEnd = Math.max(clusterEnd, entry.end);
	}
	flush();
	return result;
}

// Keep the card's bounds proportional to its scheduled time, even at day boundaries.
export function timedCardHeight(
	start: number,
	end: number,
	hourHeight = HOUR_HEIGHT,
) {
	return ((end - start) / 60) * hourHeight;
}
