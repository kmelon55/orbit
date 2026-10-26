import assert from "node:assert/strict";
import test from "node:test";
import { createChunkRecovery, isChunkLoadError } from "./chunk-recovery";

function fixture() {
	const values = new Map<string, string>();
	let reloads = 0;
	let probes = 0;
	const options = {
		entry: "/assets/index-old.js",
		storage: {
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => {
				values.set(key, value);
			},
		},
		canReload: () => true,
		probe: async () => {
			probes++;
			return true;
		},
		reload: () => {
			reloads++;
		},
		now: () => 100_000,
	};
	return { options, values, counts: () => ({ reloads, probes }) };
}

test("recognizes browser chunk failures without treating application errors as stale assets", () => {
	for (const message of [
		"Failed to fetch dynamically imported module: https://orbit.test/assets/a.js",
		"error loading dynamically imported module: https://orbit.test/assets/a.js",
		"Importing a module script failed.",
		"Loading chunk 4 failed.",
		"Unable to preload CSS for /assets/a.css",
	])
		assert.equal(isChunkLoadError(new TypeError(message)), true, message);
	for (const message of [
		"Failed to fetch",
		"Save failed",
		"Cannot read properties of undefined",
	])
		assert.equal(isChunkLoadError(new Error(message)), false, message);
});

test("concurrent failures reload only once and the guard survives a full navigation", async () => {
	const f = fixture();
	const recover = createChunkRecovery(f.options);
	assert.deepEqual(await Promise.all([recover(), recover(), recover()]), [
		true,
		true,
		true,
	]);
	assert.deepEqual(f.counts(), { reloads: 1, probes: 1 });
	assert.equal(await createChunkRecovery(f.options)(), false);
	assert.deepEqual(f.counts(), { reloads: 1, probes: 1 });
	assert.equal(
		await createChunkRecovery({
			...f.options,
			entry: "/assets/index-new.js",
		})(),
		false,
	);
	assert.equal(
		await createChunkRecovery({
			...f.options,
			entry: "/assets/index-new.js",
			now: () => 160_001,
		})(),
		true,
	);
});

test("editing, offline state, an unreachable document and unavailable storage never force reload", async () => {
	const f = fixture();
	assert.equal(
		await createChunkRecovery({ ...f.options, canReload: () => false })(),
		false,
	);
	assert.equal(await createChunkRecovery({ ...f.options, entry: "" })(), false);
	assert.equal(
		await createChunkRecovery({ ...f.options, probe: async () => false })(),
		false,
	);
	assert.equal(
		await createChunkRecovery({
			...f.options,
			probe: async () => {
				throw new Error("offline");
			},
		})(),
		false,
	);
	assert.equal(
		await createChunkRecovery({
			...f.options,
			storage: {
				...f.options.storage,
				setItem: () => {
					throw new Error("disabled");
				},
			},
		})(),
		false,
	);
	assert.equal(f.counts().reloads, 0);
});

test("input arriving while a recovery probe is in flight prevents data loss", async () => {
	const f = fixture();
	let safe = true;
	const recover = createChunkRecovery({
		...f.options,
		canReload: () => safe,
		probe: async () => {
			safe = false;
			return true;
		},
	});
	assert.equal(await recover(), false);
	assert.equal(f.counts().reloads, 0);
	assert.equal(f.values.size, 0);
});
