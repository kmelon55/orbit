import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { type EditableItemType, itemEditorInput } from "./item-editor";
import { OptimisticItems } from "./optimistic-mutations";
import type { OrbitMutation } from "./schema";
import {
	createOrbitFolder,
	createOrbitItem,
	fileOrbitItem,
	getOrbitSnapshot,
	toggleOrbitTask,
	updateOrbitNote,
} from "./store";

test("editor conversions persist edits and preserve identity in every direction", async () => {
	const previousVault = process.env.ORBIT_VAULT_DIR;
	const vault = await mkdtemp(path.join(os.tmpdir(), "orbit-item-editor-"));
	process.env.ORBIT_VAULT_DIR = vault;
	try {
		await createOrbitFolder({ space: "project", name: "전환 테스트" });
		const types: EditableItemType[] = ["note", "task", "event"];
		for (const source of types) {
			for (const target of types.filter((type) => type !== source)) {
				const created = await createOrbitItem({
					type: source,
					title: `${source} → ${target}`,
					body: "## 원본\n\n- [ ] 준비물\n\n[참고](https://example.com)",
					space: source === "event" ? "event" : "project",
					folder: source === "event" ? undefined : "전환 테스트",
					color: "violet",
					category: "personal",
					start: source === "event" ? "2026-10-07T23:30:00" : undefined,
					end: source === "event" ? "2026-10-08T00:30:00" : undefined,
					due: source === "task" ? "2026-10-07" : undefined,
				});
				assert.ok(created);
				await updateOrbitNote(created.id, {
					title: created.title,
					body: created.body,
					tags: ["보존"],
				});
				if (source === "task") await toggleOrbitTask(created.id);
				const before = await getOrbitSnapshot();
				const item = before.items.find((entry) => entry.id === created.id);
				assert.ok(item);
				const title = `${created.title} 확인 완료`;
				const body = `${created.body}\n\n추가한 메모`;
				const input = itemEditorInput(item, {
					type: target,
					title,
					body,
					category: item.category,
					start: "2026-10-09T23:30:00",
					end: "2026-10-10T00:30:00",
					due: "2026-10-09T23:30:00",
				});
				const mutation: OrbitMutation = {
					action: "file-item",
					id: item.id,
					input,
				};
				const optimistic = new OptimisticItems();
				optimistic.start("convert", mutation, before);
				const preview = optimistic
					.project(before)
					.items.find((entry) => entry.id === item.id);
				assert.ok(preview);
				// Failed writes restore the source, including its original text and dates.
				optimistic.finish({ requestId: "convert", mutation, phase: "failure" });
				assert.deepEqual(
					optimistic
						.project(before)
						.items.find((entry) => entry.id === item.id),
					item,
				);

				const saved = await fileOrbitItem(item.id, input);
				assert.ok(saved);
				assert.equal(saved.id, created.id);
				assert.equal(saved.created, created.created);
				assert.equal(saved.title, title);
				assert.equal(saved.body, body);
				assert.equal(saved.type, target);
				assert.equal(saved.color, "violet");
				assert.equal(saved.category, "personal");
				assert.deepEqual(saved.tags, ["보존"]);
				assert.equal(saved.status, target === "task" ? "open" : undefined);
				assert.equal(saved.completedAt, undefined);
				assert.equal(saved.start, target === "note" ? undefined : input.start);
				assert.equal(saved.end, target === "note" ? undefined : input.end);
				assert.equal(saved.due, target === "task" ? input.due : undefined);
				assert.equal(
					saved.space,
					target === "event"
						? "event"
						: source === "event"
							? "inbox"
							: "project",
				);
				assert.equal(
					saved.folder,
					target === "event" || source === "event" ? undefined : item.folder,
				);
				for (const key of [
					"title",
					"body",
					"type",
					"space",
					"folder",
					"start",
					"end",
					"due",
					"status",
					"completedAt",
				] as const) {
					assert.equal(
						preview[key],
						saved[key],
						`optimistic ${source} → ${target}: ${key}`,
					);
				}
				const after = await getOrbitSnapshot();
				assert.deepEqual(
					after.items.filter((entry) => entry.id === item.id),
					[saved],
				);
			}
		}
	} finally {
		if (previousVault === undefined) delete process.env.ORBIT_VAULT_DIR;
		else process.env.ORBIT_VAULT_DIR = previousVault;
		await rm(vault, { recursive: true, force: true });
	}
});

test("a task with no chosen date stays unscheduled", () => {
	const input = itemEditorInput(undefined, {
		type: "task",
		title: "언젠가",
		body: "메모",
	});
	assert.equal(input.space, "inbox");
	assert.equal(input.start, null);
	assert.equal(input.end, null);
	assert.equal(input.due, null);
});
