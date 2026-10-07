import { Link } from "@tanstack/react-router";
import {
	ArrowRight,
	CalendarClock,
	CalendarDays,
	Check,
	Circle,
	ListFilter,
	Plus,
	Repeat2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { resolveLocale, translate } from "#/lib/i18n";
import { moveCalendarItem, taskDatePatch } from "#/lib/orbit/calendar-schedule";
import { mutateOrbit } from "#/lib/orbit/functions";
import { itemColor } from "#/lib/orbit/item-colors";
import { isPendingItemId } from "#/lib/orbit/optimistic-mutations";
import { folderOf, formatDayKey } from "#/lib/orbit/para";
import type { OrbitItem, OrbitSnapshot, OrbitSpace } from "#/lib/orbit/schema";
import {
	completedOnDay,
	isVisibleTaskEvent,
	type TaskCompletionFilter,
	taskListDay,
} from "#/lib/orbit/task-filters";
import { onItemUndone } from "#/lib/orbit/undo-events";
import {
	ConfirmItemDialog,
	type ItemConfirmAction,
	ItemContextMenu,
} from "@/components/item-context-menu";
import { useI18n } from "@/components/locale-provider";
import { RoutineManager } from "@/components/routine-manager";
import { DatePicker } from "@/components/schedule-controls";
import { ScheduleEditor } from "@/components/schedule-editor";
import {
	TaskCheck,
	TaskEmpty,
	TaskExit,
	taskTitleClass,
} from "@/components/task-check";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { useTaskToggle } from "@/hooks/use-task-toggle";
import { cn } from "@/lib/utils";
import { ItemLocation } from "./item-move-dialog";

type RescheduleTarget = "today" | "tomorrow";

const RESCHEDULE_EXIT_MS = 140;
const RESCHEDULE_ENTER_MS = 200;

function waitForRescheduleExit() {
	if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
		return Promise.resolve();
	}
	return new Promise<void>((resolve) => {
		window.setTimeout(resolve, RESCHEDULE_EXIT_MS);
	});
}

function dueDay(item: OrbitItem) {
	return (item.start ?? item.due)?.slice(0, 10);
}

function dueTime(item: OrbitItem) {
	return (item.start ?? item.due)?.match(/T(\d{2}:\d{2})/)?.[1];
}

function pointDueLabel(item: OrbitItem, today: string, locale = "ko-KR") {
	const day = dueDay(item);
	if (!day) return translate(resolveLocale(null, locale), "날짜 없음");
	const time = dueTime(item);
	if (day === today) {
		const todayLabel = translate(resolveLocale(null, locale), "오늘");
		return time ? `${todayLabel} ${time}` : todayLabel;
	}
	const date = new Date(`${day}T00:00:00`);
	const label = new Intl.DateTimeFormat(locale, {
		month: "short",
		day: "numeric",
		weekday: "short",
	}).format(date);
	return time ? `${label} ${time}` : label;
}

function formatDue(item: OrbitItem, today: string, locale = "ko-KR") {
	const start = pointDueLabel(item, today, locale);
	if (!item.start || !item.end || item.start === item.end) return start;
	return `${start} → ${pointDueLabel({ ...item, start: undefined, due: item.end }, today, locale)}`;
}

function rescheduledDue(item: OrbitItem, day: string) {
	return `${day}${(item.start ?? item.due)?.slice(10) ?? ""}`;
}

function targetDays(item: OrbitItem, today: string): RescheduleTarget[] {
	const day = dueDay(item);
	if (!day) return [];
	if (day < today) return ["today", "tomorrow"];
	if (day === today) return ["tomorrow"];
	return ["today"];
}

