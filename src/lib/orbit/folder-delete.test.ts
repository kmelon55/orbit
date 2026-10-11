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
	deleteOrbitFolder,
	getOrbitSnapshot,
	updateOrbitNote,
} from "./store";

test("folder deletion requires explicit confirmation, removes only its subtree, and rolls back atomically", async (t) => {
	const previous = process.env.ORBIT_VAULT_DIR;
	const vault = await mkdtemp(path.join(os.tmpdir(), "orbit-folder-delete-"));
	process.env.ORBIT_VAULT_DIR = vault;
	try {
		await createOrbitFolder({ space: "project", name: "부모" });
		const folder = await createOrbitFolder({
			space: "project",
			name: "대상",
			parent: "부모",
			color: "blue",
		});
		await createOrbitFolder({
			space: "project",
			name: "하위",
			parent: folder.slug,
			color: "pink",
		});
		await createOrbitFolder({
			space: "project",
			name: "빈-하위",
			parent: folder.slug,
		});
		const note = await createOrbitItem({
			space: "project",
			folder: folder.slug,
			title: "직접 노트",
			type: "note",
			body: "보존 또는 삭제",
		});
		const task = await createOrbitItem({
			space: "project",
			folder: `${folder.slug}/하위`,
			title: "중첩 할 일",
			type: "task",
			body: "",
		});
		const sibling = await createOrbitItem({
			space: "project",
			folder: `${folder.slug}2`,
			title: "유사한 이름",
			type: "note",
			body: "유지",
		});
		const otherSpace = await createOrbitItem({
			space: "area",
			folder: folder.slug,
			title: "다른 공간",
			type: "note",
			body: "유지",
		});
		assert.ok(note && task && sibling && otherSpace);
		await writeFile(
			path.join(vault, "projects", folder.slug, "broken.md"),
			"---\ntitle: [broken\n---\nbody",
		);
		await withDatabase(
			() =>
				databaseFor().setMetadata("folders", {
					version: 1,
					folders: {
						project: {
							[folder.slug]: { color: "blue" },
							[`${folder.slug}/하위`]: { color: "pink" },
							[`${folder.slug}2`]: { color: "lime" },
						},
					},
					treeOrder: {
						project: {
							부모: [`folder:${folder.slug}`, `folder:${folder.slug}2`],
							[folder.slug]: [`item:${note.id}`, `folder:${folder.slug}/하위`],
							[`${folder.slug}/하위`]: [`item:${task.id}`],
						},
					},
				}),
			true,
		);
		const input = {
			space: "project" as const,
			path: folder.slug,
			deleteContents: true,
			confirmationName: folder.name,
		};
		const initial = await getOrbitSnapshot();

		await t.test(
			"nonempty folders and missing, wrong, or partial confirmation are rejected",
			async () => {
				await assert.rejects(
					deleteOrbitFolder({ space: "project", path: folder.slug }),
					/하위 폴더/,
				);
				for (const confirmationName of [
					undefined,
					"",
					"대",
					"대상 ",
					"부모/대상",
					"대상2",
				])
					await assert.rejects(
						deleteOrbitFolder({ ...input, confirmationName }),
						/정확히/,
					);
				for (const invalid of ["../", "부모/../대상", "/"])
					await assert.rejects(deleteOrbitFolder({ ...input, path: invalid }));
				assert.deepEqual((await getOrbitSnapshot()).items, initial.items);
			},
		);

		await t.test(
			"optimistic subtree removal updates counts and rolls back without affecting siblings",
			() => {
				const store = new OptimisticItems();
				const mutation: OrbitMutation = { action: "delete-folder", input };
				store.start("delete", mutation, initial);
				const projected = store.project(initial);
				assert.deepEqual(
					new Set(projected.items.map((item) => item.id)),
					new Set([sibling.id, otherSpace.id]),
				);
				assert.equal(projected.counts.project, 1);
				assert.equal(
					projected.folders.project.find((f) => f.slug === "부모")
						?.descendantCount,
					1,
				);
				assert.ok(!projected.today.tasks.some((item) => item.id === task.id));
				assert.deepEqual(projected.treeOrder?.project?.부모, [
					`folder:${folder.slug}2`,
				]);
				store.reconcile(initial);
				assert.equal(store.project(initial).items.length, 2);
				store.finish({ requestId: "delete", mutation, phase: "failure" });
				assert.equal(store.project(initial), initial);
			},
		);

		await t.test(
			"a database failure restores notes, folders, and metadata together",
			async () => {
				await withDatabase(
					() =>
						databaseFor().sql.exec(
							"CREATE TRIGGER fail_folder_delete BEFORE DELETE ON directories BEGIN SELECT RAISE(ABORT, 'injected deletion failure'); END",
						),
					true,
				);
				await assert.rejects(
					deleteOrbitFolder(input),
					/injected deletion failure/,
				);
				await withDatabase(
					() => databaseFor().sql.exec("DROP TRIGGER fail_folder_delete"),
					true,
				);
				const restored = await getOrbitSnapshot();
				assert.deepEqual(restored.items, initial.items);
				assert.deepEqual(restored.folders, initial.folders);
				assert.deepEqual(restored.treeOrder, initial.treeOrder);
			},
		);

		await t.test(
			"successful deletion clears saved-note overlays, metadata and malformed documents",
			async () => {
				const store = new OptimisticItems();
				const edited = await updateOrbitNote(note.id, {
					title: note.title,
					body: "방금 저장",
					tags: [],
				});
				assert.ok(edited);
				store.acknowledge(edited);
				const mutation: OrbitMutation = { action: "delete-folder", input };
				store.start("delete", mutation, initial);
				const result = await deleteOrbitFolder(input);
				store.finish({
					requestId: "delete",
					mutation,
					phase: "success",
					result,
				});
				store.reconcile(initial);
				assert.equal(store.project(initial).items.length, 2);
				assert.equal(
					store.project(initial).folders.project.find((f) => f.slug === "부모")
						?.descendantCount,
					1,
				);
				const refreshed = await getOrbitSnapshot();
				store.reconcile(refreshed);
				assert.equal(store.project(refreshed), refreshed);
				assert.deepEqual(
					new Set(refreshed.items.map((item) => item.id)),
					new Set([sibling.id, otherSpace.id]),
				);
				assert.ok(
					!refreshed.folders.project.some(
						(f) =>
							f.slug === folder.slug || f.slug.startsWith(`${folder.slug}/`),
					),
				);
				assert.deepEqual(refreshed.treeOrder?.project?.부모, [
					`folder:${folder.slug}2`,
				]);
				await withDatabase(() => {
					assert.throws(
						() => databaseFor().read(`projects/${folder.slug}/broken.md`),
						/ENOENT/,
					);
					const metadata = databaseFor().metadata<{
						folders: { project: Record<string, unknown> };
					}>("folders");
					assert.deepEqual(Object.keys(metadata?.folders.project ?? {}), [
						`${folder.slug}2`,
					]);
				});
				closeOrbitDatabases();
				assert.deepEqual((await getOrbitSnapshot()).items, refreshed.items);
			},
		);

		await t.test(
			"legacy mixed-case names are confirmed and deleted exactly as displayed",
			async () => {
				await mkdir(path.join(vault, "projects/Legacy Folder"));
				await assert.rejects(
					deleteOrbitFolder({
						space: "project",
						path: "Legacy Folder",
						deleteContents: true,
						confirmationName: "legacy-folder",
					}),
					/정확히/,
				);
				await deleteOrbitFolder({
					space: "project",
					path: "Legacy Folder",
					deleteContents: true,
					confirmationName: "Legacy Folder",
				});
				const empty = await createOrbitFolder({
					space: "archive",
					name: "빈 폴더",
				});
				await deleteOrbitFolder({ space: "archive", path: empty.slug });
				assert.equal((await getOrbitSnapshot()).folders.archive.length, 0);
			},
		);
	} finally {
		closeOrbitDatabases();
		if (previous === undefined) delete process.env.ORBIT_VAULT_DIR;
		else process.env.ORBIT_VAULT_DIR = previous;
		await rm(vault, { recursive: true, force: true });
	}
});
