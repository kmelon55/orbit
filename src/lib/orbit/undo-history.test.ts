import assert from "node:assert/strict";
import test from "node:test";
import { UndoHistory } from "./undo-history";

test("undo runs in reverse order and a toast can undo a specific independent move", async () => {
	const history = new UndoHistory();
	const results: string[] = [];
	for (const id of ["first", "second", "third"])
		history.push({
			id,
			undo: async () => {
				results.push(id);
			},
		});
	await history.undo("second");
	await history.undo();
	await history.undo();
	assert.deepEqual(results, ["second", "third", "first"]);
	assert.equal(history.latest, undefined);
});

test("failed undo remains retryable, rapid shortcuts cannot replay a pending undo", async () => {
	const history = new UndoHistory();
	let finish: (() => void) | undefined;
	let calls = 0;
	let fail = true;
	history.push({
		id: "move",
		undo: async () => {
			calls++;
			if (fail) throw new Error("save failed");
			await new Promise<void>((resolve) => {
				finish = resolve;
			});
		},
	});
	await assert.rejects(history.undo(), /save failed/);
	assert.equal(history.latest?.id, "move");
	fail = false;
	const pending = history.undo();
	assert.equal(await history.undo(), undefined);
	assert.equal(calls, 2);
	finish?.();
	await pending;
	assert.equal(history.latest, undefined);
});
