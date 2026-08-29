import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createOrbitItem, fileOrbitItem } from "./store";

test("notes can be converted to tasks and events without losing content", async () => {
	const previousVault = process.env.ORBIT_VAULT_DIR;
	const vault = await mkdtemp(path.join(os.tmpdir(), "orbit-store-"));
	process.env.ORBIT_VAULT_DIR = vault;

	try {
		const taskNote = await createOrbitItem({
			title: "정리할 메모",
			body: "본문은 그대로 남아야 한다.",
			type: "note",
			space: "inbox",
		});
		assert.ok(taskNote);
		const task = await fileOrbitItem(taskNote.id, {
			type: "task",
			space: "inbox",
			due: "2026-08-30T09:30:00",
		});
		assert.ok(task);

		assert.equal(task.type, "task");
		assert.equal(task.space, "inbox");
		assert.equal(task.status, "open");
		assert.equal(task.due, "2026-08-30T09:30:00");
		assert.equal(task.body, "본문은 그대로 남아야 한다.");

		const eventNote = await createOrbitItem({
			title: "일정으로 만들 메모",
			body: "장소와 준비물",
			type: "note",
			space: "inbox",
		});
		assert.ok(eventNote);
		const event = await fileOrbitItem(eventNote.id, {
			type: "event",
			space: "event",
			start: "2026-08-31T14:00:00",
			end: "2026-08-31T15:00:00",
		});
		assert.ok(event);

		assert.equal(event.type, "event");
		assert.equal(event.space, "event");
		assert.equal(event.start, "2026-08-31T14:00:00");
		assert.equal(event.end, "2026-08-31T15:00:00");
		assert.equal(event.body, "장소와 준비물");
	} finally {
		if (previousVault === undefined) delete process.env.ORBIT_VAULT_DIR;
		else process.env.ORBIT_VAULT_DIR = previousVault;
		await rm(vault, { recursive: true, force: true });
	}
});
