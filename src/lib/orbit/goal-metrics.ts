import type { Goal } from "./assistant-schema";
import { goalWeekStart } from "./goals";

type Metric = NonNullable<Goal["metric"]>;

// History is maintained by the server, never replaced by a UI/MCP goal patch.
export function recordGoalMeasurement(
	existing: Goal | null,
	metric: Goal["metric"],
	recordedAt: string,
) {
	const history = existing?.metricHistory ?? [];
	const before = existing?.metric;
	const changed =
		!before ||
		!metric ||
		before.current !== metric.current ||
		before.unit !== metric.unit ||
		before.measuredAt !== metric.measuredAt ||
		before.period !== metric.period ||
		before.periodStart !== metric.periodStart;
	if (!changed) return existing?.metricHistory;
	const next = [...history];
	// Preserve legacy measurements without inventing a measurement date.
	if (!next.length && before && before.current !== null) {
		next.push({
			...before,
			current: before.current,
			revision: existing.revision,
			recordedAt: existing.updatedAt,
		});
	}
	if (metric && metric.current !== null) {
		next.push({
			...metric,
			current: metric.current,
			revision: (existing?.revision ?? 0) + 1,
			recordedAt,
		});
	}
	return next.length ? next : existing?.metricHistory;
}

function periodKey(date: string, period: Metric["period"]) {
	return period === "month"
		? date.slice(0, 7)
		: period === "week"
			? goalWeekStart(date)
			: date;
}

export function goalMetricChange(goal: Goal) {
	const metric = goal.metric;
	if (!metric || metric.current === null || !metric.measuredAt) return null;
	const measuredAt = metric.measuredAt;
	const date = new Date(`${metric.periodStart ?? measuredAt}T12:00:00Z`);
	if (metric.period === "month") {
		date.setUTCDate(1);
		date.setUTCMonth(date.getUTCMonth() - 1);
	} else date.setUTCDate(date.getUTCDate() - 7);
	const previousKey = periodKey(date.toISOString().slice(0, 10), metric.period);
	const previous = [...(goal.metricHistory ?? [])]
		.reverse()
		.filter(
			(entry) =>
				entry.measuredAt &&
				entry.unit === metric.unit &&
				entry.period === metric.period,
		)
		.sort((a, b) => (b.measuredAt ?? "").localeCompare(a.measuredAt ?? ""))
		.find((entry) =>
			metric.period
				? periodKey(
						entry.periodStart ?? (entry.measuredAt as string),
						metric.period,
					) === previousKey
				: (entry.measuredAt as string) < measuredAt,
		);
	return previous
		? {
				previous: previous.current,
				previousMeasuredAt: previous.measuredAt,
				difference: metric.current - previous.current,
				period: metric.period ?? null,
			}
		: null;
}
