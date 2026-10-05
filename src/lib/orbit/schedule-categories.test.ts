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
	assert.match(
		itemColor({ type: "task" }).surface,
		/orbit-category-uncategorized-surface/,
	);
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

test("uncategorized name and color persist independently of item membership, transfer, and reconcile optimistic edits", async () => {
	const previous = process.env.ORBIT_VAULT_DIR;
	const parent = mkdtempSync(path.join(os.tmpdir(), "orbit-uncategorized-"));
	process.env.ORBIT_VAULT_DIR = path.join(parent, "source");
	try {
		const source = await getOrbitSnapshot();
		assert.equal(source.uncategorizedScheduleName, "미분류");
		assert.equal(source.uncategorizedScheduleColor, "slate");
		const item = await createOrbitItem({
			title: "Uncategorized",
			type: "task",
			space: "event",
			body: "",
			due: "2026-10-05",
		});
		assert.ok(item);
		const mutation: OrbitMutation = {
			action: "save-schedule-category",
			input: { id: "uncategorized", name: "기본 일정", color: "pink" },
		};
		const optimistic = new OptimisticItems();
		optimistic.start("first", mutation, source);
		assert.equal(
			optimistic.project(source).uncategorizedScheduleName,
			"기본 일정",
		);
		assert.equal(optimistic.project(source).uncategorizedScheduleColor, "pink");
		assert.deepEqual(
			optimistic.project(source).scheduleCategories,
			source.scheduleCategories,
		);
		optimistic.finish({ requestId: "first", mutation, phase: "success" });
		optimistic.start(
			"second",
			{
				...mutation,
				input: { ...mutation.input, name: "새 이름", color: "blue" },
			},
			source,
		);
		assert.equal(optimistic.project(source).uncategorizedScheduleColor, "blue");
		assert.equal(
			optimistic.project(source).uncategorizedScheduleName,
			"새 이름",
		);
		optimistic.finish({ requestId: "second", mutation, phase: "failure" });
		assert.equal(optimistic.project(source).uncategorizedScheduleColor, "pink");
		assert.equal(
			optimistic.project(source).uncategorizedScheduleName,
			"기본 일정",
		);
		await saveScheduleCategory(mutation.input);
		closeOrbitDatabases();
		const saved = await getOrbitSnapshot();
		assert.equal(saved.uncategorizedScheduleName, "기본 일정");
		assert.equal(saved.uncategorizedScheduleColor, "pink");
		assert.deepEqual(saved.scheduleCategories, DEFAULT_SCHEDULE_CATEGORIES);
		assert.equal((await getOrbitItem(item.id))?.category, undefined);
		assert.equal(
			scheduleCategorySchema.safeParse(mutation.input).success,
			false,
		);
		await assert.rejects(
			saveScheduleCategory({
				id: "uncategorized",
				name: "  ",
				color: "red",
			}),
		);
		await assert.rejects(
			saveScheduleCategory({ id: "other", name: "기본 일정", color: "red" }),
		);
		await assert.rejects(
			saveScheduleCategory({
				...mutation.input,
				name: DEFAULT_SCHEDULE_CATEGORIES[0].name,
			}),
		);
		// A refresh with the right color but an old name must keep the pending name.
		optimistic.reconcile({ ...saved, uncategorizedScheduleName: "미분류" });
		assert.equal(
			optimistic.project(source).uncategorizedScheduleName,
			"기본 일정",
		);
		optimistic.reconcile(saved);
		assert.equal(
			optimistic.project({ ...saved, uncategorizedScheduleName: "다른 기기" })
				.uncategorizedScheduleName,
			"다른 기기",
		);
		assert.equal(
			optimistic.project({ ...saved, uncategorizedScheduleColor: "cyan" })
				.uncategorizedScheduleColor,
			"cyan",
		);
		const exported = path.join(parent, "exported");
		await exportOrbitDirectory(exported);
		process.env.ORBIT_VAULT_DIR = path.join(parent, "imported");
		await importOrbitDirectory(exported);
		assert.equal(
			(await getOrbitSnapshot()).uncategorizedScheduleName,
			"기본 일정",
		);
		assert.equal((await getOrbitSnapshot()).uncategorizedScheduleColor, "pink");
		await saveScheduleCategory({
			...mutation.input,
			name: "내 기본 일정",
			color: "cyan",
		});
		await importOrbitDirectory(exported);
		assert.equal((await getOrbitSnapshot()).uncategorizedScheduleColor, "cyan");
		assert.equal(
			(await getOrbitSnapshot()).uncategorizedScheduleName,
			"내 기본 일정",
		);
		// The original label becomes available once the default calendar is renamed.
		await saveScheduleCategory({ id: "other", name: "미분류", color: "red" });
	} finally {
		closeOrbitDatabases();
		if (previous === undefined) delete process.env.ORBIT_VAULT_DIR;
		else process.env.ORBIT_VAULT_DIR = previous;
		rmSync(parent, { recursive: true, force: true });
	}
});
