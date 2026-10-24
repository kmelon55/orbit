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

test("display names survive rename, color, reload and tree moves without changing identity", async () => {
	const { updateOrbitFolder, moveOrbitTreeEntry, deleteOrbitFolder } =
		await import("./store");
	const { folderMutationObserved, projectFolderMutation } = await import(
		"./optimistic-folders"
	);
	const { folderDisplayPath, flattenFolderTree, indexFolderTree } =
		await import("./folder-tree");
	const previous = process.env.ORBIT_VAULT_DIR;
	const vault = await mkdtemp(path.join(os.tmpdir(), "orbit-folder-label-"));
	process.env.ORBIT_VAULT_DIR = vault;
	try {
		const created = await createOrbitFolder({
			space: "project",
			name: "개발 자료·설계",
		});
		assert.equal(created.name, "개발 자료·설계");
		assert.equal(created.slug, "개발-자료-설계");
		const item = await createOrbitItem({
			title: "원본",
			type: "note",
			space: "project",
			folder: created.slug,
			body: "원문 그대로",
		});
		const before = await getOrbitSnapshot();
		const mutation = {
			action: "update-folder" as const,
			input: {
				space: "project" as const,
				path: created.slug,
				displayName: "개발·설계 자료",
			},
		};
		const optimistic = projectFolderMutation(before, mutation);
		assert.equal(
			optimistic.folders.project.find((f) => f.slug === created.slug)?.name,
			mutation.input.displayName,
		);
		assert.equal(folderMutationObserved(before, mutation), false);
		await updateOrbitFolder(mutation.input);
		await updateOrbitFolder({
			space: "project",
			path: created.slug,
			color: "blue",
		});
		closeOrbitDatabases();
		const renamed = await getOrbitSnapshot();
		assert.equal(folderMutationObserved(renamed, mutation), true);
		assert.deepEqual(
			renamed.items.find((i) => i.id === item?.id),
			before.items.find((i) => i.id === item?.id),
		);
		assert.equal(
			folderDisplayPath(renamed.folders.project, created.slug),
			"개발·설계 자료",
		);
		assert.equal(
			flattenFolderTree(
				indexFolderTree([], renamed.folders.project),
				new Set(),
				"개발·설계 자료",
			).length,
			1,
		);
		const reused = await createOrbitFolder({
			space: "project",
			name: "개발·설계 자료",
		});
		assert.equal(reused.slug, created.slug);
		assert.equal(reused.name, "개발·설계 자료");
		const parent = await createOrbitFolder({
			space: "project",
			name: "Nexit Cloud",
		});
		await assert.rejects(
			updateOrbitFolder({
				space: "project",
				path: parent.slug,
				displayName: "개발·설계 자료",
			}),
			/같은 이름/,
		);
		await moveOrbitTreeEntry({
			space: "project",
			key: `folder:${created.slug}`,
			target: `folder:${parent.slug}`,
			position: "inside",
		});
		const moved = await getOrbitSnapshot();
		const slug = `${parent.slug}/${created.slug}`;
		assert.equal(
			moved.folders.project.find((f) => f.slug === slug)?.name,
			"개발·설계 자료",
		);
		assert.equal(moved.items.find((i) => i.id === item?.id)?.folder, slug);
		assert.equal(
			folderDisplayPath(moved.folders.project, slug),
			"Nexit Cloud / 개발·설계 자료",
		);
		const cross = {
			action: "update-folder" as const,
			input: {
				space: "project" as const,
				path: slug,
				destinationSpace: "resource" as const,
				parent: "",
			},
		};
		const projected = projectFolderMutation(moved, cross);
		await updateOrbitFolder(cross.input);
		const archived = await getOrbitSnapshot();
		assert.equal(
			archived.folders.resource.find((f) => f.slug === created.slug)?.name,
			"개발·설계 자료",
		);
		assert.equal(
			projected.folders.resource.find((f) => f.slug === created.slug)?.name,
			"개발·설계 자료",
		);
		await assert.rejects(
			deleteOrbitFolder({
				space: "resource",
				path: created.slug,
				deleteContents: true,
				confirmationName: created.slug,
			}),
			/정확히/,
		);
		await deleteOrbitFolder({
			space: "resource",
			path: created.slug,
			deleteContents: true,
			confirmationName: "개발·설계 자료",
		});
		assert.equal((await getOrbitSnapshot()).items.length, 0);
	} finally {
		closeOrbitDatabases();
		if (previous === undefined) delete process.env.ORBIT_VAULT_DIR;
		else process.env.ORBIT_VAULT_DIR = previous;
		await rm(vault, { recursive: true, force: true });
	}
});
