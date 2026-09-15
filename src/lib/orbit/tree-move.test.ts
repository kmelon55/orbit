import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { flattenFolderTree, indexFolderTree } from "./folder-tree";
import { mkdir, readFile } from "./storage-test-helpers";
import {
	createOrbitFolder,
	createOrbitItem,
	getOrbitSnapshot,
	moveOrbitTreeEntry,
	updateOrbitFolder,
} from "./store";

test("tree drops persist mixed sibling order, nested moves, root moves, and protect existing folders", async () => {
	const previous = process.env.ORBIT_VAULT_DIR;
	const vault = await mkdtemp(path.join(os.tmpdir(), "orbit-tree-drop-"));
	process.env.ORBIT_VAULT_DIR = vault;
	try {
		await createOrbitFolder({ space: "project", name: "a", color: "red" });
		await createOrbitFolder({ space: "project", name: "b" });
		await createOrbitFolder({
			space: "project",
			name: "child",
			parent: "a",
			color: "blue",
		});
		const first = await createOrbitItem({
			title: "First",
			body: "keep body",
			type: "note",
			space: "project",
			folder: "a/child",
		});
		const second = await createOrbitItem({
			title: "Second",
			body: "",
			type: "note",
			space: "project",
			folder: "a/child",
		});
		assert.ok(first);
		assert.ok(second);
		const rows = async () => {
			const snapshot = await getOrbitSnapshot();
			return flattenFolderTree(
				indexFolderTree(
					snapshot.items.filter((item) => item.space === "project"),
					snapshot.folders.project,
					snapshot.treeOrder?.project,
				),
				new Set(),
				"",
			).map((row) => row.key);
		};
		await moveOrbitTreeEntry({
			space: "project",
			key: `item:${second.id}`,
			target: `item:${first.id}`,
			position: "before",
		});
		assert.ok(
			(await rows()).indexOf(`item:${second.id}`) <
				(await rows()).indexOf(`item:${first.id}`),
		);
		await moveOrbitTreeEntry({
			space: "project",
			key: "folder:b",
			target: "folder:a",
			position: "before",
		});
		assert.equal((await rows())[0], "folder:b");
		const originalBody = await readFile(path.join(vault, first.path), "utf8");
		await moveOrbitTreeEntry({
			space: "project",
			key: "folder:a",
			target: "folder:b",
			position: "inside",
		});
		let snapshot = await getOrbitSnapshot();
		assert.equal(
			snapshot.items.find((item) => item.id === first.id)?.folder,
			"b/a/child",
		);
		assert.equal(
			snapshot.folders.project.find((folder) => folder.slug === "b/a")?.color,
			"red",
		);
		assert.equal(
			snapshot.folders.project.find((folder) => folder.slug === "b/a/child")
				?.color,
			"blue",
		);
		assert.equal(
			await readFile(
				path.join(vault, "projects/b/a/child", path.basename(first.path)),
				"utf8",
			),
			originalBody,
		);
		assert.deepEqual(snapshot.treeOrder?.project?.["b/a/child"], [
			`item:${second.id}`,
			`item:${first.id}`,
		]);
		await assert.rejects(
			moveOrbitTreeEntry({
				space: "project",
				key: "folder:b",
				target: "folder:b/a/child",
				position: "inside",
			}),
			/하위/,
		);
		await assert.rejects(
			moveOrbitTreeEntry({
				space: "project",
				key: "folder:b",
				target: "folder:b",
				position: "before",
			}),
			/자신/,
		);
		await createOrbitFolder({ space: "project", name: "a" });
		await assert.rejects(
			moveOrbitTreeEntry({
				space: "project",
				key: "folder:b/a",
				position: "inside",
			}),
			/같은 이름/,
		);
		assert.ok(
			(await getOrbitSnapshot()).folders.project.some(
				(folder) => folder.slug === "b/a/child",
			),
		);
		await moveOrbitTreeEntry({
			space: "project",
			key: `item:${first.id}`,
			target: "folder:a",
			position: "before",
		});
		snapshot = await getOrbitSnapshot();
		assert.equal(
			snapshot.items.find((item) => item.id === first.id)?.folder,
			undefined,
		);
		assert.ok(
			(await rows()).indexOf(`item:${first.id}`) <
				(await rows()).indexOf("folder:a"),
		);
		await moveOrbitTreeEntry({
			space: "project",
			key: `item:${first.id}`,
			target: "folder:a",
			position: "inside",
		});
		assert.equal(
			(await getOrbitSnapshot()).items.find((item) => item.id === first.id)
				?.folder,
			"a",
		);
		await moveOrbitTreeEntry({
			space: "project",
			key: "folder:b/a/child",
			position: "inside",
		});
		snapshot = await getOrbitSnapshot();
		assert.equal(
			snapshot.items.find((item) => item.id === second.id)?.folder,
			"child",
		);
		assert.equal(
			snapshot.folders.project.find((folder) => folder.slug === "child")?.color,
			"blue",
		);
		await updateOrbitFolder({
			space: "project",
			path: "child",
			name: "renamed",
		});
		snapshot = await getOrbitSnapshot();
		assert.deepEqual(snapshot.treeOrder?.project?.renamed, [
			`item:${second.id}`,
		]);
		assert.ok(snapshot.treeOrder?.project?.[""]?.includes("folder:renamed"));
		await assert.rejects(
			moveOrbitTreeEntry({
				space: "project",
				key: `item:${first.id}`,
				target: "folder:missing",
				position: "inside",
			}),
			/찾을/,
		);
		await mkdir(path.join(vault, "projects/Imported Folder"));
		await moveOrbitTreeEntry({
			space: "project",
			key: `item:${first.id}`,
			target: "folder:Imported Folder",
			position: "inside",
		});
		assert.equal(
			(await getOrbitSnapshot()).items.find((item) => item.id === first.id)
				?.folder,
			"Imported Folder",
		);
		await moveOrbitTreeEntry({
			space: "project",
			key: "folder:Imported Folder",
			target: "folder:b",
			position: "inside",
		});
		assert.equal(
			(await getOrbitSnapshot()).items.find((item) => item.id === first.id)
				?.folder,
			"b/Imported Folder",
		);

		// Derived order metadata does not add ordering fields to Markdown.
		const saved = (await getOrbitSnapshot()).items.find(
			(item) => item.id === first.id,
		);
		assert.ok(saved);
		assert.doesNotMatch(
			await readFile(path.join(vault, saved.path), "utf8"),
			/^order:/m,
		);
	} finally {
		if (previous === undefined) delete process.env.ORBIT_VAULT_DIR;
		else process.env.ORBIT_VAULT_DIR = previous;
		await rm(vault, { recursive: true, force: true });
	}
});
