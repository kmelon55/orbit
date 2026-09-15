import assert from "node:assert/strict";
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { closeOrbitDatabases } from "../src/lib/orbit/database";
import * as sqlite from "../src/lib/orbit/store";

async function main() {
	const baselinePath = process.argv.slice(2).find((arg) => arg !== "--");
	const previous = process.env.ORBIT_VAULT_DIR,
		temp = mkdtempSync(path.join(os.tmpdir(), "orbit-benchmark-"));
	const notes = 1500,
		samples = 30;
	try {
		const source = path.join(temp, "source");
		mkdirSync(source);
		for (let i = 0; i < notes; i++) {
			const directory = path.join(source, "projects", `project-${i % 30}`);
			mkdirSync(directory, { recursive: true });
			writeFileSync(
				path.join(directory, `note-${String(i).padStart(5, "0")}.md`),
				`---\nid: bench-${i}\ntitle: Note ${i}\ntype: note\nspace: project\ntags: [benchmark]\ncreated: '2026-01-01T00:00:00.000Z'\nupdated: '2026-01-01T00:00:00.000Z'\n---\n${"일상 기록과 할 일을 정리하는 문서입니다. ".repeat(60)}\n`,
			);
		}
		const report: Record<string, unknown> = {
			notes,
			samples,
			node: process.version,
		};
		let baselineItems: unknown;
		for (const [name, store] of [
			...(baselinePath
				? [
						[
							"markdown",
							await import(pathToFileURL(path.resolve(baselinePath)).href),
						] as const,
					]
				: []),
			["sqlite", sqlite] as const,
		]) {
			const root = path.join(temp, name);
			cpSync(source, root, { recursive: true });
			process.env.ORBIT_VAULT_DIR = root;
			const initial = performance.now();
			const snapshot = await store.getOrbitSnapshot();
			const firstLoadMs = performance.now() - initial;
			const byId = [...snapshot.items].sort((a, b) => a.id.localeCompare(b.id));
			if (name === "markdown") baselineItems = byId;
			else if (baselineItems)
				assert.deepEqual(
					JSON.parse(JSON.stringify(byId)),
					JSON.parse(JSON.stringify(baselineItems)),
				);
			const measure = async (work: (i: number) => Promise<unknown>) => {
				const times: number[] = [];
				for (let i = 0; i < samples; i++) {
					const start = performance.now();
					await work(i);
					times.push(performance.now() - start);
				}
				times.sort((a, b) => a - b);
				return {
					medianMs: +times[Math.floor(times.length / 2)].toFixed(3),
					p95Ms: +times[Math.floor(times.length * 0.95)].toFixed(3),
				};
			};
			report[name] = {
				firstLoadMs: +firstLoadMs.toFixed(3),
				snapshot: await measure(() => store.getOrbitSnapshot()),
				singleRead: await measure(() => store.getOrbitItem("bench-500")),
				save: await measure((i) =>
					store.updateOrbitNote("bench-500", {
						title: `Saved ${i}`,
						body: `changed ${i}`,
						tags: ["benchmark"],
					}),
				),
			};
		}
		console.log(JSON.stringify(report, null, 2));
	} finally {
		closeOrbitDatabases();
		if (previous === undefined) delete process.env.ORBIT_VAULT_DIR;
		else process.env.ORBIT_VAULT_DIR = previous;
		rmSync(temp, { recursive: true, force: true });
	}
}
void main().catch((error) => {
	console.error(
		error instanceof Error ? error.message.slice(0, 1000) : String(error),
	);
	process.exitCode = 1;
});
