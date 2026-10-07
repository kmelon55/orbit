import { Link } from "@tanstack/react-router";
import {
	ArrowDown,
	ArrowUp,
	Check,
	ChevronDown,
	ChevronRight,
	Clock3,
	MoreHorizontal,
	Plus,
	Settings2,
	SkipForward,
	Trash2,
	X,
} from "lucide-react";
import { Switch } from "radix-ui";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { weekdayName } from "#/lib/i18n";
import { mutateOrbit } from "#/lib/orbit/functions";
import { formatDayKey } from "#/lib/orbit/para";
import {
	buildRoutineTimeline,
	emptyRoutineData,
	isRoutineDue,
	ROUTINE_MOMENTS,
	type Routine,
	type RoutineData,
	type RoutineInput,
	type RoutineMutation,
	type RoutineTimelineEntry,
	routineInputSchema,
	routineScheduleLabel,
	routineStatus,
} from "#/lib/orbit/routines";
import type { OrbitSnapshot } from "#/lib/orbit/schema";
import { useI18n } from "@/components/locale-provider";
import { RoutineActivity } from "@/components/routine-activity";
import { RoutineTimer } from "@/components/routine-timer";
import { TimePicker } from "@/components/schedule-controls";
import { TaskCheck, taskTitleClass } from "@/components/task-check";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

function newRoutine(): RoutineInput {
	return {
		id: crypto.randomUUID(),
		title: "",
		weekdays: [0, 1, 2, 3, 4, 5, 6],
		moment: "anytime",
		time: null,
		enabled: true,
		durationMinutes: 25,
		timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
	};
}

function useRoutineWriter() {
	const { t, errorText } = useI18n();

	const [pending, setPending] = useState<string[]>([]);
	const active = useRef(new Set<string>());
	const [error, setError] = useState<string>();
	async function write(mutation: RoutineMutation) {
		const id =
			mutation.action === "save-routine" ? mutation.input.id : mutation.id;
		if (active.current.has(id)) return false;
		active.current.add(id);
		setPending((current) => [...current, id]);
		setError(undefined);
		try {
			await mutateOrbit({ data: mutation });
			return true;
		} catch (cause) {
			const message =
				cause instanceof Error
					? cause.message
					: t("루틴을 저장하지 못했습니다.");
			setError(message);
			toast.error(errorText(message));
			return false;
		} finally {
			active.current.delete(id);
			setPending((current) => current.filter((entry) => entry !== id));
		}
	}
	return { pending, write, error, clearError: () => setError(undefined) };
}
type RoutineWriter = ReturnType<typeof useRoutineWriter>;

function RoutineEditor({
	input,
	onClose,
	data,
	today,
	writer,
}: {
	input: RoutineInput | null;
	onClose: () => void;
	data: RoutineData;
	today: string;
	writer: RoutineWriter;
}) {
	const { t } = useI18n();

	const existing =
		input && data.routines.some((routine) => routine.id === input.id);
	return (
		<Dialog
			open={input !== null}
			onOpenChange={(open) => {
				if (!open) {
					onClose();
					writer.clearError();
				}
			}}
		>
			<DialogContent className="gap-0 p-0">
				<DialogHeader className="border-b px-5 py-4">
					<div className="flex items-center justify-between gap-2">
						<DialogTitle>
							{existing ? t("루틴 수정") : t("루틴 추가")}
						</DialogTitle>
						<Button
							variant="ghost"
							size="icon-xs"
							aria-label={t("루틴 닫기")}
							onClick={() => {
								onClose();
								writer.clearError();
							}}
						>
							<X />
						</Button>
					</div>
					<DialogDescription className="sr-only">
						{t("루틴 이름과 반복할 요일, 시간을 설정합니다.")}
					</DialogDescription>
				</DialogHeader>
				{input && (
					<RoutineForm
						key={input.id}
						input={input}
						data={data}
						today={today}
						pending={writer.pending.includes(input.id)}
						error={writer.error}
						onSave={async (value) => {
							if (await writer.write({ action: "save-routine", input: value }))
								onClose();
						}}
						onDelete={
							existing
								? async () => {
										if (
											await writer.write({
												action: "delete-routine",
												id: input.id,
											})
										)
											onClose();
									}
								: undefined
						}
					/>
				)}
			</DialogContent>
		</Dialog>
	);
}

