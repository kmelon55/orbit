import assert from "node:assert/strict";
import test from "node:test";
import { formatDayKey } from "./para";
import type { OrbitItem } from "./schema";
import { todayView } from "./today";

const base: OrbitItem = {
	id: "task",
	title: "Task",
	type: "task",
	space: "inbox",
	status: "open",
	body: "",
	path: "",
	tags: [],
	created: "2026-10-26",
	updated: "2026-10-26",
};

test("heading, tasks and events follow the browser day rather than the UTC server day", () => {
	const oldZone = process.env.TZ;
	const items: OrbitItem[] = [
		{ ...base, id: "today", due: "2026-10-27" },
		{ ...base, id: "future", start: "2026-10-28T09:00:00" },
		{ ...base, id: "done", due: "2026-10-27", status: "done" },
		{ ...base, id: "event26", type: "event", start: "2026-10-26T09:00:00" },
		{ ...base, id: "event27", type: "event", start: "2026-10-27T09:00:00" },
	];
	try {
		const now = new Date("2026-10-26T15:00:00Z");
		process.env.TZ = "UTC";
		const server = todayView(items, formatDayKey(now));
		assert.equal(server.displayDate.day, "26");
		process.env.TZ = "Asia/Seoul";
		const browser = todayView(items, formatDayKey(now));
		assert.equal(browser.displayDate.longLabel, "TUESDAY, OCTOBER 27");
		assert.deepEqual(
			browser.today.tasks.map((item) => item.id),
			["today"],
		);
		assert.deepEqual(
			browser.today.events.map((item) => item.id),
			["event27"],
		);
		assert.equal(server.displayDate.day, "26");
		const nextDay = todayView(items, "2026-10-28");
		assert.equal(nextDay.displayDate.day, "28");
		assert.deepEqual(
			nextDay.today.tasks.map((item) => item.id),
			["today", "future"],
		);
		assert.deepEqual(nextDay.today.events, []);
	} finally {
		if (oldZone === undefined) delete process.env.TZ;
		else process.env.TZ = oldZone;
	}
});
