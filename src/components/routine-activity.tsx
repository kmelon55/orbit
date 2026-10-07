import { Check, Flame, SkipForward, Timer, Trophy } from "lucide-react";
import { useMemo, useState } from "react";
import {
	buildRoutineActivity,
	routineDayDetails,
} from "#/lib/orbit/routine-activity";
import {
	isRoutineDue,
	type RoutineData,
	type RoutineMutation,
	routineTimerProgress,
	routineToday,
} from "#/lib/orbit/routines";
import { useI18n } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const levels = [
	"bg-muted/70",
	"bg-emerald-800/55 dark:bg-emerald-900",
	"bg-emerald-700/65",
	"bg-emerald-500/80",
	"bg-emerald-400",
];
const months = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];
function focusLabel(ms: number, locale = "ko-KR") {
	const minutes = Math.floor(ms / 60_000);
	if (locale.startsWith("en"))
		return minutes >= 60
			? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
			: `${minutes}m`;
	return minutes >= 60
		? `${Math.floor(minutes / 60)}시간 ${minutes % 60}분`
		: `${minutes}분`;
}

export function RoutineActivity({
	data,
	now,
	pending,
	write,
}: {
	data: RoutineData;
	now: Date;
	pending: string[];
	write: (mutation: RoutineMutation) => Promise<boolean>;
}) {
	const { t, intlLocale } = useI18n();

	const currentYear = now.getFullYear();
	const [year, setYear] = useState(currentYear),
		[filter, setFilter] = useState("all"),
		[selectedDay, setSelectedDay] = useState<string | null>(null);
	const id = filter === "all" ? undefined : filter;
	const activity = useMemo(
		() => buildRoutineActivity(data, year, id, now),
		[data, year, id, now],
	);
	const weeks = Array.from({ length: activity.days.length / 7 }, (_, index) =>
		activity.days.slice(index * 7, index * 7 + 7),
	);
	const earliest = Math.min(
		currentYear,
		...data.routines.map((r) => Number(r.createdDay.slice(0, 4))),
	);
	const years = Array.from(
		{ length: currentYear - earliest + 1 },
		(_, index) => currentYear - index,
	);
	const details = selectedDay ? routineDayDetails(data, selectedDay, id) : [];
	const stats = [
		{ icon: Check, label: t("완료 횟수"), value: activity.completed },
		{
			icon: Flame,
			label: t("현재 연속 달성"),
			value: t("{0}일", [activity.currentStreak]),
		},
		{
			icon: Trophy,
			label: t("최장 연속 달성"),
			value: t("{0}일", [activity.bestStreak]),
		},
		{
			icon: Timer,
			label: t("집중 시간"),
			value: focusLabel(activity.focusMs, intlLocale),
		},
	];
	return (
		<div className="space-y-5">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<Select
					value={filter}
					onValueChange={(value) => {
						setFilter(value);
						setSelectedDay(null);
					}}
				>
					<SelectTrigger className="w-48" aria-label={t("기록할 루틴 선택")}>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">{t("All routines")}</SelectItem>
						{data.routines
							.filter(
								(routine) =>
									!routine.archived ||
									Object.values(data.records).some(
										(record) => record.routineId === routine.id,
									) ||
									Object.values(data.timers).some(
										(timer) => timer.routineId === routine.id,
									),
							)
							.map((routine) => (
								<SelectItem key={routine.id} value={routine.id}>
									{routine.title}
									{routine.archived ? t("(삭제됨)") : ""}
								</SelectItem>
							))}
					</SelectContent>
				</Select>
				<Select
					value={String(year)}
					onValueChange={(value) => {
						setYear(Number(value));
						setSelectedDay(null);
					}}
				>
					<SelectTrigger className="w-24" aria-label={t("기록 연도")}>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{years.map((value) => (
							<SelectItem key={value} value={String(value)}>
								{value}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
				{stats.map(({ icon: Icon, label, value }) => (
					<div key={label} className="orbit-card px-4 py-4">
						<span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
							<Icon className="size-3.5" />
							{label}
						</span>
						<p className="mt-2 text-lg font-semibold tabular-nums">{value}</p>
					</div>
				))}
			</div>
			<section
				className="orbit-card px-4 py-5"
				aria-label={t("루틴 연간 완료 그래프")}
			>
				<div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-xs">
					<span>
						{year} · {activity.activeDays}
						{t("일 활동")}
					</span>
				</div>
				<div className="overflow-x-auto pb-2">
					<div className="min-w-[710px]">
						<div
							className="mb-2 ml-8 grid text-[10px] text-muted-foreground"
							style={{
								gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))`,
							}}
						>
							{weeks.map((week) => {
								const first = week.find(
									(d) =>
										d.day.slice(8) === "01" && d.day.startsWith(String(year)),
								);
								return (
									<span key={week[0].day}>
										{first ? t(months[Number(first.day.slice(5, 7)) - 1]) : ""}
									</span>
								);
							})}
						</div>
						<div className="flex gap-2">
							<div className="grid w-6 shrink-0 grid-rows-7 items-center text-[9px] text-muted-foreground">
								<span />
								<span>{t("Mon")}</span>
								<span />
								<span>{t("Wed")}</span>
								<span />
								<span>{t("Fri")}</span>
								<span />
							</div>
							<div
								className="grid flex-1 gap-[3px]"
								style={{
									gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))`,
								}}
							>
								{weeks.map((week) => (
									<div key={week[0].day} className="grid grid-rows-7 gap-[3px]">
										{week.map((day) => (
											<Tooltip key={day.day}>
												<TooltipTrigger asChild>
													<button
														type="button"
														data-activity-day={day.day}
														data-completions={day.count}
														disabled={!day.available}
														aria-pressed={selectedDay === day.day}
														aria-label={t(
															"{0} 완료 {1}개, 건너뜀 {2}개, 집중 {3}",
															[
																day.day,
																day.count,
																day.skipped,
																focusLabel(day.focusMs, intlLocale),
															],
														)}
														onClick={() => setSelectedDay(day.day)}
														className={cn(
															"aspect-square min-w-0 rounded-[3px] outline-none focus-visible:ring-2 focus-visible:ring-ring",
															levels[Math.min(4, day.count)],
															!day.available && "opacity-20",
															selectedDay === day.day &&
																"ring-2 ring-foreground ring-offset-1 ring-offset-background",
														)}
													/>
												</TooltipTrigger>
												<TooltipContent>
													<span>
														{day.day} {t("· 완료")}
														{day.count}
														{t("개 ·")} {focusLabel(day.focusMs, intlLocale)}
													</span>
												</TooltipContent>
											</Tooltip>
										))}
									</div>
								))}
							</div>
						</div>
					</div>
				</div>
				<div className="mt-3 flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
					<span className="mr-1">{t("Less")}</span>
					{levels.map((level) => (
						<span key={level} className={cn("size-2.5 rounded-[2px]", level)} />
					))}
					<span className="ml-1">{t("More")}</span>
				</div>
			</section>
			{selectedDay && (
				<section
					className="orbit-card overflow-hidden"
					aria-label={t("{0} 루틴 기록", [selectedDay])}
				>
					<header className="border-b px-4 py-3 text-sm font-medium">
						{selectedDay}
					</header>
					{details.length ? (
						<div className="divide-y divide-border/40">
							{details.map(({ routine, status, timer }) => {
								const canWrite =
									!routine.archived &&
									selectedDay <= routineToday(routine.timeZone, now) &&
									(isRoutineDue(routine, selectedDay) || status !== "open");
								return (
									<div
										key={routine.id}
										className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
									>
										<div className="min-w-0">
											<p className="truncate text-sm">{routine.title}</p>
											<p className="mt-1 text-xs text-muted-foreground">
												{status === "done"
													? t("완료")
													: status === "skipped"
														? t("건너뜀")
														: t("미완료")}
												{timer
													? t("· 집중 {0}", [
															focusLabel(
																routineTimerProgress(timer, now).totalMs,
																intlLocale,
															),
														])
													: ""}
											</p>
										</div>
										<div className="flex gap-1">
											<Button
												variant={status === "done" ? "secondary" : "ghost"}
												size="sm"
												disabled={
													!canWrite ||
													pending.includes(routine.id) ||
													(!isRoutineDue(routine, selectedDay) &&
														status !== "done")
												}
												aria-label={`${routine.title} ${selectedDay} ${status === "done" ? t("완료 취소") : t("완료")}`}
												onClick={() =>
													void write({
														action: "set-routine-status",
														id: routine.id,
														day: selectedDay,
														status: status === "done" ? "open" : "done",
													})
												}
											>
												<Check />
												{t("완료")}
											</Button>
											<Button
												variant={status === "skipped" ? "secondary" : "ghost"}
												size="icon-sm"
												disabled={
													!canWrite ||
													pending.includes(routine.id) ||
													(!isRoutineDue(routine, selectedDay) &&
														status !== "skipped")
												}
												aria-label={t("{0} {1} 건너뛰기", [
													routine.title,
													selectedDay,
												])}
												onClick={() =>
													void write({
														action: "set-routine-status",
														id: routine.id,
														day: selectedDay,
														status: status === "skipped" ? "open" : "skipped",
													})
												}
											>
												<SkipForward />
											</Button>
										</div>
									</div>
								);
							})}
						</div>
					) : (
						<p className="px-4 py-5 text-sm text-muted-foreground">
							{t("이 날짜에 예정된 루틴이나 기록이 없어요.")}
						</p>
					)}
				</section>
			)}
		</div>
	);
}
