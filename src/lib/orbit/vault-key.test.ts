import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { toVaultObjectKey, toVaultSlug } from "./vault-key";

test("vault slugs are normalized and object-key safe", () => {
	assert.equal(toVaultSlug("  프로젝트 / 새 메모.  "), "프로젝트-새-메모");
	assert.equal(toVaultSlug("../"), "untitled");
	assert.equal(toVaultSlug("Cafe\u0301"), "café");
});

test("vault object keys always use forward slashes", () => {
	const root = path.resolve("vault");
	const filePath = path.join(root, "projects", "orbit", "item.md");
	assert.equal(toVaultObjectKey(root, filePath), "projects/orbit/item.md");
	assert.throws(() => toVaultObjectKey(root, path.dirname(root)));
});