function RoutineRow({
	routine,
	data,
	day,
	writer,
	onEdit,
	entry,
}: {
	routine: Routine;
	data: RoutineData;
	day: string;
	writer: RoutineWriter;
	onEdit: (routine: Routine) => void;
	entry?: RoutineTimelineEntry;
}) {
	const { t, locale } = useI18n();

	const status = routineStatus(data, routine.id, day);
	const [menuOpen, setMenuOpen] = useState(false);
	const busy = writer.pending.includes(routine.id);
	const badge =
		entry?.phase === "now"
			? t("지금")
			: entry?.phase === "past"
				? t("시간 지남")
				: entry?.phase === "next"
					? t("다음")
					: null;
	return (
		<div
			className={cn(
				"group flex min-w-0 items-center gap-3 px-4 py-3",
				entry?.phase === "now" && "bg-emerald-500/5",
			)}
			data-routine-id={routine.id}
			data-routine-phase={entry?.phase}
		>
			<TaskCheck
				checked={status === "done"}
				color="emerald"
				animate
				disabled={busy || (!routine.enabled && status === "skipped")}
				aria-label={
					routine.title + (status === "done" ? t("완료 취소") : t("완료"))
				}
				onClick={() =>
					void writer.write({
						action: "set-routine-status",
						id: routine.id,
						day,
						status: status === "done" ? "open" : "done",
					})
				}
			/>
			<button
				type="button"
				onClick={() => onEdit(routine)}
				className="min-w-0 flex-1 text-left focus-visible:outline-ring"
			>
				<span
					className={cn("block text-sm", taskTitleClass(status !== "open"))}
				>
					{routine.title}
				</span>
				<span className="mt-0.5 block text-xs text-muted-foreground">
					{status === "skipped"
						? t("오늘 건너뜀")
						: status === "done" && entry
							? t("완료")
							: entry
								? routineScheduleLabel(routine, locale).split(" · ")[0]
								: routineScheduleLabel(routine, locale)}
				</span>
			</button>
			{badge && (
				<span
					className={cn(
						"shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium",
						entry?.phase === "now"
							? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400"
							: "text-muted-foreground",
					)}
				>
					{badge}
				</span>
			)}
			<Popover open={menuOpen} onOpenChange={setMenuOpen}>
				<PopoverTrigger asChild>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={t("{0} 메뉴", [routine.title])}
					>
						<MoreHorizontal />
					</Button>
				</PopoverTrigger>
				<PopoverContent align="end" className="w-44 space-y-1 p-1">
					<Button
						variant="ghost"
						size="sm"
						className="w-full justify-start"
						disabled={busy}
						onClick={() => {
							setMenuOpen(false);
							void writer.write({
								action: "set-routine-status",
								id: routine.id,
								day,
								status: status === "skipped" ? "open" : "skipped",
							});
						}}
					>
						<SkipForward />
						{status === "skipped" ? t("건너뛰기 취소") : t("오늘만 건너뛰기")}
					</Button>
					<Button
						variant="ghost"
						size="sm"
						className="w-full justify-start"
						onClick={() => {
							setMenuOpen(false);
							onEdit(routine);
						}}
					>
						<Settings2 />
						{t("루틴 수정")}
					</Button>
				</PopoverContent>
			</Popover>
		</div>
	);
}

