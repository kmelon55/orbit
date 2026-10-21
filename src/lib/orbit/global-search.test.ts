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

test("compact searches cover title, body, folder and tags without crossing fields", () => {
	const tagged = item("tag", "다른 문서", "본문");
	tagged.tags = ["검색 기능"];
	const index = createSearchIndex([
		item("title", "검색 기능", "본문"),
		item("body", "다른 문서", `${"서문 ".repeat(100)}검색 기능 상세`),
		item("folder", "다른 문서", "본문", "검색 기능"),
		tagged,
	]);
	for (const query of ["검색기능", "검색 기능", "검 색 기 능"]) {
		const hits = searchItems(index, query);
		assert.equal(hits.length, 4);
		assert.equal(hits[0].entry.item.id, "title");
		assert.match(
			hits.find((h) => h.entry.item.id === "body")?.snippet ?? "",
			/검색 기능/,
		);
	}
	assert.deepEqual(searchItems(index, " \t\n"), []);
});
