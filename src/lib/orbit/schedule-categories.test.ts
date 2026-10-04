import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { closeOrbitDatabases, databaseFor } from "./database";
import { parseItem } from "./documents";
import { itemColor } from "./item-colors";
import { calendarSearch } from "./navigation-search";
import { OptimisticItems } from "./optimistic-mutations";
import {
	DEFAULT_SCHEDULE_CATEGORIES,
	visibleScheduleCategory,
} from "./schedule-categories";
import {
	type OrbitMutation,
	type OrbitSnapshot,
	scheduleCategorySchema,
} from "./schema";
import { exportOrbitDirectory, importOrbitDirectory } from "./storage-transfer";
import {
	archiveOrbitItem,
	createOrbitItem,
	fileOrbitItem,
	getOrbitItem,
	getOrbitSnapshot,
	saveScheduleCategory,
	undoOrbitMutation,
	updateOrbitNote,
	withItemUndo,
} from "./store";

test("event categories survive edits, rescheduling, archiving, restart, and reset; legacy items stay uncategorized", async () => {
	const previous = process.env.ORBIT_VAULT_DIR;
	const root = mkdtempSync(path.join(os.tmpdir(), "orbit-categories-"));
	process.env.ORBIT_VAULT_DIR = root;
	try {
		const legacy = await createOrbitItem({
			title: "Existing",
			body: "",
			type: "event",
			space: "event",
			start: "2026-10-04",
		});
		const item = await createOrbitItem({
			title: "Meeting",
			body: "Memo",
			type: "event",
			space: "event",
			start: "2026-10-04T09:00:00",
			category: "business",
		});
		assert.ok(item);
		assert.equal(legacy?.category, undefined);
		const task = await createOrbitItem({
			title: "Proposal",
			body: "",
			type: "task",
			space: "inbox",
			due: "2026-10-04",
			category: "business",
		});
		assert.ok(task);
		assert.equal(
			(await fileOrbitItem(task.id, { space: "inbox", due: "2026-10-05" }))
				?.category,
			"business",
		);
		closeOrbitDatabases();
		assert.equal((await getOrbitItem(task.id))?.category, "business");
		assert.match(databaseFor().byId(item.id)?.raw ?? "", /category: business/);
		assert.equal(
			(
				await updateOrbitNote(item.id, {
					title: item.title,
					body: "Updated",
					tags: [],
				})
			)?.category,
			"business",
		);
		assert.equal(
			(
				await fileOrbitItem(item.id, {
					space: "event",
					start: "2026-10-05T09:00:00",
				})
			)?.category,
			"business",
		);
		assert.equal((await archiveOrbitItem(item.id))?.category, "business");
		closeOrbitDatabases();
		assert.equal((await getOrbitItem(item.id))?.category, "business");
		const mutation: OrbitMutation = {
			action: "file-item",
			id: item.id,
			input: { space: "archive", category: "personal" },
		};
		const changed = await withItemUndo(mutation, () =>
			fileOrbitItem(item.id, mutation.input),
		);
		assert.ok(changed.undo);
		assert.equal(
			(await undoOrbitMutation(changed.undo.id)).item?.category,
			"business",
		);
		assert.equal(
			(await fileOrbitItem(item.id, { space: "archive", category: null }))
				?.category,
			undefined,
		);
		assert.doesNotMatch(databaseFor().byId(item.id)?.raw ?? "", /^category:/m);
	} finally {
		closeOrbitDatabases();
		if (previous === undefined) delete process.env.ORBIT_VAULT_DIR;
		else process.env.ORBIT_VAULT_DIR = previous;
		rmSync(root, { recursive: true, force: true });
	}
});