export function RoutineManager({
	snapshot,
	today,
	visible,
	completionView,
}: {
	snapshot: OrbitSnapshot;
	today: string;
	visible: boolean;
	completionView: "open" | "today" | "done";
}) {
	const { t } = useI18n();

	const data = snapshot.routineData ?? emptyRoutineData(),
		writer = useRoutineWriter();
	const [editing, setEditing] = useState<RoutineInput | null>(null);
	const [collapsed, setCollapsed] = useState(false),
		[showFinished, setShowFinished] = useState(false);
	const scheduled = data.routines.filter(
		(routine) =>
			!routine.archived &&
			(isRoutineDue(routine, today) ||
				routineStatus(data, routine.id, today) !== "open"),
	);
	const finished = scheduled.filter(
			(routine) => routineStatus(data, routine.id, today) !== "open",
		),
		remaining = scheduled.filter(
			(routine) => routineStatus(data, routine.id, today) === "open",
		);
	const done = finished.filter(
		(routine) => routineStatus(data, routine.id, today) === "done",
	);
	const row = (routine: Routine) => (
		<RoutineRow
			key={routine.id}
			routine={routine}
			data={data}
			day={today}
			writer={writer}
			onEdit={setEditing}
		/>
	);
	return (
		<>
			{visible && (
				<section
					className="orbit-card mb-4 overflow-hidden"
					aria-label={t("오늘의 루틴")}
				>
					<div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
						<button
							type="button"
							className="flex min-w-0 flex-1 items-center gap-2 text-left"
							aria-expanded={!collapsed}
							onClick={() => setCollapsed((value) => !value)}
						>
							{collapsed ? (
								<ChevronRight className="size-3.5 text-muted-foreground" />
							) : (
								<ChevronDown className="size-3.5 text-muted-foreground" />
							)}
							<h3 className="text-xs font-semibold text-muted-foreground">
								{t("오늘의 루틴")}
							</h3>
							<span className="text-xs tabular-nums text-muted-foreground/70">
								{done.length}/{scheduled.length}
							</span>
						</button>
						<Button
							variant="ghost"
							size="icon-xs"
							aria-label={t("루틴 추가")}
							onClick={() => {
								writer.clearError();
								setEditing(newRoutine());
							}}
						>
							<Plus />
						</Button>
					</div>
					{!collapsed && (
						<div className="divide-y divide-border/40">
							{(completionView === "done" ? done : remaining).map(row)}
							{completionView !== "done" && finished.length > 0 && (
								<div>
									<button
										type="button"
										className="flex w-full items-center gap-2 px-4 py-2.5 text-xs text-muted-foreground hover:bg-muted/40"
										aria-expanded={showFinished || completionView === "today"}
										onClick={() => setShowFinished((value) => !value)}
									>
										<Check className="size-3.5" />
										{t("완료·건너뜀")}
										{finished.length}
										<ChevronDown className="ml-auto size-3.5" />
									</button>
									{(showFinished || completionView === "today") &&
										finished.map(row)}
								</div>
							)}
							{scheduled.length === 0 && (
								<div className="flex items-center justify-between gap-3 px-4 py-4 text-sm text-muted-foreground">
									<span>{t("오늘 예정된 루틴이 없어요.")}</span>
									<Button asChild variant="ghost" size="sm">
										<Link to="/routines">{t("관리")}</Link>
									</Button>
								</div>
							)}
						</div>
					)}
				</section>
			)}
			<RoutineEditor
				input={editing}
				onClose={() => setEditing(null)}
				data={data}
				today={today}
				writer={writer}
			/>
		</>
	);
}

