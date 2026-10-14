import assert from "node:assert/strict";
import test from "node:test";
import { extendCalendarWindow } from "./calendar-window";

test("long calendar browsing stays bounded in both directions and retains nearby dates", () => {
	for (const config of [
		{ initial: { start: -7, end: 13 }, step: 7, limit: 35 },
		{ initial: { start: -3, end: 6 }, step: 6, limit: 22 },
	]) {
		let range = config.initial;
		for (const direction of [1, -1, 1] as const) {
			for (let index = 0; index < 1000; index++) {
				const previous = range;
				range = extendCalendarWindow(
					range,
					direction,
					config.step,
					config.limit,
				);
				assert.ok(range.end - range.start + 1 <= config.limit);
				const anchor = direction === 1 ? previous.end - 2 : previous.start + 2;
				assert.ok(anchor >= range.start && anchor <= range.end);
				assert.equal(
					direction === 1
						? range.end - previous.end
						: previous.start - range.start,
					config.step,
				);
			}
		}
	}
});

test("week window shifts preserve the date and pixel position under the viewport", () => {
	const width = 137;
	for (const direction of [-1, 1] as const) {
		const previous = { start: -7, end: 27 };
		const next = extendCalendarWindow(previous, direction, 7, 35);
		const left = (direction === 1 ? 27 : 1) * width + 23;
		const adjusted = left + (previous.start - next.start) * width;
		assert.equal(previous.start + left / width, next.start + adjusted / width);
	}
});