test("category names and colors persist, export and import preserve references, and import conflicts keep existing data", async () => {
	const previous = process.env.ORBIT_VAULT_DIR;
	const parent = mkdtempSync(
		path.join(os.tmpdir(), "orbit-category-transfer-"),
	);
	process.env.ORBIT_VAULT_DIR = path.join(parent, "source");
	try {
		assert.deepEqual(
			(await getOrbitSnapshot()).scheduleCategories,
			DEFAULT_SCHEDULE_CATEGORIES,
		);
		await saveScheduleCategory({
			id: "business",
			name: "업무",
			color: "violet",
		});
		await saveScheduleCategory({ id: "family", name: "가족", color: "pink" });
		await assert.rejects(
			saveScheduleCategory({ id: "other", name: "가족", color: "blue" }),
			/같은 이름/,
		);
		const item = await createOrbitItem({
			title: "Family",
			body: "",
			type: "event",
			space: "event",
			start: "2026-10-04",
			category: "family",
		});
		assert.ok(item);
		closeOrbitDatabases();
		const categories = (await getOrbitSnapshot()).scheduleCategories;
		assert.equal(
			categories?.find((entry) => entry.id === "business")?.name,
			"업무",
		);
		assert.equal(
			categories?.find((entry) => entry.id === "business")?.color,
			"violet",
		);
		const exported = path.join(parent, "exported");
		await exportOrbitDirectory(exported);
		process.env.ORBIT_VAULT_DIR = path.join(parent, "imported");
		await importOrbitDirectory(exported);
		assert.deepEqual((await getOrbitSnapshot()).scheduleCategories, categories);
		assert.equal((await getOrbitItem(item.id))?.category, "family");
		await saveScheduleCategory({ id: "family", name: "가족", color: "red" });
		await assert.rejects(
			importOrbitDirectory(exported),
			/Import conflicts with schedule category/,
		);
		assert.equal(
			(await getOrbitSnapshot()).scheduleCategories?.find(
				(entry) => entry.id === "family",
			)?.color,
			"red",
		);
		process.env.ORBIT_VAULT_DIR = exported;
		assert.deepEqual((await getOrbitSnapshot()).scheduleCategories, categories);
	} finally {
		closeOrbitDatabases();
		if (previous === undefined) delete process.env.ORBIT_VAULT_DIR;
		else process.env.ORBIT_VAULT_DIR = previous;
		rmSync(parent, { recursive: true, force: true });
	}
});

test("calendar filter URLs restore multiple hidden categories across tasks and events and tolerate malformed input", () => {
	const search = calendarSearch({
		hiddenCategories: ["business", "business", "uncategorized", "bad.class", 3],
	});
	assert.deepEqual(search.hiddenCategories, ["business", "uncategorized"]);
	assert.equal(
		visibleScheduleCategory(
			{ type: "event", category: "business" },
			search.hiddenCategories ?? [],
		),
		false,
	);
	assert.equal(
		visibleScheduleCategory({ type: "event" }, search.hiddenCategories ?? []),
		false,
	);
	assert.equal(
		visibleScheduleCategory(
			{ type: "event", category: "personal" },
			search.hiddenCategories ?? [],
		),
		true,
	);
	assert.equal(
		visibleScheduleCategory(
			{ type: "task", category: "business" },
			search.hiddenCategories ?? [],
		),
		false,
	);
	assert.equal(
		calendarSearch({ hiddenCategories: "business" }).hiddenCategories,
		undefined,
	);
	assert.equal(
		scheduleCategorySchema.safeParse({
			id: "uncategorized",
			name: "Test",
			color: "blue",
		}).success,
		false,
	);
	assert.match(
		itemColor({ type: "event", category: "business" }).surface,
		/orbit-category-business-surface/,
	);
	assert.match(
		itemColor({ type: "task", category: "business" }).surface,
		/orbit-category-business-surface/,
	);
	assert.equal(itemColor({ type: "task" }).surface, "orbit-task-surface");
	assert.equal(
		visibleScheduleCategory(
			{ type: "task", category: "personal" },
			search.hiddenCategories ?? [],
		),
		true,
	);
	assert.equal(
		parseItem(
			"---\nid: old\ntitle: Old\ntype: event\ncategory: invalid.css\n---\n",
			"events/old.md",
			"2026-01-01",
			"2026-01-01",
		)?.category,
		undefined,
	);
});

test("optimistic category edits roll back to the preceding saved value and reconcile without losing pending edits", () => {
	const source = {
		items: [],
		scheduleCategories: DEFAULT_SCHEDULE_CATEGORIES,
		today: { tasks: [], events: [] },
		counts: {},
		folders: {},
	} as unknown as OrbitSnapshot;
	const store = new OptimisticItems();
	const first: OrbitMutation = {
		action: "save-schedule-category",
		input: { id: "business", name: "업무", color: "violet" },
	};
	const second: OrbitMutation = {
		action: "save-schedule-category",
		input: { id: "business", name: "회사", color: "red" },
	};
	store.start("first", first, source);
	store.start("second", second, source);
	store.finish({
		requestId: "first",
		mutation: first,
		phase: "success",
		result: first.input,
	});
	assert.equal(store.project(source).scheduleCategories?.[0].name, "회사");
	store.finish({ requestId: "second", mutation: second, phase: "failure" });
	assert.equal(store.project(source).scheduleCategories?.[0].name, "업무");
	const refreshed = {
		...source,
		scheduleCategories: [first.input, DEFAULT_SCHEDULE_CATEGORIES[1]],
	};
	store.reconcile(refreshed);
	assert.equal(store.project(refreshed), refreshed);
});