function RoutineSettings({
	routines,
	writer,
	onEdit,
}: {
	routines: Routine[];
	writer: RoutineWriter;
	onEdit: (routine: Routine) => void;
}) {
	const { t, locale } = useI18n();

	return (
		<section
			className="orbit-card divide-y divide-border/40 overflow-hidden"
			aria-label={t("루틴 관리 목록")}
		>
			{routines.map((routine, index) => (
				<div key={routine.id} className="flex items-center gap-2 px-4 py-4">
					<button
						type="button"
						className="min-w-0 flex-1 text-left"
						onClick={() => onEdit(routine)}
					>
						<span
							className={cn(
								"block truncate text-sm font-medium",
								!routine.enabled && "text-muted-foreground",
							)}
						>
							{routine.title}
						</span>
						<span className="mt-1 block text-xs text-muted-foreground">
							{routineScheduleLabel(routine, locale)} ·{" "}
							{routine.durationMinutes}
							{t("분")}
						</span>
					</button>
					<Button
						variant="ghost"
						size="icon-xs"
						aria-label={t("{0} 위로", [routine.title])}
						disabled={index === 0 || writer.pending.length > 0}
						onClick={() =>
							void writer.write({
								action: "move-routine",
								id: routine.id,
								direction: "up",
							})
						}
					>
						<ArrowUp />
					</Button>
					<Button
						variant="ghost"
						size="icon-xs"
						aria-label={t("{0} 아래로", [routine.title])}
						disabled={
							index === routines.length - 1 || writer.pending.length > 0
						}
						onClick={() =>
							void writer.write({
								action: "move-routine",
								id: routine.id,
								direction: "down",
							})
						}
					>
						<ArrowDown />
					</Button>
					<Switch.Root
						checked={routine.enabled}
						disabled={writer.pending.includes(routine.id)}
						onCheckedChange={(enabled) =>
							void writer.write({
								action: "set-routine-enabled",
								id: routine.id,
								enabled,
							})
						}
						aria-label={t("{0} 사용", [routine.title])}
						className="ml-2 h-5 w-9 shrink-0 rounded-full bg-muted-foreground/25 p-0.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=checked]:bg-foreground disabled:opacity-50"
					>
						<Switch.Thumb className="block size-4 rounded-full bg-background shadow-sm transition-transform data-[state=checked]:translate-x-4" />
					</Switch.Root>
				</div>
			))}
		</section>
	);
}

