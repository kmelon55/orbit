import assert from "node:assert/strict";
import test from "node:test";
import { createRefreshQueue } from "./refresh-queue";

test("burst refreshes share one read, and writes during that read request one follow-up", async () => {
	const reads: Array<(value: number) => void> = [];
	const committed: number[] = [];
	const refresh = createRefreshQueue(
		() => new Promise<number>((resolve) => reads.push(resolve)),
		(value) => committed.push(value),
	);
	const first = refresh();
	assert.equal(refresh(), first);
	await Promise.resolve();
	assert.equal(reads.length, 1);
	assert.equal(refresh(), first);
	assert.equal(refresh(), first);
	reads[0](1);
	await Promise.resolve();
	assert.equal(reads.length, 2);
	reads[1](2);
	await first;
	assert.deepEqual(committed, [1, 2]);
});

test("a failed refresh does not wedge later reads or commit an invalid snapshot", async () => {
	let fail = true;
	const values: string[] = [];
	const refresh = createRefreshQueue(
		async () => {
			if (fail) throw new Error("offline");
			return "fresh";
		},
		(value) => values.push(value),
	);
	await assert.rejects(refresh(), /offline/);
	fail = false;
	await refresh();
	assert.deepEqual(values, ["fresh"]);
});
