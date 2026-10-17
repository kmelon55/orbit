import type { Goal } from "#/lib/orbit/assistant-schema";
import { goalMetricChange } from "#/lib/orbit/goal-metrics";
import { goalPercent } from "#/lib/orbit/goals";
import { useI18n } from "./locale-provider";

export function GoalMetricSummary({ goal }: { goal: Goal }) {
	const { t } = useI18n();
	const metric = goal.metric;
	if (!metric) return <span className="text-muted-foreground">—</span>;
	const percent = goalPercent(goal);
	return (
		<span className="block min-w-0 tabular-nums">
			<span
				className="block truncate"
				title={`${metric.current ?? t("미측정")} / ${metric.target} ${metric.unit}`}
			>
				{metric.current === null
					? t("미측정")
					: metric.current.toLocaleString()}{" "}
				/ {metric.target.toLocaleString()} {metric.unit}
			</span>
			<span className="mt-1 block text-[11px] font-normal text-muted-foreground">
				{percent === null
					? t("성과 달성률 —")
					: t("성과 달성률 {0}%", [Math.round(percent)])}
			</span>
			{metric.period ? (
				<span className="mt-1 block text-[11px] font-normal text-muted-foreground">
					{t(metric.period === "month" ? "월간 실적" : "주간 실적")}
					{metric.periodStart
						? ` · ${metric.period === "month" ? metric.periodStart.slice(0, 7) : metric.periodStart}`
						: ""}
				</span>
			) : null}

			{metric.current !== null ? (
				<span className="mt-1 block text-[11px] font-normal text-muted-foreground">
					{metric.measuredAt
						? t("측정 {0}", [metric.measuredAt])
						: t("측정일 미기록")}
				</span>
			) : null}
		</span>
	);
}

export function GoalMetricHistory({ goal }: { goal: Goal }) {
	const { t } = useI18n();
	const change = goalMetricChange(goal);
	const history = goal.metricHistory ?? [];
	return (
		<div className="min-w-0 text-xs">
			{change && goal.metric ? (
				<p className="mb-2 text-muted-foreground">
					{t(
						change.period === "month"
							? "전월 대비"
							: change.period === "week"
								? "전주 대비"
								: "이전 측정 대비",
					)}
					{" · "}
					{change.difference > 0 ? "+" : ""}
					{change.difference.toLocaleString()} {goal.metric.unit}
				</p>
			) : null}
			{history.length ? (
				<details>
					<summary className="cursor-pointer text-muted-foreground">
						{t("측정 이력")} · {history.length}
					</summary>
					<ol className="mt-2 max-h-44 space-y-2 overflow-y-auto">
						{[...history].reverse().map((entry) => (
							<li
								key={entry.revision}
								className="flex flex-wrap justify-between gap-x-4 gap-y-1 tabular-nums"
							>
								<span className="text-muted-foreground">
									{entry.measuredAt ?? t("측정일 미기록")}
									{entry.periodStart
										? ` (${entry.period === "month" ? entry.periodStart.slice(0, 7) : entry.periodStart})`
										: ""}
									{entry.period
										? ` · ${t(entry.period === "month" ? "월간 실적" : "주간 실적")}`
										: ""}
								</span>
								<span>
									{entry.current.toLocaleString()} /{" "}
									{entry.target.toLocaleString()} {entry.unit}
								</span>
							</li>
						))}
					</ol>
				</details>
			) : null}
		</div>
	);
}
