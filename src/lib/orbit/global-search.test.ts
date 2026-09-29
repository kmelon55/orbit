import assert from "node:assert/strict";
import test from "node:test";
import { createSearchIndex, searchItems } from "./global-search";
import type { OrbitItem } from "./schema";

function item(id: string, title: string, body: string, folder = ""): OrbitItem {
	return {
		id,
		title,
		body,
		folder,
		type: "note",
		space: "project",
		tags: [],
		created: "2026-01-01",
		updated: "2026-01-01",
		path: `projects/${id}.md`,
	};
}

test("global search finds Korean body text and ranks title matches first", () => {
	const index = createSearchIndex([
		item("body", "회의록", "검색 기능 기획"),
		item("title", "검색 기능", "내용"),
		item("folder", "참고", "내용", "검색 기능"),
	]);
	assert.deepEqual(
		searchItems(index, "검색 기능").map((hit) => hit.entry.item.id),
		["title", "folder", "body"],
	);
});

test("global search requires all terms and normalizes case", () => {
	const index = createSearchIndex([
		item("yes", "Orbit", "Fast Search"),
		item("no", "Orbit", "Calendar"),
	]);
	assert.deepEqual(
		searchItems(index, "ORBIT search").map((hit) => hit.entry.item.id),
		["yes"],
	);
});
