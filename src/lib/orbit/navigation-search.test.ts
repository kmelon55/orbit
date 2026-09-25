import assert from "node:assert/strict";
import test from "node:test";
import { calendarSearch, mailSearch, noteSearch } from "./navigation-search";

test("calendar defaults to month and accepts a valid explicit view and date", () => {
	assert.equal(calendarSearch({}).view ?? "month", "month");
	assert.deepEqual(
		calendarSearch({
			view: "week",
			date: "2026-09-25",
			selected: "2026-09-26",
		}),
		{
			view: "week",
			date: "2026-09-25",
			selected: "2026-09-26",
		},
	);
	for (const date of [
		"2026-02-30",
		"2026-13-01",
		"2026-09-99",
		"garbage",
		["2026-09-25"],
	]) {
		assert.equal(calendarSearch({ view: "invalid", date }).date, undefined);
	}
	assert.equal(calendarSearch({ date: "2028-02-29" }).date, "2028-02-29");
});

test("mail deep links preserve demo, connection, message and list filters", () => {
	assert.deepEqual(
		mailSearch({
			demo: 1,
			connection: "connected",
			message: "message-1",
			folder: "sent",
			accounts: ["account-1", "account-1", 4, ""],
			q: "한글",
		}),
		{
			demo: true,
			connection: "connected",
			message: "message-1",
			folder: "sent",
			accounts: ["account-1"],
			q: "한글",
		},
	);
	assert.deepEqual(mailSearch({ accounts: [] }).accounts, []);
	assert.equal(mailSearch({}).accounts, undefined);
});

test("malformed search input safely falls back instead of breaking rendering", () => {
	const search = mailSearch({
		folder: "toString",
		message: {},
		accounts: "all",
		q: "x".repeat(300),
		demo: "false",
	});
	assert.equal(search.folder, undefined);
	assert.equal(search.message, undefined);
	assert.equal(search.accounts, undefined);
	assert.equal(search.demo, undefined);
	assert.equal(search.q?.length, 200);
	assert.deepEqual(noteSearch({ note: ["id"] }), { note: undefined });
	assert.deepEqual(noteSearch({ note: "note-1" }), { note: "note-1" });
});
