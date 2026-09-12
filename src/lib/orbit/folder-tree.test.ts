import assert from "node:assert/strict";
import test from "node:test";
import {
	flattenFolderTree,
	indexFolderTree,
	visibleRowRange,
} from "./folder-tree";
import type { OrbitFolder, OrbitItem } from "./schema";

function folder(slug: string): OrbitFolder {
	const parts = slug.split("/");
	return {
		slug,
		name: parts.at(-1) ?? slug,
		parent: parts.length > 1 ? parts.slice(0, -1).join("/") : undefined,
		space: "project",
		depth: parts.length - 1,
		color: "lime",
		count: 0,
		descendantCount: 0,
	};
}
function item(id: string, folder?: string): OrbitItem {
	return {
		id,
		title: id,
		body: "",
		folder,
		space: "project",
		type: "note",
		tags: [],
		created: "2026-09-09",
		updated: "2026-09-09",
		path: `${id}.md`,
	};
}

test("collapsed branches contribute no note rows, including nested branches", () => {
	const index = indexFolderTree(
		[
			item("root"),
			item("parent-note", "프로젝트"),
			item("nested-note", "프로젝트/하위"),
		],
		[folder("프로젝트"), folder("프로젝트/하위")],
	);
	assert.deepEqual(
		flattenFolderTree(index, new Set(["프로젝트"]), "").map((row) => row.key),
		["folder:프로젝트", "item:root"],
	);
	assert.deepEqual(
		flattenFolderTree(index, new Set(["프로젝트/하위"]), "").map(
			(row) => row.key,
		),
		[
			"folder:프로젝트",
			"folder:프로젝트/하위",
			"item:parent-note",
			"item:root",
		],
	);
});

test("search reveals matching descendants and ancestors without changing expansion state", () => {
	const collapsed = new Set(["프로젝트"]);
	const index = indexFolderTree(
		[item("찾을 노트", "프로젝트/하위"), item("다른 노트", "프로젝트")],
		[folder("프로젝트"), folder("프로젝트/하위")],
	);
	assert.deepEqual(
		flattenFolderTree(index, collapsed, "찾을").map((row) => row.key),
		["folder:프로젝트", "folder:프로젝트/하위", "item:찾을 노트"],
	);
	assert.equal(flattenFolderTree(index, collapsed, "").length, 1);
	assert.equal(flattenFolderTree(index, collapsed, "없는 검색어").length, 0);
});

test("a 10000-note folder renders a bounded window on every expansion", () => {
	const index = indexFolderTree(
		Array.from({ length: 10000 }, (_, i) => item(`note-${i}`, "프로젝트")),
		[folder("프로젝트")],
	);
	for (let attempt = 0; attempt < 5; attempt++) {
		assert.equal(flattenFolderTree(index, new Set(["프로젝트"]), "").length, 1);
		const rows = flattenFolderTree(index, new Set(), "");
		assert.equal(rows.length, 10001);
		for (const top of [0, 100000, 339000]) {
			const range = visibleRowRange(rows.length, top, 600, 34);
			assert.ok(range.end - range.start <= 35);
		}
	}
	const range = visibleRowRange(1, 100000, 600, 34);
	assert.deepEqual(range, { start: 0, end: 1 });
	assert.deepEqual(visibleRowRange(0, 0, 600, 34), { start: 0, end: 0 });
});
