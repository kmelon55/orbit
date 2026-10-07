import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { weekdayName } from "#/lib/i18n";
import { formatDayKey } from "#/lib/orbit/para";
import {
	rangeFromMinutes,
	type ScheduleRange,
	scheduleMinute,
} from "#/lib/orbit/schedule-range";
import { useI18n } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];
const dateOf = (value: string) => new Date(`${value}T12:00:00`);

export function ScheduleRangeCalendar({
	value,
	onChange,
	disabled = false,
}: {
	value: ScheduleRange;
	onChange: (value: ScheduleRange) => void;
	disabled?: boolean;
}) {
	const { t, intlLocale } = useI18n();

	const { startDate, endDate } = value;
	const [cursor, setCursor] = useState(startDate.slice(0, 7));
	const [endpoint, setEndpoint] = useState<"start" | "end">("start");
	const startMonth = startDate.slice(0, 7);
	useEffect(() => setCursor(startMonth), [startMonth]);

	const month = dateOf(`${cursor}-01`);
	const first = new Date(
		month.getFullYear(),
		month.getMonth(),
		1 - month.getDay(),
	);
	const days = Array.from({ length: 42 }, (_, index) => {
		const date = new Date(first);
		date.setDate(first.getDate() + index);
		return formatDayKey(date);
	});

	return (
		<section
			className="rounded-xl border bg-background p-3"
			aria-label={t("일정 범위 달력")}
		>
			<div className="grid gap-3">
				<div className="min-w-0">
					<div className="mb-2 flex items-center justify-between">
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							disabled={disabled}
							aria-label={t("범위 달력 이전 달")}
							onClick={() =>
								setCursor(
									formatDayKey(
										new Date(month.getFullYear(), month.getMonth() - 1, 1),
									).slice(0, 7),
								)
							}
						>
							<ChevronLeft />
						</Button>
						<span className="text-sm font-medium">
							{new Intl.DateTimeFormat(intlLocale, {
								year: "numeric",
								month: "long",
							}).format(month)}
						</span>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							disabled={disabled}
							aria-label={t("범위 달력 다음 달")}
							onClick={() =>
								setCursor(
									formatDayKey(
										new Date(month.getFullYear(), month.getMonth() + 1, 1),
									).slice(0, 7),
								)
							}
						>
							<ChevronRight />
						</Button>
					</div>
					<div className="mb-2 flex gap-1 rounded-lg bg-muted/60 p-1">
						{(["start", "end"] as const).map((part) => (
							<button
								key={part}
								type="button"
								disabled={disabled}
								aria-pressed={endpoint === part}
								onClick={() => {
									setEndpoint(part);
									const date = part === "start" ? startDate : endDate;
									setCursor(date.slice(0, 7));
								}}
								className={cn(
									"flex-1 rounded-md py-1 text-xs",
									endpoint === part && "bg-background font-medium shadow-sm",
								)}
							>
								{part === "start" ? t("시작일") : t("종료일")}
							</button>
						))}
					</div>
					<div className="grid grid-cols-7 text-center text-[10px] text-muted-foreground">
						{WEEKDAYS.map((weekday) => (
							<span key={weekday} className="py-1">
								{weekdayName(weekday, intlLocale)}
							</span>
						))}
					</div>
					<div className="grid grid-cols-7 gap-y-1">
						{days.map((date) => {
							const isStart = date === startDate;
							const isEnd = date === endDate;
							const selected = date >= startDate && date <= endDate;
							return (
								<button
									key={date}
									type="button"
									disabled={
										disabled || (endpoint === "end" && date < startDate)
									}
									aria-label={`${date}${isStart ? t("시작") : ""}${isEnd ? t("종료") : ""}`}
									aria-pressed={selected}
									onClick={() => {
										if (endpoint === "start") {
											const delta =
												scheduleMinute(date) - scheduleMinute(startDate);
											onChange({
												...value,
												startDate: date,
												endDate: rangeFromMinutes(
													scheduleMinute(endDate) + delta,
													scheduleMinute(endDate) + delta,
												).endDate,
											});
											setEndpoint("end");
										} else onChange({ ...value, endDate: date });
									}}
									className={cn(
										"flex h-9 flex-col items-center justify-center text-xs tabular-nums hover:bg-muted disabled:opacity-30",
										selected &&
											"bg-blue-500/10 text-blue-600 dark:text-blue-300",
										isStart && "rounded-l-lg",
										isEnd && "rounded-r-lg",
										(isStart || isEnd) && "bg-blue-500/20 font-semibold",
										date.slice(0, 7) !== cursor && "opacity-40",
										date === formatDayKey() &&
											"underline decoration-blue-400 underline-offset-2",
									)}
								>
									{Number(date.slice(8))}
									<span className="h-2 text-[8px] leading-none">
										{isStart && isEnd
											? t("시작·종료")
											: isStart
												? t("시작")
												: isEnd
													? t("종료")
													: ""}
									</span>
								</button>
							);
						})}
					</div>
				</div>
			</div>
		</section>
	);
}
