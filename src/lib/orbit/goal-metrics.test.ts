import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadAssistantState, mutateAssistant } from "./assistant.server";
import { type Goal, goalInputSchema } from "./assistant-schema";
import { closeOrbitDatabases } from "./database";
import { goalMetricChange, recordGoalMeasurement } from "./goal-metrics";
import { goalInput, goalPercent } from "./goals";
import { exportOrbitDirectory, importOrbitDirectory } from "./storage-transfer";

function base(metric?: Goal["metric"]): Goal {
	return {
		...goalInputSchema.parse({ title: "Profit", metric }),
		id: "goal",
		revision: 1,
		createdAt: "2026-10-17T00:00:00Z",
		updatedAt: "2026-10-17T00:00:00Z",
	};
}

test("unmeasured outcomes are distinct from zero and accept losses without affecting execution", () => {
	assert.equal(
		goalPercent(base({ current: null, target: 1000, unit: "만원" })),
		null,
	);
	assert.equal(
		goalPercent(base({ current: 0, target: 1000, unit: "만원" })),
		0,
	);
	assert.equal(
		goalPercent(base({ current: -200, target: 1000, unit: "만원" })),
		0,
	);
	assert.equal(
		goalPercent(base({ current: 600, target: 1000, unit: "만원" })),
		60,
	);
	assert.equal(
		goalPercent(base({ current: 1200, target: 1000, unit: "만원" })),
		100,
	);
	assert.throws(() =>
		goalInputSchema.parse({
			title: "Profit",
			metric: { current: null, target: 0, unit: "" },
		}),
	);
});

test("legacy measurements retain unknown dates and unrelated edits do not fabricate history", () => {
	const legacy = base({ current: 600, target: 1000, unit: "만원" });
	assert.equal(
		recordGoalMeasurement(legacy, legacy.metric, "2026-10-18T00:00:00Z"),
		undefined,
	);
	assert.ok(legacy.metric);
	const history = recordGoalMeasurement(
		legacy,
		{ ...legacy.metric, current: -100, measuredAt: "2026-10-18" },
		"2026-10-18T00:00:00Z",
	);
	assert.ok(history);
	assert.equal(history.length, 2);
	assert.equal(history[0].current, 600);
	assert.equal(history[0].measuredAt, undefined);
	assert.equal(history[1].current, -100);
	assert.equal(history[1].measuredAt, "2026-10-18");
	const goal = { ...legacy, metricHistory: history };
	assert.equal("metricHistory" in goalInput(goal), false);
	assert.deepEqual(
		recordGoalMeasurement(goal, undefined, "2026-10-19T00:00:00Z"),
		history,
	);
});

test("period changes use the previous reporting period, preserve corrections and never compare different units", () => {
	let goal = base({
		current: 300,
		target: 1000,
		unit: "만원",
		period: "month",
		periodStart: "2026-11-01",
		measuredAt: "2026-12-03",
	});
	goal.metricHistory = recordGoalMeasurement(null, goal.metric, goal.updatedAt);
	assert.ok(goal.metric);
	const correction = { ...goal.metric, current: 400 };
	goal = {
		...goal,
		revision: 2,
		metric: correction,
		metricHistory: recordGoalMeasurement(
			goal,
			correction,
			"2026-12-04T00:00:00Z",
		),
	};
	const december = {
		...correction,
		current: 600,
		periodStart: "2026-12-01",
		measuredAt: "2027-01-03",
	};
	goal = {
		...goal,
		revision: 3,
		metric: december,
		metricHistory: recordGoalMeasurement(
			goal,
			december,
			"2027-01-03T00:00:00Z",
		),
	};
	assert.equal(goalMetricChange(goal)?.difference, 200);
	assert.equal(goal.metricHistory?.length, 3);
	assert.equal(
		goalMetricChange({ ...goal, metric: { ...december, unit: "USD" } }),
		null,
	);
	assert.equal(
		goalMetricChange({
			...goal,
			metric: { ...december, periodStart: "2027-02-01" },
		}),
		null,
	);
	const weekly = base({
		current: -10,
		target: 100,
		unit: "원",
		period: "week",
		periodStart: "2027-01-03",
		measuredAt: "2027-01-11",
	});
	weekly.metricHistory = [
		{
			current: -20,
			target: 100,
			unit: "원",
			period: "week",
			periodStart: "2026-12-27",
			measuredAt: "2027-01-04",
			revision: 1,
			recordedAt: "2027-01-04T00:00:00Z",
		},
	];
	assert.equal(goalMetricChange(weekly)?.difference, 10);
});

test("measurements append once, survive clearing, reject stale writes and round-trip through export", async () => {
	const previous = process.env.ORBIT_VAULT_DIR;
	const parent = mkdtempSync(path.join(os.tmpdir(), "orbit-metric-"));
	process.env.ORBIT_VAULT_DIR = path.join(parent, "vault");
	try {
		const save = async (input: Parameters<typeof goalInputSchema.parse>[0]) =>
			(
				await mutateAssistant({
					action: "goal",
					input: goalInputSchema.parse(input),
				})
			).goals[0];
		let goal = await save({
			title: "Profit",
			metric: { current: null, target: 1000, unit: "만원" },
		});
		assert.equal(goal.metricHistory, undefined);
		goal = await save({
			...goalInput(goal),
			metric: { ...goal.metric, current: 0, measuredAt: "2026-10-17" },
		});
		assert.equal(goal.metricHistory?.length, 1);
		const stale = goalInput(goal);
		goal = await save({ ...goalInput(goal), title: "Monthly profit" });
		assert.equal(goal.metricHistory?.length, 1);
		await assert.rejects(
			save({ ...stale, metric: { ...goal.metric, current: 999 } }),
			/변경/,
		);
		goal = await save({
			...goalInput(goal),
			metric: { ...goal.metric, current: -20, measuredAt: "2026-10-18" },
		});
		assert.equal(goal.metricHistory?.length, 2);
		goal = await save({ ...goalInput(goal), metric: undefined });
		assert.equal(goal.metricHistory?.length, 2);
		await exportOrbitDirectory(path.join(parent, "export"));
		closeOrbitDatabases();
		process.env.ORBIT_VAULT_DIR = path.join(parent, "restored");
		await importOrbitDirectory(path.join(parent, "export"));
		assert.deepEqual((await loadAssistantState()).goals[0], goal);
	} finally {
		closeOrbitDatabases();
		if (previous === undefined) delete process.env.ORBIT_VAULT_DIR;
		else process.env.ORBIT_VAULT_DIR = previous;
		rmSync(parent, { recursive: true, force: true });
	}
});
