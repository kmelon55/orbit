import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { closeOrbitDatabases } from "./database";
import { mkdir } from "./storage-test-helpers";
import {
	createOrbitFolder,
	createOrbitItem,
	fileOrbitItem,
	getOrbitSnapshot,
} from "./store";

test("create and file reuse imported case/space folder identities including parents", async () => {
	const previous = process.env.ORBIT_VAULT_DIR;
	const vault = await mkdtemp(path.join(os.tmpdir(), "orbit-folder-identity-"));
	process.env.ORBIT_VAULT_DIR = vault;
	try {
		await mkdir(path.join(vault, "projects/Draft/Daily Log"), {
			recursive: true,
		});
		const a = await createOrbitItem({
			title: "created",
			type: "note",
			space: "project",
			folder: "DRAFT/dailylog",
			body: "**preserve**",
		});
		assert.equal(a?.folder, "Draft/Daily Log");
		const folder = await createOrbitFolder({
			space: "project",
			name: "daily log",
			parent: "draft",
		});
		assert.equal(folder.slug, "Draft/Daily Log");
		const child = await createOrbitFolder({
			space: "project",
			name: "새 폴더",
			parent: "draft",
		});
		assert.equal(child.slug, "Draft/새-폴더");
		assert.ok(a);
		const moved = await fileOrbitItem(a.id, {
			space: "project",
			folder: "dRaFt",
		});
		assert.equal(moved?.folder, "Draft");
		assert.equal(moved?.body, a.body);
		const snapshot = await getOrbitSnapshot();
		assert.equal(
			snapshot.folders.project.some((f) => f.slug === "draft"),
			false,
		);
		assert.equal(snapshot.items.length, 1);
		await mkdir(path.join(vault, "projects/draft"), { recursive: true });
		await assert.rejects(
			createOrbitItem({
				title: "ambiguous",
				body: "",
				type: "note",
				space: "project",
				folder: "DRAFT",
			}),
			/정확한 폴더/,
		);
		await assert.rejects(
			createOrbitItem({
				title: "escape",
				body: "",
				type: "note",
				space: "project",
				folder: "../outside",
			}),
			/Invalid folder/,
		);
	} finally {
		closeOrbitDatabases();
		if (previous === undefined) delete process.env.ORBIT_VAULT_DIR;
		else process.env.ORBIT_VAULT_DIR = previous;
		await rm(vault, { recursive: true, force: true });
	}
});
