import { Pause, Play, RotateCcw, Timer } from "lucide-react";
import { useEffect, useState } from "react";
import {
	type Routine,
	type RoutineData,
	type RoutineMutation,
	routineRecordKey,
	routineStatus,
	routineTimerProgress,
} from "#/lib/orbit/routines";
import { useI18n } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function RoutineTimer({
	routine,
	day,
	data,
	busy,
	write,
}: {
	routine: Routine;
	day: string;
	data: RoutineData;
	busy: boolean;
	write: (mutation: RoutineMutation) => Promise<boolean>;
}) {
	const { t } = useI18n();

	const timer = data.timers[routineRecordKey(routine.id, day)];
	const [now, setNow] = useState(() => new Date());
	useEffect(() => {
		const current = new Date();
		setNow(current);
		if (!timer || !routineTimerProgress(timer, current).running) return;
		const refresh = () => {
			const date = new Date();
			setNow(date);
			if (!routineTimerProgress(timer, date).running)
				window.clearInterval(interval);
		};
		const interval = window.setInterval(refresh, 1000);
		window.addEventListener("focus", refresh);
		return () => {
			window.clearInterval(interval);
			window.removeEventListener("focus", refresh);
		};
	}, [timer]);
	const progress = timer
		? routineTimerProgress(timer, now)
		: {
				remainingMs: routine.durationMinutes * 60_000,
				elapsedMs: 0,
				running: false,
			};
	const seconds = Math.ceil(progress.remainingMs / 1000);
	const complete = seconds === 0;
	const canStart =
		routine.enabled &&
		routineStatus(data, routine.id, day) === "open" &&
		!complete;
	const action = (operation: "start" | "pause" | "reset") =>
		void write({ action: "routine-timer", id: routine.id, day, operation });
	return (
		<div
			className="border-t border-border/40 px-4 py-2.5"
			data-timer-routine={routine.id}
		>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<span
					className={cn(
						"flex items-center gap-2 text-xs tabular-nums",
						progress.running || complete
							? "text-emerald-600 dark:text-emerald-400"
							: "text-muted-foreground",
					)}
				>
					<Timer className="size-3.5" />
					<span
						className="text-sm font-medium"
						role="timer"
						aria-label={t("{0} 타이머", [routine.title])}
					>
						{String(Math.floor(seconds / 60)).padStart(2, "0")}:
						{String(seconds % 60).padStart(2, "0")}
					</span>
					{complete ? (
						<output>{t("타이머 종료")}</output>
					) : progress.running ? (
						t("진행 중")
					) : (
						t("Focus")
					)}
				</span>
				<div className="flex items-center gap-1">
					<Button
						variant="ghost"
						size="sm"
						disabled={busy || (!progress.running && !canStart)}
						aria-label={t("{0} 타이머 {1}", [
							routine.title,
							progress.running ? t("일시정지") : t("시작"),
						])}
						onClick={() => action(progress.running ? "pause" : "start")}
					>
						{progress.running ? (
							<Pause className="size-3.5" />
						) : (
							<Play className="size-3.5" />
						)}
						{progress.running
							? t("Pause")
							: timer && progress.elapsedMs > 0 && !complete
								? t("Resume")
								: t("Start")}
					</Button>
					<Button
						variant="ghost"
						size="icon-xs"
						aria-label={t("{0} 타이머 초기화", [routine.title])}
						disabled={
							busy || !timer || (progress.elapsedMs === 0 && !progress.running)
						}
						onClick={() => action("reset")}
					>
						<RotateCcw className="size-3.5" />
					</Button>
				</div>
			</div>
			<div
				className="mt-2 h-0.5 overflow-hidden rounded-full bg-muted"
				aria-hidden="true"
			>
				<div
					className="h-full bg-emerald-500 transition-[width]"
					style={{
						width: `${(progress.elapsedMs / (timer?.goalMs ?? routine.durationMinutes * 60_000)) * 100}%`,
					}}
				/>
			</div>
		</div>
	);
}
