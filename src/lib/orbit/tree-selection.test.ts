import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { closeOrbitDatabases, databaseFor, withDatabase } from "./database";
import { indexFolderTree } from "./folder-tree";
import { OptimisticItems } from "./optimistic-mutations";
import type { OrbitMutation } from "./schema";
import {
	createOrbitFolder,
	createOrbitItem,
	getOrbitSnapshot,
	operateOrbitTreeSelection,
} from "./store";
import { treeMoveEntries, treeSelectionRoots } from "./tree-move";

test("selection moves and deletes are atomic, deduplicate descendants, preserve order and reconcile saved overlays", async () => {
	const previous = process.env.ORBIT_VAULT_DIR;
	const vault = await mkdtemp(path.join(os.tmpdir(), "orbit-selection-"));
	process.env.ORBIT_VAULT_DIR = vault;
	try {
		for (const name of ["source", "target", "other"])
			await createOrbitFolder({ space: "resource", name });
		for (const parent of ["source", "other"])
			await createOrbitFolder({ space: "resource", name: "child", parent });
		const first = await createOrbitItem({
			space: "resource",
			folder: "source/child",
			title: "First",
			type: "note",
			body: "preserve me",
		});
		const second = await createOrbitItem({
			space: "resource",
			folder: "source",
			title: "Second",
			type: "note",
			body: "also preserve",
		});
		const target = await createOrbitItem({
			space: "resource",
			folder: "target",
			title: "Target",
			type: "note",
			body: "",
		});
		assert.ok(first && second && target);
		const snapshot = await getOrbitSnapshot();
		const entries = treeMoveEntries(
			indexFolderTree(snapshot.items, snapshot.folders.resource),
		);
		assert.deepEqual(
			treeSelectionRoots(entries, [
				"folder:source",
				"folder:source/child",
				`item:${first.id}`,
			]),
			["folder:source"],
		);
		const roots = ["folder:source/child", "folder:other/child"];
		await assert.rejects(
			operateOrbitTreeSelection({
				space: "resource",
				keys: roots,
				operation: "move",
				target: "folder:target",
				position: "inside",
			}),
			/같은 이름/,
		);
		const rolledBack = await getOrbitSnapshot();
		assert.deepEqual(rolledBack.items, snapshot.items);
		assert.deepEqual(rolledBack.folders, snapshot.folders);
		assert.deepEqual(rolledBack.treeOrder, snapshot.treeOrder);
		await assert.rejects(
			operateOrbitTreeSelection({
				space: "resource",
				keys: ["folder:source", `item:${target.id}`],
				operation: "move",
				target: "folder:source/child",
				position: "inside",
			}),
			/하위 폴더/,
		);
		const selected = [`item:${second.id}`, `item:${first.id}`];
		const expected = treeSelectionRoots(entries, selected);
		const moved = await operateOrbitTreeSelection({
			space: "resource",
			keys: selected,
			operation: "move",
			target: `item:${target.id}`,
			position: "after",
		});
		const after = await getOrbitSnapshot();
		assert.deepEqual(after.treeOrder?.resource?.target, [
			`item:${target.id}`,
			...expected,
		]);
		assert.equal(
			after.items.find((i) => i.id === first.id)?.body,
			"preserve me",
		);
		assert.equal(after.items.find((i) => i.id === second.id)?.folder, "target");
		const overlay = new OptimisticItems();
		overlay.acknowledge(first);
		const moveMutation: OrbitMutation = {
			action: "tree-selection",
			input: {
				space: "resource",
				keys: selected,
				operation: "move",
				target: `item:${target.id}`,
				position: "after",
			},
		};
		overlay.finish({
			requestId: "move",
			mutation: moveMutation,
			phase: "success",
			result: moved,
		});
		assert.equal(
			overlay.project(snapshot).items.find((i) => i.id === first.id)?.folder,
			"target",
		);
		const keys = ["folder:target", `item:${first.id}`, "folder:source"];
		await assert.rejects(
			operateOrbitTreeSelection({
				space: "resource",
				keys,
				operation: "delete",
				position: "inside",
			}),
			/확인/,
		);
		await withDatabase(
			() =>
				databaseFor().sql.exec(
					"CREATE TRIGGER fail_selection_delete BEFORE DELETE ON directories WHEN OLD.path = 'resources/target' BEGIN SELECT RAISE(ABORT, 'injected selection failure'); END",
				),
			true,
		);
		await assert.rejects(
			operateOrbitTreeSelection({
				space: "resource",
				keys,
				operation: "delete",
				position: "inside",
				confirmDelete: true,
			}),
			/injected selection failure/,
		);
		await withDatabase(
			() => databaseFor().sql.exec("DROP TRIGGER fail_selection_delete"),
			true,
		);
		const restored = await getOrbitSnapshot();
		assert.deepEqual(restored.items, after.items);
		assert.deepEqual(restored.folders, after.folders);
		const deleted = await operateOrbitTreeSelection({
			space: "resource",
			keys,
			operation: "delete",
			position: "inside",
			confirmDelete: true,
		});
		const mutation: OrbitMutation = {
			action: "tree-selection",
			input: {
				space: "resource",
				keys,
				operation: "delete",
				position: "inside",
				confirmDelete: true,
			},
		};
		overlay.finish({
			requestId: "delete",
			mutation,
			phase: "success",
			result: deleted,
		});
		assert.ok(!overlay.project(snapshot).items.some((i) => i.id === first.id));
		closeOrbitDatabases();
		const persisted = await getOrbitSnapshot();
		assert.ok(
			!persisted.items.some((i) =>
				[first.id, second.id, target.id].includes(i.id),
			),
		);
		assert.ok(persisted.folders.resource.some((f) => f.slug === "other/child"));
	} finally {
		closeOrbitDatabases();
		if (previous === undefined) delete process.env.ORBIT_VAULT_DIR;
		else process.env.ORBIT_VAULT_DIR = previous;
		await rm(vault, { recursive: true, force: true });
	}
});