export function RoutineWorkspace({ snapshot }: { snapshot: OrbitSnapshot }) {
	const { t, intlLocale } = useI18n();

	const [now, setNow] = useState(() => new Date());
	useEffect(() => {
		const refresh = () => setNow(new Date()),
			timer = window.setInterval(refresh, 30_000);
		window.addEventListener("focus", refresh);
		document.addEventListener("visibilitychange", refresh);
		return () => {
			window.clearInterval(timer);
			window.removeEventListener("focus", refresh);
			document.removeEventListener("visibilitychange", refresh);
		};
	}, []);
	const data = snapshot.routineData ?? emptyRoutineData(),
		writer = useRoutineWriter();
	const [editing, setEditing] = useState<RoutineInput | null>(null),
		[view, setView] = useState<"today" | "manage" | "activity">("today");
	const routines = data.routines.filter((routine) => !routine.archived),
		entries = buildRoutineTimeline(data, now);
	const timed = entries.filter((entry) => entry.routine.moment === "time"),
		done = entries.filter((entry) => entry.status === "done").length;
	const moments = [
		"morning",
		"afternoon",
		"evening",
		"bedtime",
		"anytime",
	] as const;
	const add = () => {
		writer.clearError();
		setEditing(newRoutine());
	};
	return (
		<div className="h-full overflow-auto bg-muted/20">
			<div className="mx-auto w-full max-w-3xl px-4 py-5 sm:px-6 sm:py-7">
				<header className="mb-6 flex items-center justify-between gap-3">
					<div>
						<h2 className="text-xl font-semibold tracking-tight">
							{t("Routines")}
						</h2>
						<p className="mt-1 text-xs text-muted-foreground">
							{new Intl.DateTimeFormat(intlLocale, {
								month: "long",
								day: "numeric",
								weekday: "long",
							}).format(now)}
						</p>
					</div>
					<Button onClick={add}>
						<Plus />
						{t("추가")}
					</Button>
				</header>
				<nav
					aria-label={t("루틴 보기")}
					className="mb-6 flex items-center gap-1"
				>
					<Button
						variant={view === "today" ? "secondary" : "ghost"}
						size="sm"
						aria-pressed={view === "today"}
						onClick={() => setView("today")}
					>
						{t("Today")}
					</Button>
					<Button
						variant={view === "manage" ? "secondary" : "ghost"}
						size="sm"
						aria-pressed={view === "manage"}
						onClick={() => setView("manage")}
					>
						{t("Manage")}
						<span className="ml-1 text-xs text-muted-foreground">
							{routines.length}
						</span>
					</Button>
					<Button
						variant={view === "activity" ? "secondary" : "ghost"}
						size="sm"
						aria-pressed={view === "activity"}
						onClick={() => setView("activity")}
					>
						{t("Activity")}
					</Button>
				</nav>
				{view === "activity" ? (
					<RoutineActivity
						data={data}
						now={now}
						pending={writer.pending}
						write={writer.write}
					/>
				) : view === "manage" ? (
					routines.length > 0 ? (
						<RoutineSettings
							routines={routines}
							writer={writer}
							onEdit={setEditing}
						/>
					) : (
						<div className="orbit-card px-5 py-8 text-sm text-muted-foreground">
							{t("등록된 루틴이 없어요.")}
						</div>
					)
				) : (
					<>
						<div className="mb-4 flex items-center justify-between text-xs text-muted-foreground">
							<span>
								{t("오늘의 루틴")}{" "}
								<span className="ml-1 tabular-nums">
									{done}/{entries.length}
								</span>
							</span>
							<span className="flex items-center gap-1.5 tabular-nums">
								<Clock3 className="size-3.5" />
								{new Intl.DateTimeFormat(intlLocale, {
									hour: "2-digit",
									minute: "2-digit",
									hourCycle: "h23",
								}).format(now)}
							</span>
						</div>
						{entries.length === 0 && (
							<div className="orbit-card px-5 py-8 text-sm text-muted-foreground">
								{routines.length
									? t("오늘 예정된 루틴이 없어요.")
									: t("등록된 루틴이 없어요.")}
							</div>
						)}
						{timed.length > 0 && (
							<ol className="mb-6 space-y-3" aria-label={t("시간순 루틴")}>
								{timed.map((entry) => (
									<li
										key={entry.routine.id}
										className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-start gap-3 sm:grid-cols-[4.5rem_minmax(0,1fr)]"
									>
										<time
											className={cn(
												"pt-4 text-xs tabular-nums text-muted-foreground",
												entry.phase === "now" &&
													"font-medium text-emerald-700 dark:text-emerald-400",
											)}
											dateTime={`${entry.day}T${entry.routine.time}`}
										>
											{entry.routine.time}
										</time>
										<div
											className={cn(
												"orbit-card overflow-hidden",
												entry.phase === "now" && "ring-1 ring-emerald-500/30",
											)}
										>
											<RoutineRow
												routine={entry.routine}
												data={data}
												day={entry.day}
												writer={writer}
												onEdit={setEditing}
												entry={entry}
											/>
											<RoutineTimer
												routine={entry.routine}
												day={entry.day}
												data={data}
												busy={writer.pending.length > 0}
												write={writer.write}
											/>
										</div>
									</li>
								))}
							</ol>
						)}
						{moments.map((moment) => {
							const group = entries.filter(
								(entry) => entry.routine.moment === moment,
							);
							return group.length ? (
								<section key={moment} className="mb-5">
									<h3 className="mb-2 text-xs font-medium text-muted-foreground">
										{moment === "anytime"
											? t("시간 없이")
											: t(ROUTINE_MOMENTS[moment])}
									</h3>
									<div className="orbit-card divide-y divide-border/40 overflow-hidden">
										{group.map((entry) => (
											<div key={entry.routine.id}>
												<RoutineRow
													routine={entry.routine}
													data={data}
													day={entry.day}
													writer={writer}
													onEdit={setEditing}
													entry={entry}
												/>
												<RoutineTimer
													routine={entry.routine}
													day={entry.day}
													data={data}
													busy={writer.pending.length > 0}
													write={writer.write}
												/>
											</div>
										))}
									</div>
								</section>
							) : null;
						})}
					</>
				)}
				<RoutineEditor
					input={editing}
					onClose={() => setEditing(null)}
					data={data}
					today={formatDayKey(now)}
					writer={writer}
				/>
			</div>
		</div>
	);
}