export function TaskManager({ snapshot }: { snapshot: OrbitSnapshot }) {
	const { t, errorText } = useI18n();

	const [now, setNow] = useState(() => new Date());
	const today = formatDayKey(now);
	const upcomingEnd = new Date(now);
	upcomingEnd.setDate(upcomingEnd.getDate() + 7);
	const upcomingEndKey = formatDayKey(upcomingEnd);
	useEffect(() => {
		const refresh = () => setNow(new Date());
		const timer = window.setInterval(refresh, 30_000);
		window.addEventListener("focus", refresh);
		document.addEventListener("visibilitychange", refresh);
		return () => {
			window.clearInterval(timer);
			window.removeEventListener("focus", refresh);
			document.removeEventListener("visibilitychange", refresh);
		};
	}, []);
	const [view, setView] = useState<TaskCompletionFilter>("open");
	const [showEvents, setShowEvents] = useState(false);
	const [showRoutines, setShowRoutines] = useState(true);
	const [editor, setEditor] = useState<{
		open: boolean;
		item?: OrbitItem;
		kind?: "task" | "event";
	}>({
		open: false,
	});
	const [confirm, setConfirm] = useState<ItemConfirmAction | null>(null);
	const [draggingTask, setDraggingTask] = useState<OrbitItem | null>(null);
	const [dropActive, setDropActive] = useState<RescheduleTarget | null>(null);
	const [reschedulingIds, setReschedulingIds] = useState<string[]>([]);
	const [departingIds, setDepartingIds] = useState<string[]>([]);
	const [arrivingIds, setArrivingIds] = useState<string[]>([]);
	const [optimisticDueById, setOptimisticDueById] = useState<
		Record<string, string>
	>({});
	const [rescheduleError, setRescheduleError] = useState<string>();
	useEffect(
		() =>
			onItemUndone(({ itemId }) => {
				setOptimisticDueById((current) => {
					const next = { ...current };
					delete next[itemId];
					return next;
				});
				setDepartingIds((current) => current.filter((id) => id !== itemId));
				setArrivingIds((current) => current.filter((id) => id !== itemId));
			}),
		[],
	);
	const taskToggle = useTaskToggle();
	useEffect(() => {
		taskToggle.sync(snapshot.items);
	}, [snapshot.items, taskToggle.sync]);
	useEffect(() => {
		setOptimisticDueById((current) => {
			let changed = false;
			const next = { ...current };
			for (const [id, due] of Object.entries(current)) {
				const persisted = snapshot.items.find((item) => item.id === id)?.due;
				if (persisted !== due) continue;
				delete next[id];
				changed = true;
			}
			return changed ? next : current;
		});
	}, [snapshot.items]);
	const tasks = useMemo(
		() =>
			snapshot.items
				.filter((item) => item.type === "task" && item.space !== "archive")
				.map((item) =>
					optimisticDueById[item.id]
						? moveCalendarItem(item, {
								date: optimisticDueById[item.id].slice(0, 10),
								mode: "keep-time",
							})
						: item,
				)
				.sort((left, right) =>
					(left.start ?? left.due ?? "9999").localeCompare(
						right.start ?? right.due ?? "9999",
					),
				),
		[snapshot.items, optimisticDueById],
	);
	const openTasks = tasks.filter((item) => taskToggle.keepInOpenList(item));
	const doneTasks = tasks.filter((item) => taskToggle.keepInDoneList(item));
	const todayDone = tasks.filter((item) => completedOnDay(item, today));
	const visibleTasks =
		view === "done"
			? doneTasks
			: view === "today"
				? tasks.filter(
						(item) =>
							taskToggle.keepInOpenList(item) || completedOnDay(item, today),
					)
				: openTasks;
	const events = showEvents
		? snapshot.items.filter((item) => isVisibleTaskEvent(item, today))
		: [];
	const visibleItems = [...visibleTasks, ...events].sort((a, b) =>
		(a.start ?? a.due ?? "9999").localeCompare(b.start ?? b.due ?? "9999"),
	);
	const groups = [
		{
			key: "overdue",
			label: t("기한 지남"),
			items: visibleItems.filter((item) => {
				const day = taskListDay(item, today);
				return Boolean(day && day < today);
			}),
		},
		{
			key: "today",
			label: t("오늘"),
			items: visibleItems.filter((item) => taskListDay(item, today) === today),
		},
		{
			key: "upcoming",
			label: showEvents ? t("다가오는 항목") : t("다가오는 할 일"),
			items: visibleItems.filter((item) => {
				const day = taskListDay(item, today);
				return Boolean(day && day > today && day <= upcomingEndKey);
			}),
		},
		{
			key: "unscheduled",
			label: t("날짜 없음"),
			items: visibleItems.filter((item) => !taskListDay(item, today)),
		},
	];

	async function createTask() {
		setEditor({ open: true });
	}

	async function archiveItem(item: OrbitItem) {
		await mutateOrbit({ data: { action: "archive-item", id: item.id } });
	}

	async function deleteItem(item: OrbitItem) {
		await mutateOrbit({ data: { action: "delete-item", id: item.id } });
	}

	async function moveItem(item: OrbitItem, space: OrbitSpace, folder?: string) {
		await mutateOrbit({
			data: {
				action: "file-item",
				id: item.id,
				input: { space, folder },
			},
		});
	}

	const tomorrow = new Date(now);
	tomorrow.setDate(tomorrow.getDate() + 1);
	const tomorrowKey = formatDayKey(tomorrow);
	const draggingDay = draggingTask ? dueDay(draggingTask) : undefined;
	const rescheduleTargets = draggingTask
		? targetDays(draggingTask, today).map((target) => ({
				target,
				label:
					target === "tomorrow"
						? t("내일로 미루기")
						: draggingDay && draggingDay > today
							? t("오늘로 당겨오기")
							: t("오늘로 가져오기"),
				hint:
					target === "tomorrow"
						? t("시간은 그대로 두고 날짜만 내일로 바뀝니다.")
						: t("시간은 그대로 두고 날짜만 오늘로 바뀝니다."),
			}))
		: [];

	function startRescheduleDrag(event: React.DragEvent, item: OrbitItem) {
		event.dataTransfer.effectAllowed = "move";
		event.dataTransfer.setData("application/x-orbit-task-id", item.id);
		event.dataTransfer.setData("text/plain", item.id);
		setRescheduleError(undefined);
		setDraggingTask(item);
	}

	function finishRescheduleDrag() {
		setDraggingTask(null);
		setDropActive(null);
	}

	async function rescheduleTask(item: OrbitItem, target: RescheduleTarget) {
		if (
			!targetDays(item, today).includes(target) ||
			reschedulingIds.includes(item.id)
		) {
			return;
		}
		const nextDue = rescheduledDue(
			item,
			target === "today" ? today : tomorrowKey,
		);
		setReschedulingIds((current) => [...current, item.id]);
		setDepartingIds((current) => [...current, item.id]);
		finishRescheduleDrag();
		await waitForRescheduleExit();
		setDepartingIds((current) => current.filter((id) => id !== item.id));
		setOptimisticDueById((current) => ({
			...current,
			[item.id]: nextDue,
		}));
		setArrivingIds((current) => [...current, item.id]);
		window.setTimeout(() => {
			setArrivingIds((current) => current.filter((id) => id !== item.id));
		}, RESCHEDULE_ENTER_MS);
		let persisted = false;
		try {
			await mutateOrbit({
				data: {
					action: "file-item",
					id: item.id,
					input: {
						space: item.space,
						folder: folderOf(item),
						...taskDatePatch(item, nextDue.slice(0, 10)),
					},
				},
			});
			persisted = true;
		} catch {
			if (!persisted) {
				setOptimisticDueById((current) => {
					const next = { ...current };
					delete next[item.id];
					return next;
				});
			}
			setRescheduleError(
				persisted
					? t("“{0}”은 저장됐지만 화면 동기화가 늦어지고 있습니다.", [
							item.title,
						])
					: t("“{0}”의 날짜를 {1}로 바꾸지 못했습니다.", [
							item.title,
							target === "today" ? t("오늘") : t("내일"),
						]),
			);
		} finally {
			setReschedulingIds((current) => current.filter((id) => id !== item.id));
		}
	}

	function receiveRescheduledTask(
		event: React.DragEvent,
		target: RescheduleTarget,
	) {
		event.preventDefault();
		event.stopPropagation();
		const id =
			event.dataTransfer.getData("application/x-orbit-task-id") ||
			draggingTask?.id;
		const item = tasks.find((candidate) => candidate.id === id);
		if (item) void rescheduleTask(item, target);
	}

	return (
		<div className="relative h-full overflow-hidden bg-muted/20">
			<div className="h-full overflow-auto">
				<div className="mx-auto w-full max-w-5xl px-4 py-4 sm:px-5 sm:py-6 lg:px-8">
					<header className="mb-5 flex flex-wrap items-center justify-between gap-3 sm:mb-7">
						<div>
							<h2 className="text-xl font-semibold tracking-tight">
								{t("할 일")}
							</h2>
						</div>
						<div className="flex items-center gap-2">
							<Button asChild variant="outline">
								<Link to="/routines">
									<Repeat2 />
									{t("루틴")}
								</Link>
							</Button>
							<Button onClick={() => void createTask()}>
								<Plus /> {t("추가")}
							</Button>
						</div>
					</header>

					<div className="mb-4 flex flex-wrap items-center gap-2 sm:mb-6">
						<Popover>
							<PopoverTrigger asChild>
								<Button variant="outline" size="sm">
									<ListFilter /> {t("필터")}
								</Button>
							</PopoverTrigger>
							<PopoverContent align="start" className="w-60 space-y-1 p-1.5">
								{(
									[
										["open", t("미완료")],
										["today", t("오늘 완료한 할 일도 보기")],
										["done", t("완료한 할 일 전체")],
									] as const
								).map(([value, label]) => (
									<Button
										key={value}
										variant="ghost"
										size="sm"
										className="w-full justify-start"
										aria-pressed={view === value}
										onClick={() => setView(value)}
									>
										<Check
											className={cn("size-4", view !== value && "invisible")}
										/>
										{label}
									</Button>
								))}
								<div className="my-1 border-t" />
								<Button
									variant="ghost"
									size="sm"
									className="w-full justify-start"
									aria-pressed={showEvents}
									onClick={() => setShowEvents((current) => !current)}
								>
									<Check className={cn("size-4", !showEvents && "invisible")} />{" "}
									{t("일정 함께 보기")}
								</Button>
								<Button
									variant="ghost"
									size="sm"
									className="w-full justify-start"
									aria-pressed={showRoutines}
									onClick={() => setShowRoutines((current) => !current)}
								>
									<Check
										className={cn("size-4", !showRoutines && "invisible")}
									/>
									{t("루틴 표시")}
								</Button>
							</PopoverContent>
						</Popover>
						<span className="text-xs text-muted-foreground">
							{view === "done"
								? t("완료 {0}", [doneTasks.length])
								: t("미완료 {0}", [openTasks.length])}
							{view === "today" ? t("· 오늘 완료 {0}", [todayDone.length]) : ""}
							{showEvents ? t("· 일정 {0}", [events.length]) : ""}
						</span>
					</div>

					{rescheduleError ? (
						<output className="mb-4 block rounded-lg border border-destructive/25 bg-destructive/8 px-3 py-2 text-sm text-destructive">
							{errorText(rescheduleError)}
						</output>
					) : null}

					<RoutineManager
						snapshot={snapshot}
						today={today}
						visible={showRoutines}
						completionView={view}
					/>
					{view !== "done" ? (
						<div className="space-y-4">
							{groups.map((group) => (
								<section key={group.key} className="orbit-card overflow-hidden">
									<div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
										<h3 className="text-xs font-semibold text-muted-foreground">
											{t(group.label)}
										</h3>
										<span className="text-xs tabular-nums text-muted-foreground/70">
											{group.items.length}
										</span>
									</div>
									<TaskRows
										items={group.items}
										snapshot={snapshot}
										today={today}
										taskToggle={taskToggle}
										exitOnToggle={view !== "today"}
										canReschedule={group.key !== "unscheduled"}
										settling={reschedulingIds.length > 0}
										departingIds={departingIds}
										arrivingIds={arrivingIds}
										draggingId={draggingTask?.id}
										onDragStart={startRescheduleDrag}
										onDragEnd={finishRescheduleDrag}
										onOpen={(item) => setEditor({ open: true, item })}
										onCreate={() => void createTask()}
										onArchive={(item) => setConfirm({ kind: "archive", item })}
										onDelete={(item) => setConfirm({ kind: "delete", item })}
										onMove={moveItem}
									/>
								</section>
							))}
						</div>
					) : (
						<div className="orbit-card overflow-hidden">
							<TaskRows
								items={visibleItems}
								snapshot={snapshot}
								today={today}
								taskToggle={taskToggle}
								exitOnToggle
								canReschedule={false}
								settling={false}
								departingIds={[]}
								arrivingIds={[]}
								draggingId={draggingTask?.id}
								onDragStart={startRescheduleDrag}
								onDragEnd={finishRescheduleDrag}
								onOpen={(item) => setEditor({ open: true, item })}
								onCreate={() => void createTask()}
								onArchive={(item) => setConfirm({ kind: "archive", item })}
								onDelete={(item) => setConfirm({ kind: "delete", item })}
								onMove={moveItem}
							/>
						</div>
					)}
				</div>
			</div>

			<aside
				aria-hidden={!draggingTask}
				inert={!draggingTask}
				className={cn(
					"absolute inset-y-0 right-0 z-30 flex w-72 max-w-[88vw] flex-col border-l border-border/70 bg-background/96 shadow-2xl backdrop-blur-xl transition-transform duration-200 ease-[var(--interaction-ease)]",
					draggingTask
						? "translate-x-0"
						: "pointer-events-none translate-x-full",
				)}
			>
				<div className="border-b border-border/60 px-5 py-4">
					<p className="text-sm font-semibold">{t("빠르게 날짜 이동")}</p>
					<p className="mt-0.5 truncate text-xs text-muted-foreground">
						{draggingTask ? `“${draggingTask.title}”` : t("오늘 할 일")}
					</p>
				</div>
				<div className="grid min-h-0 flex-1 auto-rows-fr gap-3 p-4">
					{rescheduleTargets.map((option) => (
						<fieldset
							key={option.target}
							className={cn(
								"flex min-h-0 flex-1 flex-col items-center justify-center rounded-2xl border-2 border-dashed px-5 text-center transition-[border-color,background-color,transform] duration-150",
								dropActive === option.target
									? "scale-[1.02] border-foreground/45 bg-accent"
									: "border-border bg-muted/35",
							)}
							onDragEnter={() => setDropActive(option.target)}
							onDragLeave={(event) => {
								if (
									!event.currentTarget.contains(event.relatedTarget as Node)
								) {
									setDropActive((current) =>
										current === option.target ? null : current,
									);
								}
							}}
							onDragOver={(event) => {
								event.preventDefault();
								event.dataTransfer.dropEffect = "move";
								setDropActive(option.target);
							}}
							onDrop={(event) => receiveRescheduledTask(event, option.target)}
						>
							<span className="grid size-11 place-items-center rounded-full bg-background text-foreground shadow-sm ring-1 ring-border/80">
								<CalendarClock className="size-5" />
							</span>
							<p className="mt-3 text-sm font-semibold">{t(option.label)}</p>
							<p className="mt-1 max-w-48 text-xs leading-5 text-muted-foreground">
								{t(option.hint)}
							</p>
							<ArrowRight className="mt-4 size-4 text-muted-foreground" />
						</fieldset>
					))}
				</div>
			</aside>

			<ScheduleEditor
				open={editor.open}
				onOpenChange={(open) => setEditor((current) => ({ ...current, open }))}
				kind={editor.item?.type === "event" ? "event" : (editor.kind ?? "task")}
				item={editor.item}
			/>
			<ConfirmItemDialog
				action={confirm}
				onOpenChange={(open) => {
					if (!open) setConfirm(null);
				}}
				onConfirm={() => {
					if (!confirm) return;
					const next = confirm;
					setConfirm(null);
					void (next.kind === "delete"
						? deleteItem(next.item)
						: archiveItem(next.item));
				}}
			/>
		</div>
	);
}

