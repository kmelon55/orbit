import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { closeOrbitDatabases, databaseFor, withDatabase } from "./database";
import { OptimisticItems } from "./optimistic-mutations";
import type { OrbitMutation } from "./schema";
import { mkdir, writeFile } from "./storage-test-helpers";
import {
	createOrbitFolder,
	createOrbitItem,
	getOrbitSnapshot,
	updateOrbitFolder,
} from "./store";

test("PARA folder moves preserve subtrees and identity, reject collisions, and roll back", async (t) => {
	const previous = process.env.ORBIT_VAULT_DIR;
	const vault = await mkdtemp(path.join(os.tmpdir(), "orbit-folder-move-"));
	process.env.ORBIT_VAULT_DIR = vault;
	try {
		await mkdir(path.join(vault, "projects/parent/Legacy Folder/Empty"), {
			recursive: true,
		});
		await updateOrbitFolder({
			space: "project",
			path: "parent/Legacy Folder",
			color: "blue",
		});
		await updateOrbitFolder({
			space: "project",
			path: "parent/Legacy Folder/Empty",
			color: "pink",
		});
		await writeFile(
			path.join(vault, "projects/parent/Legacy Folder/legacy.md"),
			"---\ntitle: Legacy\ntype: note\nspace: project\n---\nKeep **all** content.\n",
		);
		const task = await createOrbitItem({
			space: "project",
			folder: "parent/other",
			title: "Unrelated",
			type: "task",
			body: "untouched",
		});
		assert.ok(task);
		const seed = await getOrbitSnapshot();
		const note = seed.items.find((item) => item.title === "Legacy");
		assert.ok(note);
		await withDatabase(
			() =>
				databaseFor().setMetadata("folders", {
					version: 1,
					folders: {
						project: {
							"parent/Legacy Folder": { color: "blue" },
							"parent/Legacy Folder/Empty": { color: "pink" },
						},
					},
					treeOrder: {
						project: {
							parent: ["folder:parent/Legacy Folder", "folder:parent/other"],
							"parent/Legacy Folder": [
								`item:${note.id}`,
								"folder:parent/Legacy Folder/Empty",
							],
						},
					},
				}),
			true,
		);
		const initial = await getOrbitSnapshot();
		const mutation: OrbitMutation = {
			action: "update-folder",
			input: {
				space: "project",
				path: "parent/Legacy Folder",
				destinationSpace: "archive",
			},
		};
		await t.test(
			"optimistic move updates both spaces and remains pending until the source disappears",
			() => {
				const store = new OptimisticItems();
				store.acknowledge(note);
				store.start("move", mutation, initial);
				const projected = store.project(initial);
				assert.equal(
					projected.items.find((item) => item.id === note.id)?.space,
					"archive",
				);
				assert.equal(projected.counts.archive, 1);
				assert.equal(
					projected.folders.project.find((f) => f.slug === "parent")
						?.descendantCount,
					1,
				);
				assert.equal(
					projected.folders.archive.find(
						(f) => f.slug === "Legacy Folder/Empty",
					)?.color,
					"pink",
				);
				assert.deepEqual(projected.treeOrder?.archive?.["Legacy Folder"], [
					`item:${note.id}`,
					"folder:Legacy Folder/Empty",
				]);
				store.finish({ requestId: "move", mutation, phase: "success" });
				store.reconcile(initial);
				assert.equal(store.project(initial).counts.archive, 1);
				store.reconcile(projected);
				assert.equal(store.project(projected), projected);
				const failed = new OptimisticItems();
				failed.start("failed", mutation, initial);
				failed.finish({ requestId: "failed", mutation, phase: "failure" });
				assert.equal(failed.project(initial), initial);
			},
		);
		await t.test(
			"database failures restore the full source and metadata",
			async () => {
				await withDatabase(
					() =>
						databaseFor().sql.exec(
							"CREATE TRIGGER fail_move BEFORE INSERT ON documents WHEN NEW.path LIKE 'archive/%' BEGIN SELECT RAISE(ABORT, 'injected move failure'); END",
						),
					true,
				);
				await assert.rejects(
					updateOrbitFolder(mutation.input),
					/invalid database state/,
				);
				await withDatabase(
					() => databaseFor().sql.exec("DROP TRIGGER fail_move"),
					true,
				);
				const restored = await getOrbitSnapshot();
				assert.deepEqual(restored.items, initial.items);
				assert.deepEqual(restored.folders, initial.folders);
				assert.deepEqual(restored.treeOrder, initial.treeOrder);
			},
		);
		await t.test(
			"persisted move preserves legacy case, colors, order, raw body, and identity after reopen",
			async () => {
				await updateOrbitFolder(mutation.input);
				closeOrbitDatabases();
				const moved = await getOrbitSnapshot();
				const actual = moved.items.find((item) => item.id === note.id);
				assert.ok(actual);
				assert.deepEqual(actual, {
					...note,
					space: "archive",
					folder: "Legacy Folder",
					path: "archive/Legacy Folder/legacy.md",
				});
				assert.deepEqual(
					moved.items.find((item) => item.id === task.id),
					task,
				);
				assert.equal(
					moved.folders.archive.find((f) => f.slug === "Legacy Folder")?.color,
					"blue",
				);
				assert.equal(
					moved.folders.archive.find((f) => f.slug === "Legacy Folder/Empty")
						?.color,
					"pink",
				);
				assert.deepEqual(moved.treeOrder?.project?.parent, [
					"folder:parent/other",
				]);
				assert.deepEqual(moved.treeOrder?.archive?.["Legacy Folder"], [
					`item:${note.id}`,
					"folder:Legacy Folder/Empty",
				]);
				assert.ok(
					!moved.folders.project.some((f) =>
						f.slug.startsWith("parent/Legacy Folder"),
					),
				);
				for (const destinationSpace of [
					"area",
					"resource",
					"project",
					"archive",
				] as const) {
					const current = (await getOrbitSnapshot()).items.find(
						(item) => item.id === note.id,
					);
					assert.ok(current?.folder);
					await updateOrbitFolder({
						space: current.space as "archive",
						path: current.folder,
						destinationSpace,
					});
					assert.equal(
						(await getOrbitSnapshot()).items.find((item) => item.id === note.id)
							?.space,
						destinationSpace,
					);
				}
			},
		);
		await t.test(
			"duplicate destinations are rejected without merging or losing source data",
			async () => {
				await createOrbitFolder({ space: "resource", name: "Taken" });
				const before = await getOrbitSnapshot();
				await assert.rejects(
					updateOrbitFolder({
						space: "archive",
						path: "Legacy Folder",
						destinationSpace: "resource",
						name: "Taken",
					}),
					/같은 이름/,
				);
				await assert.rejects(
					updateOrbitFolder({
						space: "archive",
						path: "Legacy Folder",
						destinationSpace: "resource",
						parent: "../",
					}),
				);
				const after = await getOrbitSnapshot();
				assert.deepEqual(after.items, before.items);
				assert.deepEqual(after.folders, before.folders);
			},
		);
	} finally {
		closeOrbitDatabases();
		if (previous === undefined) delete process.env.ORBIT_VAULT_DIR;
		else process.env.ORBIT_VAULT_DIR = previous;
		await rm(vault, { recursive: true, force: true });
	}
});