function RoutineForm({
	input,
	data,
	today,
	pending,
	error,
	onSave,
	onDelete,
}: {
	input: RoutineInput;
	data: RoutineData;
	today: string;
	pending: boolean;
	error?: string;
	onSave: (input: RoutineInput) => Promise<void>;
	onDelete?: () => Promise<void>;
}) {
	const { t, intlLocale, errorText } = useI18n();

	const [title, setTitle] = useState(input.title);
	const [weekdays, setWeekdays] = useState(input.weekdays);
	const [moment, setMoment] = useState(input.moment);
	const [time, setTime] = useState(input.time ?? "09:00");
	const [durationMinutes, setDurationMinutes] = useState(
		String(input.durationMinutes),
	);
	const [validation, setValidation] = useState<string>();
	const [deleteConfirm, setDeleteConfirm] = useState(false);
	const history = Array.from({ length: 7 }, (_, index) => {
		const day = new Date(`${today}T12:00:00`);
		day.setDate(day.getDate() - 6 + index);
		const key = formatDayKey(day);
		return {
			day: key,
			weekday: weekdayName(day.getDay(), intlLocale),
			status: routineStatus(data, input.id, key),
		};
	});
	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				const parsed = routineInputSchema.safeParse({
					...input,
					title,
					durationMinutes: Number(durationMinutes),
					weekdays,
					moment,
					time: moment === "time" ? time : null,
				});
				if (!parsed.success) {
					setValidation(
						!title.trim()
							? t("이름을 입력해 주세요.")
							: weekdays.length === 0
								? t("반복할 요일을 선택해 주세요.")
								: t("시간과 타이머 길이(1~240분)를 확인해 주세요."),
					);
					return;
				}
				setValidation(undefined);
				void onSave(parsed.data);
			}}
		>
			<fieldset disabled={pending} className="grid gap-5 px-5 py-5">
				<div className="grid gap-2">
					<label
						htmlFor="routine-title"
						className="text-xs font-medium text-muted-foreground"
					>
						{t("이름")}
					</label>
					<Input
						id="routine-title"
						autoFocus
						value={title}
						onChange={(event) => setTitle(event.target.value)}
						placeholder={t("루틴 이름")}
						maxLength={160}
					/>
				</div>
				<div className="grid gap-2">
					<span className="text-xs font-medium text-muted-foreground">
						{t("반복")}
					</span>
					<div className="flex gap-2">
						<Button
							type="button"
							variant={weekdays.length === 7 ? "secondary" : "ghost"}
							size="sm"
							onClick={() => setWeekdays([0, 1, 2, 3, 4, 5, 6])}
						>
							{t("매일")}
						</Button>
						<Button
							type="button"
							variant={
								JSON.stringify(weekdays) === "[1,2,3,4,5]"
									? "secondary"
									: "ghost"
							}
							size="sm"
							onClick={() => setWeekdays([1, 2, 3, 4, 5])}
						>
							{t("평일")}
						</Button>
					</div>
					<fieldset
						className="grid grid-cols-7 gap-1.5"
						aria-label={t("반복 요일")}
					>
						{[1, 2, 3, 4, 5, 6, 0].map((day) => (
							<Button
								key={day}
								type="button"
								variant={weekdays.includes(day) ? "default" : "outline"}
								aria-pressed={weekdays.includes(day)}
								aria-label={weekdayName(day, intlLocale, "long")}
								onClick={() =>
									setWeekdays((current) =>
										current.includes(day)
											? current.filter((entry) => entry !== day)
											: [...current, day].sort(),
									)
								}
								className="px-0"
							>
								{weekdayName(day, intlLocale)}
							</Button>
						))}
					</fieldset>
				</div>
				<div className="grid gap-2">
					<label
						htmlFor="routine-moment"
						className="text-xs font-medium text-muted-foreground"
					>
						{t("언제")}
					</label>
					<div className="flex flex-wrap gap-2">
						<Select
							value={moment}
							onValueChange={(value) =>
								setMoment(value as RoutineInput["moment"])
							}
						>
							<SelectTrigger id="routine-moment" className="w-36">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{Object.entries(ROUTINE_MOMENTS).map(([value, label]) => (
									<SelectItem key={value} value={value}>
										{t(label)}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						{moment === "time" && (
							<TimePicker
								value={time}
								onChange={setTime}
								label={t("루틴 시간")}
							/>
						)}
					</div>
				</div>
				<div className="grid gap-2">
					<label
						htmlFor="routine-duration"
						className="text-xs font-medium text-muted-foreground"
					>
						{t("타이머 길이")}
					</label>
					<div className="flex items-center gap-2">
						<Input
							id="routine-duration"
							type="number"
							min={1}
							max={240}
							step={1}
							value={durationMinutes}
							onChange={(event) => setDurationMinutes(event.target.value)}
							className="w-24"
						/>
						<span className="text-xs text-muted-foreground">{t("분")}</span>
					</div>
				</div>
				{onDelete && (
					<div className="grid gap-2">
						<span className="text-xs font-medium text-muted-foreground">
							{t("최근 기록")}
						</span>
						<div className="grid grid-cols-7 gap-2">
							{history.map((entry) => (
								<div
									key={entry.day}
									className="grid justify-items-center gap-1.5"
									title={`${entry.day} ${entry.status === "done" ? t("완료") : entry.status === "skipped" ? t("건너뜀") : t("기록 없음")}`}
								>
									<span className="text-[11px] text-muted-foreground">
										{entry.weekday}
									</span>
									<span
										className={cn(
											"grid size-7 place-items-center rounded-full text-xs",
											entry.status === "done"
												? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400"
												: "bg-muted text-muted-foreground",
										)}
									>
										{entry.status === "done" ? (
											<Check className="size-3.5" />
										) : entry.status === "skipped" ? (
											<SkipForward className="size-3" />
										) : (
											"·"
										)}
									</span>
								</div>
							))}
						</div>
					</div>
				)}
				{(validation || error) && (
					<p role="alert" className="text-sm text-destructive">
						{errorText(validation ?? error ?? "")}
					</p>
				)}
			</fieldset>
			<div className="flex items-center justify-between gap-2 border-t px-5 py-3">
				{onDelete ? (
					deleteConfirm ? (
						<div className="flex items-center gap-1">
							<Button
								type="button"
								variant="destructive"
								size="sm"
								disabled={pending}
								onClick={() => void onDelete()}
							>
								{t("삭제하기")}
							</Button>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								disabled={pending}
								onClick={() => setDeleteConfirm(false)}
							>
								{t("취소")}
							</Button>
						</div>
					) : (
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							aria-label={t("루틴 삭제")}
							disabled={pending}
							onClick={() => setDeleteConfirm(true)}
						>
							<Trash2 className="text-muted-foreground" />
						</Button>
					)
				) : (
					<span />
				)}
				<Button type="submit" disabled={pending}>
					{pending ? t("저장 중…") : t("저장")}
				</Button>
			</div>
		</form>
	);
}