function TaskRows({
	items,
	snapshot,
	today,
	taskToggle,
	exitOnToggle,
	canReschedule,
	settling,
	departingIds,
	arrivingIds,
	draggingId,
	onDragStart,
	onDragEnd,
	onOpen,
	onCreate,
	onArchive,
	onDelete,
	onMove,
}: {
	items: OrbitItem[];
	snapshot: OrbitSnapshot;
	today: string;
	taskToggle: ReturnType<typeof useTaskToggle>;
	exitOnToggle: boolean;
	canReschedule: boolean;
	settling: boolean;
	departingIds: string[];
	arrivingIds: string[];
	draggingId?: string;
	onDragStart: (event: React.DragEvent, item: OrbitItem) => void;
	onDragEnd: () => void;
	onOpen: (item: OrbitItem) => void;
	onCreate: () => void;
	onArchive: (item: OrbitItem) => void;
	onDelete: (item: OrbitItem) => void;
	onMove: (
		item: OrbitItem,
		space: OrbitSpace,
		folder?: string,
	) => void | Promise<void>;
}) {
	const { t, intlLocale } = useI18n();

	const savingDates = useRef(new Set<string>());
	const [savingIds, setSavingIds] = useState<ReadonlySet<string>>(new Set());
	async function changeDate(item: OrbitItem, day: string) {
		if (savingDates.current.has(item.id) || isPendingItemId(item.id)) return;
		const patch = taskDatePatch(item, day);
		if (
			(item.due ?? null) === patch.due &&
			(item.start ?? null) === patch.start &&
			(item.end ?? null) === patch.end
		)
			return;
		savingDates.current.add(item.id);
		setSavingIds(new Set(savingDates.current));
		try {
			await mutateOrbit({
				data: {
					action: "file-item",
					id: item.id,
					input: { space: item.space, folder: folderOf(item), ...patch },
				},
			});
		} catch {
			toast.error(t("날짜를 바꾸지 못했습니다."));
		} finally {
			savingDates.current.delete(item.id);
			setSavingIds(new Set(savingDates.current));
		}
	}
	const empty = items.every((item) => taskToggle.isExiting(item.id));

	return (
		<div>
			{items.map((item) => {
				const day = dueDay(item);
				const scheduledDay = taskListDay(item, today);
				const checked = taskToggle.isChecked(item);
				const departing = departingIds.includes(item.id);
				const arriving = arrivingIds.includes(item.id);
				return (
					<TaskExit key={item.id} active={taskToggle.isExiting(item.id)}>
						<ItemContextMenu
							item={item}
							snapshot={snapshot}
							createLabel="할 일 추가"
							onCreate={onCreate}
							onOpen={() => onOpen(item)}
							onArchive={() => onArchive(item)}
							onDelete={() => onDelete(item)}
							onToggleTask={
								item.type === "task"
									? () => void taskToggle.toggle(item, { exit: exitOnToggle })
									: undefined
							}
							onMove={(space, folder) => onMove(item, space, folder)}
						>
							{/* biome-ignore lint/a11y/useSemanticElements: This row groups task actions; fieldset's anonymous box breaks flex centering. */}
							<div
								role="group"
								draggable={canReschedule && item.type === "task" && !checked}
								onDragStart={(event) => {
									if (item.type === "task" && !checked)
										onDragStart(event, item);
								}}
								onDragEnd={onDragEnd}
								className={cn(
									"group flex min-h-14 items-center gap-3 border-b border-border/55 px-3 transition-[background-color,opacity,transform] duration-150 last:border-b-0 hover:bg-muted/40 sm:px-4",
									canReschedule &&
										item.type === "task" &&
										!checked &&
										"cursor-grab active:cursor-grabbing",
									draggingId === item.id && "opacity-45",
									departing && "pointer-events-none -translate-x-2 opacity-0",
									arriving &&
										"animate-in fade-in slide-in-from-right-2 duration-200",
								)}
							>
								{item.type === "task" ? (
									<TaskCheck
										color={item.color}
										category={item.category}
										checked={checked}
										animate={taskToggle.isAnimating(item.id)}
										disabled={taskToggle.isBusy(item.id)}
										onClick={() =>
											void taskToggle.toggle(item, { exit: exitOnToggle })
										}
										aria-label={
											checked
												? t("{0} 다시 열기", [item.title])
												: t("{0} 완료", [item.title])
										}
									/>
								) : (
									<span
										className={cn(
											"grid size-5 shrink-0 place-items-center rounded-full border",
											itemColor(item).surface,
										)}
									>
										<CalendarDays className="size-3" />
									</span>
								)}
								<button
									type="button"
									onClick={() => onOpen(item)}
									className="min-w-0 flex-1 py-2 text-left"
								>
									<span
										className={taskTitleClass(
											checked,
											"block text-sm font-medium",
										)}
									>
										{item.title}
									</span>
								</button>
								<ItemLocation
									item={item}
									snapshot={snapshot}
									onMove={(space, folder) => onMove(item, space, folder)}
								/>
								{item.type === "task" ? (
									<DatePicker
										value={day ?? ""}
										onChange={(value) => void changeDate(item, value)}
										label={t("{0} 날짜 변경", [item.title])}
										allowClear
										disabled={
											savingIds.has(item.id) ||
											taskToggle.isBusy(item.id) ||
											settling ||
											isPendingItemId(item.id)
										}
										triggerContent={formatDue(item, today, intlLocale)}
										variant="ghost"
										className={cn(
											"h-8 w-auto max-w-28 shrink-0 gap-1 px-1.5 text-[11px] text-muted-foreground sm:max-w-none sm:gap-1.5 sm:text-xs",
											scheduledDay &&
												scheduledDay < today &&
												!checked &&
												"text-destructive",
										)}
									/>
								) : (
									<button
										type="button"
										onClick={() => onOpen(item)}
										className="max-w-28 shrink-0 text-right text-[11px] text-muted-foreground sm:max-w-none sm:text-xs"
									>
										{item.start?.slice(0, 16).replace("T", " ")}
										{item.end && item.end !== item.start
											? ` ~ ${item.end.slice(0, 16).replace("T", " ")}`
											: ""}
									</button>
								)}
							</div>
						</ItemContextMenu>
					</TaskExit>
				);
			})}
			<TaskEmpty show={empty} animate={!settling}>
				<ItemContextMenu createLabel="할 일 추가" onCreate={onCreate}>
					<div className="flex min-h-16 items-center gap-2 px-4 text-sm text-muted-foreground">
						<Circle className="size-3.5" /> {t("비어 있습니다")}
					</div>
				</ItemContextMenu>
			</TaskEmpty>
		</div>
	);
}
