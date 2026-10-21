import assert from "node:assert/strict";
import test from "node:test";
import {
	matchesSearch,
	normalizeSearchText,
	searchSnippet,
} from "./search-text";

test("search ignores whitespace in either direction, case and Unicode forms", () => {
	for (const query of ["검색기능", "검색 기능", "검 색 기 능", "검색\t기능"]) {
		assert.ok(matchesSearch(["새 검색\n기능"], query));
		assert.ok(matchesSearch(["새검색기능"], query));
	}
	assert.ok(matchesSearch(["Ｄｒａｆｔ 기획".normalize("NFD")], "DRAFT 기획"));
	assert.ok(matchesSearch(["기획", "Draft"], "draft 기획"));
	assert.equal(matchesSearch(["검색", "기능"], "검색기능"), false);
	assert.equal(matchesSearch(["Draft"], "draft 누락"), false);
	assert.equal(normalizeSearchText("A\u00a0 B"), "ab");
});

test("excerpt retains the real hit after long spaced/decomposed text", () => {
	const text = `${"가 나 다 ".repeat(80)}검색 기능 상세`.normalize("NFD");
	assert.match(
		searchSnippet(text, ["검색기능"]).normalize("NFC"),
		/검색 기능 상세/,
	);
	assert.equal(searchSnippet("원문 보존", ["없음"]), "원문 보존");
});
