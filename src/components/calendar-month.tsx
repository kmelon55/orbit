import { useNavigate, useSearch } from "@tanstack/react-router";
import {
	CalendarDays,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	Circle,
	Clock3,
	ListTodo,
	Plus,
	Repeat2,
} from "lucide-react";
import {
	type ComponentProps,
	type CSSProperties,
	createContext,
	useCallback,
	useContext,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import { dateTimeFormatter, weekdayName } from "#/lib/i18n";
import {
	buildMonthLayout,
	buildWeekLayout,
	isCalendarHeaderItem,
} from "#/lib/orbit/calendar-layout";
import {
	type CalendarResizeEdge,
	calendarMoveTime,
	calendarResizeTime,
	type CalendarDragTarget as DragTarget,
	resizeCalendarItem as resizeScheduledItem,
} from "#/lib/orbit/calendar-resize";
import {
	calendarRoutineItems,
	isCalendarRoutine,
	moveCalendarRoutine,
} from "#/lib/orbit/calendar-routines";
import {
	moveCalendarItem as moveScheduledItem,
	spansMultipleDays,
	timedRangeForDay,
	visibleDayKeys,
	visibleEndDayKey,
} from "#/lib/orbit/calendar-schedule";
import {
	calendarRangeSelection,
	calendarSelectionDay,
} from "#/lib/orbit/calendar-selection";
import {
	HOUR_HEIGHT,
	layoutTimedItems,
	MIN_TIMED_CARD_HEIGHT,
} from "#/lib/orbit/calendar-timed-layout";
import { extendCalendarWindow } from "#/lib/orbit/calendar-window";
import { mutateOrbit } from "#/lib/orbit/functions";
import { itemColor } from "#/lib/orbit/item-colors";
import { koreanHolidayName } from "#/lib/orbit/korean-holidays";
import type { CalendarSearch } from "#/lib/orbit/navigation-search";
import { isPendingItemId } from "#/lib/orbit/optimistic-mutations";
import { formatDayKey, itemDayKey } from "#/lib/orbit/para";
import {
	emptyRoutineData,
	isRoutineDue,
	ROUTINE_MOMENTS,
	type RoutineData,
	routineToday,
} from "#/lib/orbit/routines";
import { visibleScheduleCategory } from "#/lib/orbit/schedule-categories";
import type { OrbitItem, OrbitSnapshot } from "#/lib/orbit/schema";
import { useI18n } from "@/components/locale-provider";
import { RoutineCalendarEditor } from "@/components/routine-manager";
import {
	type CalendarDisplayOptions,
	ScheduleDisplayMenu,
	ScheduleDisplayOptions,
} from "@/components/schedule-categories";
import { ScheduleEditor } from "@/components/schedule-editor";
import { TaskCheck, taskTitleClass } from "@/components/task-check";
import { Button } from "@/components/ui/button";
import { useCalendarTimeZoom } from "@/hooks/use-calendar-time-zoom";
import { useCalendarVisibility } from "@/hooks/use-calendar-visibility";
import { useKoreanHolidays } from "@/hooks/use-korean-holidays";
import { useLocalDay } from "@/hooks/use-local-day";
import { useIsMobile } from "@/hooks/use-mobile";
import { useTaskToggle } from "@/hooks/use-task-toggle";
import { cn } from "@/lib/utils";

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];
const HOUR_START = 0;
const HOUR_END = 24;

const MONTH_ITEMS_TOP = 56;
const MONTH_LANE_HEIGHT = 26;

function calendarDayTone(day: Date) {
	return day.getDay() === 0 || koreanHolidayName(formatDayKey(day))
		? "text-red-600 dark:text-red-400"
		: "";
}

function calendarDateLabel(day: string, locale = "ko-KR") {
	const holiday = koreanHolidayName(day);
	return holiday
		? `${shortDayLabel(day, locale)} · ${holiday}`
		: shortDayLabel(day, locale);
}

function HolidayLabel({
	date,
	className,
}: {
	date: string;
	className?: string;
}) {
	const holiday = koreanHolidayName(date);
	if (!holiday) return null;
	return (
		<span
			data-calendar-holiday={date}
			title={holiday}
			className={cn(
				"block min-w-0 truncate text-[10px] leading-4 text-red-600 dark:text-red-400",
				className,
			)}
		>
			{holiday}
		</span>
	);
}

function moveCalendarEntry(item: OrbitItem, target: DragTarget) {
	return isCalendarRoutine(item)
		? moveCalendarRoutine(item, target)
		: moveScheduledItem(item, target);
}

type CalendarView = "day" | "week" | "month";
type EditorState = {
	open: boolean;
	kind: "event" | "task";
	item?: OrbitItem;
	date?: string;
	time?: string;
	end?: string;
};
type DragOperation = "move" | "resize";

const CalendarTasks = createContext<ReturnType<typeof useTaskToggle> | null>(
	null,
);

const EMPTY_ROUTINES = emptyRoutineData();
const CalendarRoutines = createContext({
	data: EMPTY_ROUTINES,
	now: new Date(),
});

function withRoutineDays(
	byDay: Map<string, OrbitItem[]>,
	data: RoutineData,
	days: string[],
	now: Date,
) {
	const result = new Map(byDay);
	const requested = new Set(days);
	const additions = new Map<string, OrbitItem[]>();
	// Include yesterday for routines whose duration crosses midnight.
	const occurrenceDays = days.flatMap((day) => [
		day,
		formatDayKey(addDays(parseDayKey(day), -1)),
	]);
	for (const item of calendarRoutineItems(data, occurrenceDays, now)) {
		for (const day of visibleDayKeys(item)) {
			if (!requested.has(day)) continue;
			const items = additions.get(day) ?? [];
			items.push(item);
			additions.set(day, items);
		}
	}
	for (const [day, items] of additions) {
		const entries = new Map(
			[...(result.get(day) ?? []), ...items].map((item) => [item.id, item]),
		);
		result.set(
			day,
			[...entries.values()].sort((left, right) =>
				(left.start ?? left.due ?? "").localeCompare(
					right.start ?? right.due ?? "",
				),
			),
		);
	}
	return result;
}

function useRoutineDays(byDay: Map<string, OrbitItem[]>, days: Date[]) {
	const { data, now } = useContext(CalendarRoutines);
	const dayKeys = days.map((day) => formatDayKey(day)).join(",");
	return useMemo(
		() => withRoutineDays(byDay, data, dayKeys.split(","), now),
		[byDay, data, dayKeys, now],
	);
}

function CalendarRoutineCheck({
	item,
	className,
}: {
	item: OrbitItem;
	className?: string;
}) {
	const { t, errorText } = useI18n();
	const [busy, setBusy] = useState(false);
	const active = useRef(false);
	if (!isCalendarRoutine(item)) return null;
	const { source, day, status } = item.routine;
	const checked = status === "done";
	const disabled =
		busy ||
		day > routineToday(source.timeZone) ||
		(status === "open" && !isRoutineDue(source, day));
	return (
		<TaskCheck
			checked={checked}
			disabled={disabled}
			className={cn(
				"absolute left-1 top-0 z-20 pointer-events-auto after:inset-0 disabled:opacity-50",
				className,
			)}
			aria-label={
				status !== "open"
					? t("{0} 다시 열기", [item.title])
					: t("{0} 완료", [item.title])
			}
			onPointerDown={(event) => event.stopPropagation()}
			onClick={async (event) => {
				event.stopPropagation();
				if (active.current || disabled) return;
				active.current = true;
				setBusy(true);
				try {
					await mutateOrbit({
						data: {
							action: "set-routine-status",
							id: source.id,
							day,
							status: status === "open" ? "done" : "open",
						},
					});
				} catch (error) {
					toast.error(
						errorText(
							error instanceof Error
								? error.message
								: t("루틴을 저장하지 못했습니다."),
						),
					);
				} finally {
					active.current = false;
					setBusy(false);
				}
			}}
		/>
	);
}

function CalendarTaskCheck({
	item,
	className,
}: {
	item: OrbitItem;
	className?: string;
}) {
	const { t } = useI18n();

	const tasks = useContext(CalendarTasks);
	if (isCalendarRoutine(item))
		return <CalendarRoutineCheck item={item} className={className} />;
	if (item.type !== "task" || !tasks) return null;
	const checked = tasks.isChecked(item);
	return (
		<TaskCheck
			color={item.color}
			category={item.category}
			checked={checked}
			animate={tasks.isAnimating(item.id)}
			disabled={tasks.isBusy(item.id) || isPendingItemId(item.id)}
			className={cn(
				"absolute left-1 top-0 z-20 pointer-events-auto after:inset-0",
				className,
			)}
			aria-label={
				checked ? t("{0} 다시 열기", [item.title]) : t("{0} 완료", [item.title])
			}
			onClick={(event) => {
				event.stopPropagation();
				void tasks.toggle(item);
			}}
			onPointerDown={(event) => event.stopPropagation()}
		/>
	);
}

function CalendarCreateButton({
	date,
	onCreate,
	className,
}: {
	date: string;
	onCreate: (
		date: string,
		time?: string,
		kind?: EditorState["kind"],
		end?: string,
	) => void;
	className?: string;
}) {
	const { t } = useI18n();

	return (
		<Button
			variant="ghost"
			size="icon-xs"
			className={className}
			aria-label={t("{0} 항목 추가", [date])}
			onClick={(event) => {
				event.stopPropagation();
				onCreate(date);
			}}
			onDoubleClick={(event) => event.stopPropagation()}
		>
			<Plus />
		</Button>
	);
}

function CalendarItemTitle({
	item,
	className,
}: {
	item: OrbitItem;
	className?: string;
}) {
	const tasks = useContext(CalendarTasks);
	const { t } = useI18n();
	return (
		<span
			className={taskTitleClass(
				item.type === "task" &&
					(isCalendarRoutine(item)
						? item.routine.status !== "open"
						: (tasks?.isChecked(item) ?? item.status === "done")),
				className,
			)}
		>
			{isCalendarRoutine(item) ? (
				<Repeat2
					aria-label={t("루틴")}
					className="mr-1 inline size-3 align-[-2px]"
				/>
			) : null}
			{item.title}
		</span>
	);
}

function startOfMonth(date: Date) {
	return new Date(date.getFullYear(), date.getMonth(), 1);
}

function startOfWeek(date: Date) {
	const next = new Date(date);
	const offset = next.getDay();
	next.setDate(next.getDate() - offset);
	next.setHours(0, 0, 0, 0);
	return next;
}

function addDays(date: Date, amount: number) {
	const next = new Date(date);
	next.setDate(next.getDate() + amount);
	return next;
}

function addMonths(date: Date, amount: number) {
	return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function gridDays(cursor: Date) {
	const start = startOfWeek(startOfMonth(cursor));
	return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

function timeOf(value?: string) {
	return value?.match(/T(\d{2}:\d{2})/)?.[1];
}

function dragPayload(dataTransfer: DataTransfer) {
	return {
		id: dataTransfer.getData("text/orbit-item-id"),
		operation: "move" as const,
	};
}

function monthLabel(date: Date, locale = "ko-KR") {
	return dateTimeFormatter(locale, {
		year: "numeric",
		month: "long",
	}).format(date);
}

function weekLabel(date: Date, rolling = false, locale = "ko-KR") {
	const start = rolling ? date : startOfWeek(date);
	const end = addDays(start, 6);
	const formatter = dateTimeFormatter(locale, {
		month: "short",
		day: "numeric",
	});
	return `${dateTimeFormatter(locale, { year: "numeric" }).format(start)} ${formatter.format(start)} – ${formatter.format(end)}`;
}

function dayLabel(date: Date, locale = "ko-KR") {
	return dateTimeFormatter(locale, {
		year: "numeric",
		month: "long",
		day: "numeric",
		weekday: "short",
	}).format(date);
}

function parseDayKey(value: string) {
	const [year, month, day] = value.split("-").map(Number);
	return new Date(year, month - 1, day);
}

function shortDayLabel(value: string, locale = "ko-KR") {
	return dateTimeFormatter(locale, {
		month: "long",
		day: "numeric",
		weekday: "short",
	}).format(parseDayKey(value));
}

function itemTimeLabel(item: OrbitItem) {
	const start = timeOf(item.start ?? item.due);
	if (!start)
		return isCalendarRoutine(item)
			? ROUTINE_MOMENTS[item.routine.source.moment]
			: "종일";
	const end = timeOf(item.end);
	return end ? `${start}–${end}` : start;
}

function eventTone(item: OrbitItem) {
	return itemColor(item).surface;
}

function itemAccent(item: OrbitItem) {
	return itemColor(item).dot;
}

function CalendarEvent({
	item,
	compact = false,
	dense = false,
	dayKey,
	displayTime,
	resizeEndKey,
	onClick,
	onDragStart,
	onResizeStart,
	onDragEnd,
	dragging = false,
	dragOperation = "move",
	stickyContent = false,
	showRange = false,
	horizontalScroll,
}: {
	item: OrbitItem;
	compact?: boolean;
	dense?: boolean;
	dayKey?: string;
	displayTime?: string;
	resizeEndKey?: string;
	onClick: () => void;
	onDragStart: (event: React.DragEvent<HTMLButtonElement>) => void;
	onResizeStart?: (
		event: React.PointerEvent<HTMLButtonElement>,
		edge?: CalendarResizeEdge,
	) => void;
	onDragEnd: () => void;
	dragging?: boolean;
	dragOperation?: DragOperation;
	stickyContent?: boolean;
	showRange?: boolean;
	horizontalScroll?: { start: number; width: number; max: number };
}) {
	const { t } = useI18n();
	const contentTravel = Math.max(0, (horizontalScroll?.width ?? 0) - 80);

	const startKey = itemDayKey(item);
	const endKey = visibleEndDayKey(item);
	const continuesFromBefore = Boolean(
		dayKey && startKey && spansMultipleDays(item) && dayKey > startKey,
	);
	const continuesAfter = Boolean(
		dayKey &&
			endKey &&
			spansMultipleDays(item) &&
			(resizeEndKey ?? dayKey) < endKey,
	);
	const canResize = Boolean(
		onResizeStart &&
			(item.type === "event" || item.type === "task") &&
			(!endKey || !dayKey || (resizeEndKey ?? dayKey) === endKey),
	);
	const canResizeStart = Boolean(
		!compact &&
			onResizeStart &&
			(item.type === "event" || item.type === "task") &&
			(!dayKey || dayKey === startKey),
	);
	return (
		<div
			className={cn(
				"group/event @container/calendar-event relative flex h-full min-h-0 w-full min-w-0 items-start border px-2 text-left transition-colors active:cursor-grabbing",
				"cursor-grab",
				dragging && dragOperation === "move" && "opacity-35",
				stickyContent ? "overflow-clip" : "overflow-hidden",
				eventTone(item),
				continuesFromBefore ? "rounded-l-sm border-l-0" : "rounded-l-md",
				continuesAfter ? "rounded-r-sm border-r-0" : "rounded-r-md",
				compact
					? "h-6 items-center py-px text-[9px] leading-4 sm:text-[11px]"
					: dense
						? "items-center py-0 text-xs leading-4 shadow-sm"
						: "py-1.5 text-xs leading-4 shadow-sm",
			)}
		>
			<button
				type="button"
				draggable
				title={`${item.title} · ${displayTime ? t(displayTime) : t(itemTimeLabel(item))}`}
				onDragStart={onDragStart}
				onDragEnd={onDragEnd}
				onClick={(event) => {
					event.stopPropagation();
					onClick();
				}}
				onDoubleClick={(event) => event.stopPropagation()}
				aria-label={showRange ? `${item.title} · ${displayTime}` : item.title}
				className="absolute inset-0 size-full cursor-inherit rounded-[inherit] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			/>
			<span
				style={
					horizontalScroll
						? ({
								"--calendar-content-start": `${horizontalScroll.start}px`,
								"--calendar-content-travel": `${contentTravel}px`,
								animationRange: `${(horizontalScroll.start / horizontalScroll.max) * 100}% ${((horizontalScroll.start + contentTravel) / horizontalScroll.max) * 100}%`,
							} as CSSProperties)
						: undefined
				}
				className={cn(
					"pointer-events-none relative z-10 min-w-0 flex-1",
					horizontalScroll && "calendar-header-content",
					stickyContent && "sticky top-(--calendar-sticky-top) self-start",
					item.type === "task" && "min-h-4 pl-6",
					dense && "flex items-center gap-1.5",
				)}
			>
				<CalendarTaskCheck item={item} className="left-0 size-4" />
				<span
					className={cn(
						"block min-w-0 truncate font-medium",
						item.type === "task" && "leading-4",
						dense && "flex-1",
					)}
				>
					{compact &&
					!showRange &&
					!continuesFromBefore &&
					!(isCalendarRoutine(item) && !item.start?.includes("T")) ? (
						<span className="mr-1 hidden sm:inline font-normal tabular-nums opacity-65">
							{displayTime ? t(displayTime) : timeOf(item.start ?? item.due)}
						</span>
					) : null}
					<CalendarItemTitle item={item} />
					{showRange ? (
						<span className="ml-2 font-normal tabular-nums opacity-75">
							{displayTime}
						</span>
					) : null}
				</span>
				{compact ? null : dense ? (
					<span className="hidden @[160px]/calendar-event:block max-w-[45%] shrink-0 truncate tabular-nums opacity-75">
						{displayTime ? t(displayTime) : timeOf(item.start ?? item.due)}
					</span>
				) : (
					<span className="mt-0.5 block truncate opacity-70">
						{displayTime ?? t(itemTimeLabel(item))}
					</span>
				)}
			</span>
			{canResizeStart ? (
				<button
					type="button"
					onPointerDown={(event) => onResizeStart?.(event, "start")}
					onClick={(event) => event.stopPropagation()}
					title={t("시작 시간 조정")}
					aria-label={t("시작 시간 조정")}
					className="absolute left-8 right-0 top-0 z-20 h-2 touch-none cursor-ns-resize"
				/>
			) : null}
			{canResize ? (
				<button
					type="button"
					onPointerDown={(event) => onResizeStart?.(event, "end")}
					onClick={(event) => event.stopPropagation()}
					title={compact ? t("종료 날짜 조정") : t("종료 시간 조정")}
					aria-label={compact ? t("종료 날짜 조정") : t("종료 시간 조정")}
					className={cn(
						"absolute z-20 touch-none",
						compact
							? "inset-y-0 right-0 w-2 cursor-ew-resize"
							: "left-8 right-0 bottom-0 h-2 cursor-ns-resize",
					)}
				/>
			) : null}
		</div>
	);
}

export function CalendarMonth({ snapshot }: { snapshot: OrbitSnapshot }) {
	useKoreanHolidays();
	const taskToggle = useTaskToggle();
	useEffect(() => {
		taskToggle.sync(snapshot.items);
	}, [snapshot.items, taskToggle.sync]);
	return (
		<CalendarTasks.Provider value={taskToggle}>
			<CalendarContent snapshot={snapshot} />
		</CalendarTasks.Provider>
	);
}

function CalendarContent({ snapshot }: { snapshot: OrbitSnapshot }) {
	const { t, intlLocale, errorText } = useI18n();
	const localDay = useLocalDay();

	const [hourHeight, setHourHeight] = useState(HOUR_HEIGHT);
	const [headerCollapsed, setHeaderCollapsed] = useState(false);
	const location = useSearch({ from: "/calendar" });
	const navigate = useNavigate({ from: "/calendar" });
	const view = location.view ?? "month";
	const cursorKey = location.date ?? localDay ?? formatDayKey();
	const cursor = useMemo(() => parseDayKey(cursorKey), [cursorKey]);
	const viewportAnchor =
		view === "week"
			? formatDayKey(startOfWeek(cursor))
			: view === "month"
				? formatDayKey(startOfMonth(cursor))
				: cursorKey;
	const [visibleDate, setVisibleDate] = useState(viewportAnchor);
	const [navigationVersion, setNavigationVersion] = useState(0);
	useEffect(() => setVisibleDate(viewportAnchor), [viewportAnchor]);
	const visibleCursor = useMemo(() => parseDayKey(visibleDate), [visibleDate]);
	const selectedDate = location.selected ?? cursorKey;
	const hiddenCategories = location.hiddenCategories;
	const updateCalendar = useCallback(
		(patch: CalendarSearch) => {
			void navigate({
				search: (previous) => ({ ...previous, ...patch }),
				resetScroll: false,
			});
		},
		[navigate],
	);
	const chooseView = useCallback(
		(next: CalendarView) => {
			const date = formatDayKey();
			setNavigationVersion((version) => version + 1);
			setVisibleDate(
				next === "week" ? formatDayKey(startOfWeek(parseDayKey(date))) : date,
			);
			updateCalendar({ view: next, date, selected: date });
		},
		[updateCalendar],
	);
	const [visibility, toggleVisibility] = useCalendarVisibility(view);
	const [editingRoutine, setEditingRoutine] = useState<string | null>(null);
	const [editor, setEditor] = useState<EditorState>({
		open: false,
		kind: "event",
	});
	const displayOptions: CalendarDisplayOptions = {
		visibility,
		onChangeVisibility: toggleVisibility,
		hidden: hiddenCategories ?? [],
		onChangeHidden: (hiddenCategories) =>
			updateCalendar({
				hiddenCategories: hiddenCategories.length
					? hiddenCategories
					: undefined,
			}),
	};
	const calendarRef = useRef<HTMLDivElement>(null);
	const resizePointerRef = useRef<number | null>(null);
	const resizeEdgeRef = useRef<CalendarResizeEdge>("end");
	const [localItems, setLocalItems] = useState(snapshot.items);
	const [draggingRoutine, setDraggingRoutine] = useState<OrbitItem | null>(
		null,
	);
	const draggingRoutineRef = useRef<OrbitItem | null>(null);
	const [draggingId, setDraggingId] = useState<string | null>(null);
	const [dragOperation, setDragOperation] = useState<DragOperation>("move");
	const [dragTarget, setDragTarget] = useState<DragTarget | null>(null);
	const [dragGrabOffset, setDragGrabOffset] = useState(0);
	const [dragError, setDragError] = useState<string | null>(null);
	const localItemsRef = useRef(localItems);
	const draggingIdRef = useRef<string | null>(null);
	const dragOperationRef = useRef<DragOperation>("move");
	const dragTargetRef = useRef<DragTarget | null>(null);
	const saveQueuesRef = useRef<Map<string, Promise<void>>>(new Map());
	const saveVersionsRef = useRef<Map<string, number>>(new Map());
	localItemsRef.current = localItems;
	const routineData = useMemo(() => {
		const data = visibility.routine
			? (snapshot.routineData ?? EMPTY_ROUTINES)
			: EMPTY_ROUTINES;
		if (
			!draggingRoutine ||
			!isCalendarRoutine(draggingRoutine) ||
			dragOperation !== "resize" ||
			!dragTarget
		)
			return data;
		const next = resizeScheduledItem(draggingRoutine, dragTarget);
		if (!next.start) return data;
		const { source, day } = draggingRoutine.routine;
		return {
			...data,
			schedules: {
				...data.schedules,
				[`${day}:${source.id}`]: {
					routineId: source.id,
					day,
					start: next.start,
					end: next.end,
				},
			},
		};
	}, [
		visibility.routine,
		snapshot.routineData,
		draggingRoutine,
		dragOperation,
		dragTarget,
	]);
	const [routineNow, setRoutineNow] = useState(() => new Date());
	useEffect(() => {
		if (!localDay) return;
		const zones = [
			...new Set(routineData.routines.map((routine) => routine.timeZone)),
		];
		const update = () => {
			const now = new Date();
			// Both the viewer's day and each routine's day control expiration.
			setRoutineNow((previous) =>
				formatDayKey(previous) !== formatDayKey(now) ||
				zones.some(
					(zone) => routineToday(zone, previous) !== routineToday(zone, now),
				)
					? now
					: previous,
			);
		};
		update();
		const interval = window.setInterval(update, 60_000);
		window.addEventListener("focus", update);
		document.addEventListener("visibilitychange", update);
		return () => {
			window.clearInterval(interval);
			window.removeEventListener("focus", update);
			document.removeEventListener("visibilitychange", update);
		};
	}, [routineData.routines, localDay]);
	const routineContext = useMemo(
		() => ({ data: routineData, now: routineNow }),
		[routineData, routineNow],
	);

	useEffect(() => {
		setLocalItems(snapshot.items);
	}, [snapshot.items]);
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.metaKey || event.ctrlKey || event.altKey) return;
			const target = event.target;
			if (
				target instanceof HTMLElement &&
				(target.isContentEditable ||
					target.matches("input, textarea, select, [role='textbox']"))
			)
				return;
			const nextView =
				event.key === "1"
					? "day"
					: event.key === "2"
						? "week"
						: event.key === "3"
							? "month"
							: null;
			if (nextView) {
				event.preventDefault();
				chooseView(nextView);
				return;
			}
			if (event.key.toLowerCase() === "t") {
				event.preventDefault();
				setNavigationVersion((version) => version + 1);
				const now = new Date();
				setVisibleDate(
					view === "week" ? formatDayKey(startOfWeek(now)) : formatDayKey(now),
				);
				updateCalendar({
					date: formatDayKey(now),
					selected: formatDayKey(now),
				});
				return;
			}
			if (event.key.toLowerCase() === "n") {
				event.preventDefault();
				setEditor({
					open: true,
					kind: "event",
					date: selectedDate,
					time: "09:00",
				});
				return;
			}
			if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
				event.preventDefault();
				const amount = event.key === "ArrowLeft" ? -1 : 1;
				const next =
					view === "day"
						? addDays(cursor, amount)
						: view === "week"
							? addDays(visibleCursor, amount * 7)
							: addMonths(visibleCursor, amount);
				updateCalendar({
					date: formatDayKey(next),
					selected: formatDayKey(next),
				});
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [cursor, visibleCursor, selectedDate, view, updateCalendar, chooseView]);
	const today = localDay ?? formatDayKey();
	const dated = useMemo(
		() =>
			localItems
				.map((item) =>
					draggingId === item.id && dragOperation === "resize" && dragTarget
						? resizeScheduledItem(item, dragTarget)
						: item,
				)
				.filter(
					(item) =>
						visibleScheduleCategory(item, hiddenCategories ?? []) &&
						((item.type === "event" && visibility.event && item.start) ||
							(item.type === "task" &&
								visibility.task &&
								(item.start || item.due))),
				),
		[
			localItems,
			visibility,
			hiddenCategories,
			draggingId,
			dragOperation,
			dragTarget,
		],
	);
	const byDay = useMemo(() => {
		const map = new Map<string, OrbitItem[]>();
		for (const item of dated) {
			for (const day of visibleDayKeys(item)) {
				const items = map.get(day) ?? [];
				items.push(item);
				map.set(day, items);
			}
		}
		for (const items of map.values()) {
			items.sort((left, right) =>
				(left.start ?? left.due ?? "").localeCompare(
					right.start ?? right.due ?? "",
				),
			);
		}
		return map;
	}, [dated]);
	const selectedItems = useMemo(
		() =>
			withRoutineDays(byDay, routineData, [selectedDate], routineNow).get(
				selectedDate,
			) ?? [],
		[byDay, routineData, selectedDate, routineNow],
	);

	function openNew(
		date = formatDayKey(cursor),
		time = "09:00",
		kind: EditorState["kind"] = "event",
		end?: string,
	) {
		updateCalendar({ selected: date });
		setEditor({
			open: true,
			kind,
			date,
			time,
			end,
		});
	}

	function openItem(item: OrbitItem) {
		if (isCalendarRoutine(item)) {
			setEditingRoutine(item.routine.source.id);
			return;
		}
		const date = itemDayKey(item);
		if (date) updateCalendar({ selected: date });
		setEditor({
			open: true,
			kind: item.type === "task" ? "task" : "event",
			item,
			date: itemDayKey(item),
			time: timeOf(item.start ?? item.due),
		});
	}

	function selectDate(date: string) {
		updateCalendar({ selected: date, date });
	}

	function move(amount: number) {
		const next =
			view === "day"
				? addDays(cursor, amount)
				: view === "week"
					? addDays(visibleCursor, amount * 7)
					: addMonths(visibleCursor, amount);
		updateCalendar({
			date: formatDayKey(next),
			selected:
				view === "week"
					? formatDayKey(addDays(parseDayKey(selectedDate), amount * 7))
					: formatDayKey(next),
		});
	}

	function startDrag(
		item: OrbitItem,
		event: React.DragEvent<HTMLButtonElement>,
	) {
		draggingRoutineRef.current = isCalendarRoutine(item) ? item : null;
		setDraggingRoutine(draggingRoutineRef.current);
		event.dataTransfer.effectAllowed = "move";
		event.dataTransfer.setData("text/orbit-item-id", item.id);
		const card = event.currentTarget.parentElement ?? event.currentTarget;
		const rect = card.getBoundingClientRect();
		const timed = event.currentTarget.closest('[data-calendar-mode="time"]');
		setDragGrabOffset(timed ? Math.max(0, event.clientY - rect.top) : 0);
		event.dataTransfer.setDragImage(
			card,
			event.clientX - rect.left,
			event.clientY - rect.top,
		);
		draggingIdRef.current = item.id;
		dragOperationRef.current = "move";
		setDraggingId(item.id);
		setDragOperation("move");
		setDragTarget(null);
		setDragError(null);
	}

	function startResize(
		item: OrbitItem,
		event: React.PointerEvent<HTMLButtonElement>,
		edge: CalendarResizeEdge = "end",
	) {
		if (event.button !== 0 || !event.isPrimary || isPendingItemId(item.id))
			return;
		event.preventDefault();
		event.stopPropagation();
		resizePointerRef.current = event.pointerId;
		resizeEdgeRef.current = edge;
		draggingRoutineRef.current = isCalendarRoutine(item) ? item : null;
		setDraggingRoutine(draggingRoutineRef.current);
		draggingIdRef.current = item.id;
		dragOperationRef.current = "resize";
		dragTargetRef.current = null;
		setDraggingId(item.id);
		setDragOperation("resize");
		setDragTarget(null);
		setDragError(null);
		if (event.nativeEvent.isTrusted)
			calendarRef.current?.setPointerCapture(event.pointerId);
	}

	function endDrag() {
		draggingRoutineRef.current = null;
		setDraggingRoutine(null);
		const pointer = resizePointerRef.current;
		if (pointer !== null && calendarRef.current?.hasPointerCapture(pointer)) {
			calendarRef.current.releasePointerCapture(pointer);
		}
		resizePointerRef.current = null;
		draggingIdRef.current = null;
		dragOperationRef.current = "move";
		dragTargetRef.current = null;
		setDraggingId(null);
		setDragOperation("move");
		setDragTarget(null);
	}

	function previewDrag(target: DragTarget | null) {
		dragTargetRef.current = target;
		setDragTarget((current) =>
			target === null
				? null
				: current?.date === target.date &&
						current.mode === target.mode &&
						current.time === target.time &&
						current.resizeEdge === target.resizeEdge
					? current
					: target,
		);
	}

	function dropOn(
		target: DragTarget,
		transferredId?: string,
		operation: DragOperation = dragOperationRef.current,
	) {
		const id = transferredId || draggingIdRef.current || draggingId;
		if (!id) return;
		const current =
			draggingRoutineRef.current?.id === id
				? draggingRoutineRef.current
				: localItemsRef.current.find((item) => item.id === id);
		if (!current) return;
		const next =
			operation === "resize"
				? resizeScheduledItem(current, target)
				: moveCalendarEntry(current, target);
		if (next === current) return;
		if (isCalendarRoutine(current) && next.start) {
			void mutateOrbit({
				data: {
					action: "set-routine-schedule",
					id: current.routine.source.id,
					day: current.routine.day,
					schedule: { start: next.start, end: next.end },
				},
			}).catch(() =>
				setDragError(t("일정을 저장하지 못해 원래 위치로 돌렸습니다.")),
			);
			endDrag();
			return;
		}
		setLocalItems((items) =>
			items.map((item) => (item.id === id ? next : item)),
		);
		setDraggingId(null);
		setDragOperation("move");
		draggingIdRef.current = null;
		dragOperationRef.current = "move";
		setDragTarget(null);
		dragTargetRef.current = null;
		setDragError(null);

		const version = (saveVersionsRef.current.get(id) ?? 0) + 1;
		saveVersionsRef.current.set(id, version);
		const previousQueue = saveQueuesRef.current.get(id) ?? Promise.resolve();
		const save = previousQueue
			.catch(() => undefined)
			.then(async () => {
				await mutateOrbit({
					data: {
						action: "file-item",
						id,
						input: {
							space: next.space,
							folder: next.folder,
							due: next.due ?? null,
							start: next.start ?? null,
							end: next.end ?? null,
						},
					},
				});
			})
			.then(async () => {
				if (saveVersionsRef.current.get(id) !== version) return;
			})
			.catch(() => {
				if (saveVersionsRef.current.get(id) !== version) return;
				setLocalItems((items) =>
					items.map((item) => (item.id === id ? current : item)),
				);
				setDragError(
					operation === "resize"
						? t("일정 길이를 저장하지 못해 원래대로 돌렸습니다.")
						: t("일정을 저장하지 못해 원래 위치로 돌렸습니다."),
				);
			});
		saveQueuesRef.current.set(id, save);
	}

	const resizeActionsRef = useRef({ previewDrag, dropOn, endDrag });
	resizeActionsRef.current = { previewDrag, dropOn, endDrag };
	useEffect(() => {
		if (!draggingId || dragOperation !== "resize") return;
		function targetAt(event: PointerEvent): DragTarget | null {
			for (const cell of calendarRef.current?.querySelectorAll<HTMLElement>(
				"[data-calendar-date]",
			) ?? []) {
				const rect = cell.getBoundingClientRect();
				if (
					event.clientX < rect.left ||
					event.clientX >= rect.right ||
					event.clientY < rect.top ||
					event.clientY >= rect.bottom
				)
					continue;
				const date = cell.dataset.calendarDate;
				if (!date) continue;
				if (cell.dataset.calendarMode === "time") {
					return {
						date,
						mode: "time",
						resizeEdge: resizeEdgeRef.current,
						time: calendarResizeTime(
							event.clientY,
							rect.top,
							Number(cell.dataset.calendarHourHeight) || HOUR_HEIGHT,
						),
					};
				}
				return { date, mode: "keep-time", resizeEdge: resizeEdgeRef.current };
			}
			return null;
		}
		function move(event: PointerEvent) {
			if (event.pointerId !== resizePointerRef.current) return;
			const target = targetAt(event);
			if (target) resizeActionsRef.current.previewDrag(target);
		}
		function finish(event: PointerEvent) {
			if (event.pointerId !== resizePointerRef.current) return;
			const target = targetAt(event);
			if (target && dragTargetRef.current && draggingIdRef.current)
				resizeActionsRef.current.dropOn(
					target,
					draggingIdRef.current,
					"resize",
				);
			resizeActionsRef.current.endDrag();
		}
		function cancel() {
			resizeActionsRef.current.endDrag();
		}
		function key(event: KeyboardEvent) {
			if (event.key === "Escape") cancel();
		}
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", finish);
		window.addEventListener("pointercancel", cancel);
		window.addEventListener("blur", cancel);
		window.addEventListener("keydown", key);
		return () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", finish);
			window.removeEventListener("pointercancel", cancel);
			window.removeEventListener("blur", cancel);
			window.removeEventListener("keydown", key);
		};
	}, [draggingId, dragOperation]);

	return (
		<CalendarRoutines.Provider value={routineContext}>
			<div ref={calendarRef} className="h-full min-h-0 bg-muted/20 p-0 md:p-3">
				<div className="orbit-card flex h-full min-h-0 flex-col overflow-hidden rounded-none border-x-0 bg-background shadow-none md:rounded-[var(--radius-xl)] md:border-x md:shadow-sm">
					<header className="flex min-h-14 shrink-0 items-center gap-1.5 border-b border-border/60 px-2 sm:min-h-16 sm:gap-2 sm:px-4">
						<Button
							variant="outline"
							size="sm"
							className="hidden font-medium sm:inline-flex"
							onClick={() => {
								setNavigationVersion((version) => version + 1);
								const now = new Date();
								setVisibleDate(
									view === "week"
										? formatDayKey(startOfWeek(now))
										: formatDayKey(now),
								);
								updateCalendar({
									date: formatDayKey(now),
									selected: formatDayKey(now),
								});
							}}
						>
							{t("오늘")}
						</Button>
						<div className="flex items-center gap-0.5">
							<Button
								variant="ghost"
								size="icon-sm"
								onClick={() => move(-1)}
								aria-label={t("이전 {0}", [
									view === "day"
										? t("날")
										: view === "week"
											? t("주")
											: t("달"),
								])}
							>
								<ChevronLeft />
							</Button>
							<Button
								variant="ghost"
								size="icon-sm"
								onClick={() => move(1)}
								aria-label={t("다음 {0}", [
									view === "day"
										? t("날")
										: view === "week"
											? t("주")
											: t("달"),
								])}
							>
								<ChevronRight />
							</Button>
						</div>
						<h2 className="min-w-0 flex-1 truncate px-1 text-base font-semibold tracking-tight sm:text-lg">
							{view === "day"
								? dayLabel(cursor, intlLocale)
								: view === "week"
									? weekLabel(visibleCursor, true, intlLocale)
									: monthLabel(visibleCursor, intlLocale)}
						</h2>
						<div className="hidden rounded-lg bg-muted/80 p-0.5 sm:flex">
							{(["day", "week", "month"] as const).map((value, index) => (
								<Button
									key={value}
									type="button"
									variant="ghost"
									size="sm"
									className={cn(
										"h-7 px-2.5",
										view === value &&
											"bg-background shadow-sm hover:bg-background",
									)}
									aria-pressed={view === value}
									onClick={() => chooseView(value)}
								>
									{value === "day"
										? t("일간")
										: value === "week"
											? t("주간")
											: t("월간")}
									<span className="ml-1 hidden text-[10px] text-muted-foreground sm:inline">
										{index + 1}
									</span>
								</Button>
							))}
						</div>
						<ScheduleDisplayMenu {...displayOptions} />
						<Button
							size="sm"
							aria-label={t("추가")}
							onClick={() => openNew(selectedDate)}
						>
							<Plus /> <span className="hidden sm:inline">{t("추가")}</span>
						</Button>
					</header>
					<div className="grid shrink-0 grid-cols-3 gap-1 border-b border-border/60 bg-muted/20 p-1.5 sm:hidden">
						{(["day", "week", "month"] as const).map((value) => (
							<Button
								key={value}
								variant="ghost"
								size="sm"
								className={cn(view === value && "bg-muted")}
								aria-pressed={view === value}
								onClick={() => chooseView(value)}
							>
								{value === "day"
									? t("일간")
									: value === "week"
										? t("주간")
										: t("월간")}
							</Button>
						))}
					</div>
					{dragError ? (
						<div className="shrink-0 border-b bg-destructive/5 px-4 py-2 text-xs text-destructive">
							{errorText(dragError)}
						</div>
					) : null}

					<div className="flex min-h-0 flex-1">
						<CalendarRail
							cursor={visibleCursor}
							selectedDate={selectedDate}
							selectedItems={selectedItems}
							displayOptions={displayOptions}
							onMoveMonth={(amount) =>
								updateCalendar({
									date: formatDayKey(addMonths(visibleCursor, amount)),
								})
							}
							onSelectDate={selectDate}
							onCreate={openNew}
							onOpen={openItem}
						/>

						<div className="flex min-w-0 flex-1 flex-col">
							{view !== "month" ? (
								<WeekView
									hourHeight={hourHeight}
									onHourHeightChange={setHourHeight}
									headerCollapsed={headerCollapsed}
									onHeaderCollapsedChange={setHeaderCollapsed}
									key={`${navigationVersion}:${view}:${view === "week" ? formatDayKey(startOfWeek(cursor)) : cursorKey}`}
									onVisibleDate={setVisibleDate}
									cursor={cursor}
									dayCount={view === "day" ? 1 : 7}
									dragGrabOffset={dragGrabOffset}
									byDay={byDay}
									today={today}
									selectedDate={selectedDate}
									onSelectDate={selectDate}
									onCreate={openNew}
									onOpen={openItem}
									draggingId={draggingId}
									dragOperation={dragOperation}
									dragTarget={dragTarget}
									onDragStart={startDrag}
									onResizeStart={startResize}
									onDragEnd={endDrag}
									onDragPreview={previewDrag}
									onDrop={dropOn}
								/>
							) : (
								<MonthView
									onVisibleDate={setVisibleDate}
									key={`${navigationVersion}:${cursor.getFullYear()}-${cursor.getMonth()}`}
									cursor={cursor}
									byDay={byDay}
									today={today}
									selectedDate={selectedDate}
									onSelectDate={selectDate}
									onCreate={openNew}
									onOpen={openItem}
									draggingId={draggingId}
									dragOperation={dragOperation}
									dragTarget={dragTarget}
									onDragStart={startDrag}
									onResizeStart={startResize}
									onDragEnd={endDrag}
									onDragPreview={previewDrag}
									onDrop={dropOn}
								/>
							)}
						</div>
					</div>
				</div>

				<RoutineCalendarEditor
					data={snapshot.routineData ?? EMPTY_ROUTINES}
					routineId={editingRoutine}
					onClose={() => setEditingRoutine(null)}
				/>
				<ScheduleEditor
					open={editor.open}
					onOpenChange={(open) =>
						setEditor((current) => ({ ...current, open }))
					}
					kind={editor.kind}
					item={editor.item}
					initialDate={editor.date}
					initialTime={editor.time}
					initialEnd={editor.end}
				/>
			</div>
		</CalendarRoutines.Provider>
	);
}

function MobileAgenda({
	items,
	date,
	onCreate,
	onOpen,
	compact = false,
}: {
	items: OrbitItem[];
	date: string;
	onCreate: (
		date: string,
		time?: string,
		kind?: EditorState["kind"],
		end?: string,
	) => void;
	onOpen: (item: OrbitItem) => void;
	compact?: boolean;
}) {
	const { t } = useI18n();

	if (items.length === 0) {
		return (
			<button
				type="button"
				onClick={() => onCreate(date)}
				className={cn(
					"flex w-full items-center justify-center gap-2 rounded-xl border border-dashed text-sm text-muted-foreground transition-colors hover:bg-muted/50",
					compact ? "min-h-14" : "min-h-28",
				)}
			>
				<Plus className="size-4" /> {t("추가")}
			</button>
		);
	}

	return (
		<div className="space-y-1.5">
			{items.map((item) => (
				<div key={item.id} className="relative">
					<button
						type="button"
						onClick={() => onOpen(item)}
						className="flex min-h-14 w-full items-stretch overflow-hidden rounded-xl border border-border/70 bg-background text-left shadow-sm transition-colors active:bg-muted/60"
					>
						<span className={cn("w-1 shrink-0", itemAccent(item))} />
						<span
							className={cn(
								"flex w-[4.7rem] shrink-0 flex-col justify-center border-r border-border/50 px-2.5 text-[11px] font-medium tabular-nums text-muted-foreground",
							)}
						>
							{timeOf(item.start ?? item.due) ? (
								<>
									<span className="text-sm text-foreground">
										{timeOf(item.start ?? item.due)}
									</span>
									{timeOf(item.end) ? (
										<span>
											{timeOf(item.end)}
											{t("까지")}
										</span>
									) : null}
								</>
							) : (
								<span>{t(itemTimeLabel(item))}</span>
							)}
						</span>
						<span
							className={cn(
								"min-w-0 flex-1 self-center px-3 py-2.5",
								item.type === "task" && "pl-9",
							)}
						>
							<span className="block truncate text-sm font-medium">
								<CalendarItemTitle item={item} />
							</span>
							<span className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
								{item.type === "event" ? (
									<CalendarDays className="size-3" />
								) : (
									<ListTodo className="size-3" />
								)}
								{isCalendarRoutine(item)
									? t("루틴")
									: item.type === "event"
										? t("일정")
										: t("할 일")}
								{spansMultipleDays(item) ? t("· 여러 날") : ""}
							</span>
						</span>
					</button>
					<CalendarTaskCheck
						item={item}
						className="left-[calc(4.7rem+1rem)] top-2.5"
					/>
				</div>
			))}
		</div>
	);
}

function CalendarRail({
	cursor,
	selectedDate,
	selectedItems,
	displayOptions,
	onMoveMonth,
	onSelectDate,
	onCreate,
	onOpen,
}: {
	cursor: Date;
	selectedDate: string;
	selectedItems: OrbitItem[];
	displayOptions: CalendarDisplayOptions;
	onMoveMonth: (amount: number) => void;
	onSelectDate: (date: string) => void;
	onCreate: (
		date: string,
		time?: string,
		kind?: EditorState["kind"],
		end?: string,
	) => void;
	onOpen: (item: OrbitItem) => void;
}) {
	const { t, intlLocale } = useI18n();

	const days = gridDays(cursor);
	const today = formatDayKey();
	return (
		<aside className="hidden w-60 shrink-0 flex-col border-r border-border/60 bg-muted/[0.12] xl:flex">
			<div className="border-b border-border/60 p-3.5">
				<div className="mb-2 flex items-center justify-between px-1">
					<p className="text-sm font-semibold">
						{monthLabel(cursor, intlLocale)}
					</p>
					<div className="flex items-center">
						<Button
							variant="ghost"
							size="icon-xs"
							onClick={() => onMoveMonth(-1)}
							aria-label={t("미니 캘린더 이전 달")}
						>
							<ChevronLeft />
						</Button>
						<Button
							variant="ghost"
							size="icon-xs"
							onClick={() => onMoveMonth(1)}
							aria-label={t("미니 캘린더 다음 달")}
						>
							<ChevronRight />
						</Button>
					</div>
				</div>
				<div className="grid grid-cols-7 text-center text-[10px] font-medium text-muted-foreground">
					{WEEKDAYS.map((day) => (
						<span key={day} className="py-1">
							{weekdayName(day, intlLocale)}
						</span>
					))}
				</div>
				<div className="grid grid-cols-7 gap-y-0.5">
					{days.map((day) => {
						const key = formatDayKey(day);
						const selected = key === selectedDate;
						return (
							<button
								key={key}
								type="button"
								onClick={() => onSelectDate(key)}
								aria-label={calendarDateLabel(key, intlLocale)}
								title={koreanHolidayName(key)}
								className={cn(
									"relative mx-auto grid size-7 place-items-center rounded-full text-[11px] tabular-nums transition-colors hover:bg-muted",
									day.getMonth() !== cursor.getMonth() &&
										"text-muted-foreground/40",
									!selected && key !== today && calendarDayTone(day),
									key === today && !selected && "font-semibold text-blue-600",
									selected &&
										"bg-foreground font-semibold text-background hover:bg-foreground",
								)}
							>
								{day.getDate()}
							</button>
						);
					})}
				</div>
			</div>

			<div className="border-b border-border/60 p-3.5">
				<ScheduleDisplayOptions {...displayOptions} />
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto p-3.5">
				<div className="mb-2 flex items-center justify-between gap-2 px-1">
					<div>
						<p className="text-sm font-semibold">
							{shortDayLabel(selectedDate, intlLocale)}
						</p>
						<HolidayLabel date={selectedDate} />
						<p className="text-[11px] text-muted-foreground">
							{selectedItems.length}
							{t("개 항목")}
						</p>
					</div>
					<CalendarCreateButton date={selectedDate} onCreate={onCreate} />
				</div>
				{selectedItems.length > 0 ? (
					<div className="space-y-1.5">
						{selectedItems.map((item) => (
							<div key={item.id} className="relative">
								<button
									type="button"
									onClick={() => onOpen(item)}
									className={cn(
										"flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left hover:bg-muted/70",
										item.type === "task" && "pl-9",
									)}
								>
									{item.type !== "task" ? (
										<span
											className={cn(
												"mt-1.5 size-2 shrink-0 rounded-full",
												itemAccent(item),
											)}
										/>
									) : null}
									<span className="min-w-0 flex-1">
										<span className="block truncate text-xs font-medium">
											<CalendarItemTitle item={item} />
										</span>
										<span className="mt-0.5 flex items-center gap-1 text-[10px] tabular-nums text-muted-foreground">
											<Clock3 className="size-2.5" /> {t(itemTimeLabel(item))}
										</span>
									</span>
								</button>
								<CalendarTaskCheck item={item} className="left-2 top-1.5" />
							</div>
						))}
					</div>
				) : (
					<div className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-xl border border-dashed text-center text-xs text-muted-foreground">
						<Circle className="size-4" />
						<span>{t("예정된 항목이 없습니다")}</span>
					</div>
				)}
			</div>
		</aside>
	);
}

function CurrentTimeIndicator({
	day,
	hourHeight,
}: {
	day: string;
	hourHeight: number;
}) {
	const [now, setNow] = useState<Date | null>(null);

	useEffect(() => {
		const update = () => {
			if (document.visibilityState === "visible") setNow(new Date());
		};
		update();
		const interval = window.setInterval(update, 5 * 60_000);
		document.addEventListener("visibilitychange", update);
		window.addEventListener("focus", update);
		return () => {
			window.clearInterval(interval);
			document.removeEventListener("visibilitychange", update);
			window.removeEventListener("focus", update);
		};
	}, []);

	if (!now || formatDayKey(now) !== day) return null;
	const hours =
		now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3_600;

	return (
		<div
			aria-hidden="true"
			data-calendar-current-time
			className="pointer-events-none absolute inset-x-0 z-20 border-t border-red-500"
			style={{ top: (hours - HOUR_START) * hourHeight }}
		>
			<span className="absolute -top-1 -left-1 size-2 rounded-full bg-red-500" />
		</div>
	);
}

function WeekView({
	hourHeight,
	onHourHeightChange,
	headerCollapsed,
	onHeaderCollapsedChange,
	cursor,
	onVisibleDate,
	dayCount,
	byDay: suppliedByDay,
	today,
	selectedDate,
	onSelectDate,
	onCreate,
	onOpen,
	draggingId,
	dragOperation,
	dragTarget,
	dragGrabOffset,
	onDragStart,
	onResizeStart,
	onDragEnd,
	onDragPreview,
	onDrop,
}: {
	hourHeight: number;
	onHourHeightChange: (height: number) => void;
	headerCollapsed: boolean;
	onHeaderCollapsedChange: (collapsed: boolean) => void;
	cursor: Date;
	onVisibleDate: (date: string) => void;
	dayCount: 1 | 7;
	byDay: Map<string, OrbitItem[]>;
	today: string;
	selectedDate: string;
	onSelectDate: (date: string) => void;
	onCreate: (
		date: string,
		time?: string,
		kind?: EditorState["kind"],
		end?: string,
	) => void;
	onOpen: (item: OrbitItem) => void;
	draggingId: string | null;
	dragOperation: DragOperation;
	dragTarget: DragTarget | null;
	dragGrabOffset: number;
	onDragStart: (
		item: OrbitItem,
		event: React.DragEvent<HTMLButtonElement>,
	) => void;
	onResizeStart: (
		item: OrbitItem,
		event: React.PointerEvent<HTMLButtonElement>,
		edge?: CalendarResizeEdge,
	) => void;
	onDragEnd: () => void;
	onDragPreview: (target: DragTarget | null) => void;
	onDrop: (
		target: DragTarget,
		transferredId?: string,
		operation?: DragOperation,
	) => void;
}) {
	const { t, intlLocale } = useI18n();

	const selectionRef = useRef<{
		pointerId: number;
		date: string;
		anchor: number;
		startX: number;
		startY: number;
		column: HTMLElement;
	} | null>(null);
	const [selection, setSelection] = useState<ReturnType<
		typeof calendarRangeSelection
	> | null>(null);
	useEffect(() => {
		const cancel = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			selectionRef.current = null;
			setSelection(null);
		};
		window.addEventListener("keydown", cancel);
		return () => window.removeEventListener("keydown", cancel);
	}, []);
	function updateSelection(event: React.PointerEvent<HTMLButtonElement>) {
		const drag = selectionRef.current;
		if (
			!drag ||
			event.pointerId !== drag.pointerId ||
			Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6
		)
			return null;
		const column =
			[
				...(scrollRef.current?.querySelectorAll<HTMLElement>(
					'[data-calendar-mode="time"]',
				) ?? []),
			].find((element) => {
				const rect = element.getBoundingClientRect();
				return event.clientX >= rect.left && event.clientX < rect.right;
			}) ?? drag.column;
		const current =
			((event.clientY - column.getBoundingClientRect().top) / hourHeight) * 60;
		return calendarRangeSelection(
			drag.date,
			drag.anchor,
			column.dataset.calendarDate ?? drag.date,
			current,
		);
	}
	const scrollRef = useRef<HTMLDivElement>(null);
	const headerRef = useRef<HTMLDivElement>(null);
	const suppressZoomClick = useCalendarTimeZoom({
		scrollRef,
		headerRef,
		hourHeight,
		onHourHeightChange,
		onGestureStart: () => {
			selectionRef.current = null;
			setSelection(null);
			if (draggingId) onDragEnd();
		},
	});
	const initialized = useRef(false);
	const pendingShift = useRef<{
		start: number;
		end: number;
		left: number;
	} | null>(null);
	const [viewportWidth, setViewportWidth] = useState(0);
	const [range, setRange] = useState({ start: -7, end: 13 });
	const columnWidth =
		dayCount === 1
			? Math.max(0, viewportWidth - 56)
			: Math.max(96, (viewportWidth - 56) / 7);
	useLayoutEffect(() => {
		const element = scrollRef.current;
		if (!element) return;
		const measure = () => setViewportWidth(element.clientWidth);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	const previousColumnWidth = useRef(columnWidth);
	useLayoutEffect(() => {
		const element = scrollRef.current;
		if (!element || viewportWidth === 0 || dayCount === 1) return;
		if (
			pendingShift.current?.start === range.start &&
			pendingShift.current.end === range.end
		) {
			element.scrollLeft = pendingShift.current.left;
			pendingShift.current = null;
		} else if (!initialized.current) {
			element.scrollLeft = -range.start * columnWidth;
			initialized.current = true;
		} else if (previousColumnWidth.current !== columnWidth) {
			element.scrollLeft =
				(element.scrollLeft / previousColumnWidth.current) * columnWidth;
		}
		element.style.setProperty(
			"--calendar-scroll-left",
			`${element.scrollLeft}px`,
		);
		previousColumnWidth.current = columnWidth;
	}, [columnWidth, viewportWidth, dayCount, range.start, range.end]);
	const [headerHeight, setHeaderHeight] = useState(80);
	useLayoutEffect(() => {
		const header = headerRef.current;
		if (!header) return;
		const measure = () =>
			setHeaderHeight(header.getBoundingClientRect().height);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(header);
		return () => observer.disconnect();
	}, []);
	const start = dayCount === 1 ? new Date(cursor) : startOfWeek(cursor);
	start.setHours(0, 0, 0, 0);
	const startTime = start.getTime();
	const days = useMemo(
		() =>
			Array.from(
				{ length: dayCount === 1 ? 1 : range.end - range.start + 1 },
				(_, index) =>
					addDays(
						new Date(startTime),
						dayCount === 1 ? 0 : range.start + index,
					),
			),
		[startTime, dayCount, range.start, range.end],
	);
	const byDay = useRoutineDays(suppliedByDay, days);
	const columns = days.length;
	const weekLayout = useMemo(() => buildWeekLayout(byDay, days), [byDay, days]);
	const hours = Array.from(
		{ length: HOUR_END - HOUR_START },
		(_, index) => HOUR_START + index,
	);
	// Leave room for the minimum-height label of an event just before midnight.
	const calendarHeight =
		(HOUR_END - HOUR_START) * hourHeight + MIN_TIMED_CARD_HEIGHT;
	const draggingItem = Array.from(byDay.values())
		.flat()
		.find((item) => item.id === draggingId);

	const currentHourHeight = useRef(hourHeight);
	useLayoutEffect(() => {
		currentHourHeight.current = hourHeight;
	}, [hourHeight]);
	useEffect(() => {
		const hour = formatDayKey(cursor) === today ? new Date().getHours() : 8;
		scrollRef.current?.scrollTo({
			top: Math.max(0, (hour - 2) * currentHourHeight.current),
			behavior: "auto",
		});
	}, [cursor, today]);

	function timeAt(clientY: number, element: HTMLElement) {
		return calendarMoveTime(
			clientY,
			element.getBoundingClientRect().top,
			hourHeight,
			dragGrabOffset,
		);
	}

	return (
		<div
			ref={scrollRef}
			data-calendar-week-scroll
			data-calendar-hour-height={hourHeight}
			onClickCapture={(event) => {
				if (suppressZoomClick()) {
					event.preventDefault();
					event.stopPropagation();
				}
			}}
			onScroll={(event) => {
				if (dayCount === 1 || !initialized.current || pendingShift.current)
					return;
				const element = event.currentTarget;
				if (!CSS.supports("animation-timeline", "--calendar-week-x")) {
					element.style.setProperty(
						"--calendar-scroll-left",
						`${element.scrollLeft}px`,
					);
				}
				const index = Math.floor((element.scrollLeft + 1) / columnWidth);
				onVisibleDate(formatDayKey(addDays(start, range.start + index)));
				const direction =
					element.scrollLeft < columnWidth * 2
						? -1
						: element.scrollWidth - element.scrollLeft - element.clientWidth <
								columnWidth * 2
							? 1
							: null;
				if (direction) {
					const next = extendCalendarWindow(range, direction, 7, 35);
					pendingShift.current = {
						...next,
						left: element.scrollLeft + (range.start - next.start) * columnWidth,
					};
					setRange(next);
				}
			}}
			className="relative min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain [touch-action:pan-x_pan-y] [overflow-anchor:none]"
			style={
				{
					"--calendar-sticky-top": `${headerHeight + 4}px`,
				} as CSSProperties
			}
		>
			<div style={{ width: 56 + columns * columnWidth }}>
				<div
					ref={headerRef}
					className="sticky top-0 z-30 bg-background/95 backdrop-blur"
				>
					<div
						className="grid border-b"
						style={{
							gridTemplateColumns: `56px repeat(${columns}, minmax(0, 1fr))`,
						}}
					>
						<div className="sticky left-0 z-40 border-r bg-background" />
						{days.map((day) => {
							const key = formatDayKey(day);
							return (
								<button
									key={key}
									type="button"
									aria-label={calendarDateLabel(key, intlLocale)}
									className={cn(
										"relative border-r px-2 py-2 text-center last:border-r-0 hover:bg-muted/60",
										dayCount > 1 && key === selectedDate && "bg-muted/45",
									)}
									onClick={() => onSelectDate(key)}
								>
									<span
										className={cn(
											"block text-[11px] text-muted-foreground",
											calendarDayTone(day),
										)}
									>
										{weekdayName(day.getDay(), intlLocale)}
									</span>
									<span
										className={cn(
											"mt-1 inline-grid size-7 place-items-center rounded-full text-sm font-semibold",
											key !== today && calendarDayTone(day),
											key === today && "bg-blue-600 text-white",
										)}
									>
										{day.getDate() === 1
											? `${day.getMonth() + 1}/1`
											: day.getDate()}
									</span>
									<HolidayLabel date={key} />
								</button>
							);
						})}
					</div>

					<div
						className="grid border-b"
						style={{
							gridTemplateColumns: `56px repeat(${columns}, minmax(0, 1fr))`,
						}}
					>
						<div className="sticky left-0 z-40 border-r bg-background text-muted-foreground">
							<button
								type="button"
								className="flex min-h-11 w-full flex-col items-center justify-center gap-0.5 px-0.5 text-[9px] hover:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
								aria-label={`${t("종일")} ${t(headerCollapsed ? "펼치기" : "접기")}`}
								aria-expanded={!headerCollapsed}
								aria-controls="calendar-all-day-items"
								onClick={() => onHeaderCollapsedChange(!headerCollapsed)}
							>
								<ChevronDown
									className={cn(
										"size-3.5 transition-transform duration-200 motion-reduce:transition-none",
										headerCollapsed && "-rotate-90",
									)}
								/>
								<span>{t("종일")}</span>
							</button>
						</div>
						<div
							data-calendar-header
							id="calendar-all-day-items"
							aria-hidden={headerCollapsed}
							inert={headerCollapsed}
							className={cn(
								"relative col-start-2 -col-end-1 grid transition-[height,opacity] duration-200 ease-out motion-reduce:transition-none",
								headerCollapsed
									? "overflow-hidden opacity-0"
									: "overflow-y-auto opacity-100",
							)}
							style={{
								gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
								height: headerCollapsed
									? 44
									: `min(160px, 22dvh, ${Math.max(44, weekLayout.laneCount * MONTH_LANE_HEIGHT + 8)}px)`,
							}}
						>
							{days.map((day) => {
								const key = formatDayKey(day);
								const mode =
									draggingItem &&
									spansMultipleDays(draggingItem) &&
									timeOf(draggingItem.start)
										? "keep-time"
										: "all-day";
								const target: DragTarget = { date: key, mode };
								return (
									// biome-ignore lint/a11y/noStaticElementInteractions: Calendar cells accept native schedule drops and pointer resizing.
									<div
										key={key}
										data-calendar-date={key}
										data-calendar-mode={mode}
										className={cn(
											"min-w-0 border-r last:border-r-0 transition-colors hover:bg-muted/50",
											key === today && "bg-blue-500/[0.025]",
											dragTarget?.date === key &&
												dragTarget.mode !== "time" &&
												"bg-accent ring-1 ring-inset ring-foreground/20",
										)}
										onDragOver={(event) => {
											event.preventDefault();
											event.dataTransfer.dropEffect = "move";
											onDragPreview(target);
										}}
										onDragEnter={(event) => {
											event.preventDefault();
											onDragPreview(target);
										}}
										onDragLeave={(event) => {
											if (
												event.relatedTarget instanceof Node &&
												event.currentTarget.contains(event.relatedTarget)
											)
												return;
											onDragPreview(null);
										}}
										onDrop={(event) => {
											event.preventDefault();
											const payload = dragPayload(event.dataTransfer);
											onDrop(target, payload.id, payload.operation);
										}}
									/>
								);
							})}
							{weekLayout.segments.map((segment) => {
								const rangeLabel = spansMultipleDays(segment.item)
									? `${segment.item.start?.slice(5, 10).replace("-", "/")}${timeOf(segment.item.start) ? ` ${timeOf(segment.item.start)}` : ""}–${segment.item.end?.slice(5, 10).replace("-", "/")}${timeOf(segment.item.end) ? ` ${timeOf(segment.item.end)}` : ""}`
									: itemTimeLabel(segment.item);
								function targetAt(
									event: React.DragEvent<HTMLDivElement>,
								): DragTarget {
									const rect = (
										event.currentTarget.parentElement ?? event.currentTarget
									).getBoundingClientRect();
									const column = Math.max(
										0,
										Math.min(
											columns - 1,
											Math.floor(
												(event.clientX - rect.left) / (rect.width / columns),
											),
										),
									);
									return {
										date: formatDayKey(days[column]),
										mode:
											draggingItem &&
											spansMultipleDays(draggingItem) &&
											timeOf(draggingItem.start)
												? "keep-time"
												: "all-day",
									};
								}
								return (
									// biome-ignore lint/a11y/noStaticElementInteractions: Spanning bars accept drops across their dates.
									<div
										key={segment.item.id}
										className="absolute z-10 min-w-0"
										style={{
											top: 4 + segment.lane * MONTH_LANE_HEIGHT,
											left: `calc(${(segment.startColumn / columns) * 100}% + 3px)`,
											width: `calc(${((segment.endColumn - segment.startColumn + 1) / columns) * 100}% - 6px)`,
										}}
										onDragOver={(event) => {
											event.preventDefault();
											event.dataTransfer.dropEffect = "move";
											onDragPreview(targetAt(event));
										}}
										onDragLeave={(event) => {
											if (
												event.relatedTarget instanceof Node &&
												event.currentTarget.contains(event.relatedTarget)
											)
												return;
											onDragPreview(null);
										}}
										onDrop={(event) => {
											event.preventDefault();
											event.stopPropagation();
											const payload = dragPayload(event.dataTransfer);
											onDrop(targetAt(event), payload.id, payload.operation);
										}}
									>
										<CalendarEvent
											item={segment.item}
											compact
											showRange={spansMultipleDays(segment.item)}
											horizontalScroll={{
												start: segment.startColumn * columnWidth,
												width:
													(segment.endColumn - segment.startColumn + 1) *
														columnWidth -
													6,
												max: Math.max(
													1,
													56 + columns * columnWidth - viewportWidth,
												),
											}}
											displayTime={rangeLabel}
											dayKey={segment.startKey}
											resizeEndKey={segment.endKey}
											onClick={() => onOpen(segment.item)}
											onDragStart={(event) => onDragStart(segment.item, event)}
											onResizeStart={(event, edge) =>
												onResizeStart(segment.item, event, edge)
											}
											onDragEnd={onDragEnd}
											dragging={draggingId === segment.item.id}
											dragOperation={dragOperation}
										/>
									</div>
								);
							})}
						</div>
					</div>
				</div>

				<div
					className="grid"
					style={{
						gridTemplateColumns: `56px repeat(${columns}, minmax(0, 1fr))`,
					}}
				>
					<div
						className="sticky left-0 z-20 border-r bg-background"
						style={{ height: calendarHeight }}
					>
						{hours.map((hour) => (
							<span
								key={hour}
								className={cn(
									"absolute right-2 text-[10px] text-muted-foreground",
									hour === HOUR_START ? "translate-y-1" : "-translate-y-1/2",
								)}
								style={{ top: (hour - HOUR_START) * hourHeight }}
							>
								{String(hour).padStart(2, "0")}:00
							</span>
						))}
					</div>
					{days.map((day) => {
						const key = formatDayKey(day);
						const timed = weekLayout.timedByDay.get(key) ?? [];
						const selectedRange = selection
							? calendarSelectionDay(selection, key)
							: null;
						const previewItem =
							dragOperation === "move" &&
							draggingItem &&
							dragTarget?.mode === "time" &&
							dragTarget.time
								? moveCalendarEntry(draggingItem, dragTarget)
								: null;
						const previewRange =
							previewItem &&
							!isCalendarHeaderItem(previewItem) &&
							visibleDayKeys(previewItem).includes(key)
								? timedRangeForDay(previewItem, key)
								: null;
						const previewLayout =
							previewItem && previewRange
								? layoutTimedItems(
										[
											...timed.filter((item) => item.id !== previewItem.id),
											previewItem,
										],
										key,
										hourHeight,
									).find((entry) => entry.item.id === previewItem.id)
								: null;
						return (
							// biome-ignore lint/a11y/noStaticElementInteractions: Timeline columns accept native schedule drops.
							<div
								key={key}
								className={cn(
									"relative border-r last:border-r-0",
									key === today && "bg-blue-500/[0.025]",
								)}
								style={{ height: calendarHeight }}
								data-calendar-date={key}
								data-calendar-mode="time"
								data-calendar-hour-height={hourHeight}
								onDragOver={(event) => {
									event.preventDefault();
									event.dataTransfer.dropEffect = "move";
									onDragPreview({
										date: key,
										mode: "time",
										time: timeAt(event.clientY, event.currentTarget),
									});
								}}
								onDragEnter={(event) => {
									event.preventDefault();
									onDragPreview({
										date: key,
										mode: "time",
										time: timeAt(event.clientY, event.currentTarget),
									});
								}}
								onDragLeave={(event) => {
									if (
										event.relatedTarget instanceof Node &&
										event.currentTarget.contains(event.relatedTarget)
									)
										return;
									onDragPreview(null);
								}}
								onDrop={(event) => {
									event.preventDefault();
									const payload = dragPayload(event.dataTransfer);
									onDrop(
										{
											date: key,
											mode: "time",
											time: timeAt(event.clientY, event.currentTarget),
										},
										payload.id,
										payload.operation,
									);
								}}
							>
								{Array.from({ length: hours.length * 2 }, (_, index) => {
									const time = `${String(Math.floor(index / 2)).padStart(2, "0")}:${index % 2 ? "30" : "00"}`;
									return (
										<button
											key={time}
											type="button"
											aria-label={t("{0} {1} 항목 추가", [key, time])}
											className={cn(
												"absolute inset-x-0 z-0 w-full cursor-crosshair select-none text-left transition-colors [&:hover]:bg-foreground/[0.06] focus-visible:bg-foreground/[0.06] focus-visible:outline focus-visible:outline-1 focus-visible:outline-ring",
												draggingId && "pointer-events-none",
											)}
											style={{
												top: (index * hourHeight) / 2,
												height: hourHeight / 2,
											}}
											data-calendar-slot={time}
											onPointerDown={(event) => {
												if (
													event.button !== 0 ||
													!event.isPrimary ||
													draggingId ||
													event.pointerType === "touch"
												)
													return;
												const column = event.currentTarget.closest<HTMLElement>(
													'[data-calendar-mode="time"]',
												);
												if (!column) return;
												event.preventDefault();
												event.currentTarget.setPointerCapture(event.pointerId);
												selectionRef.current = {
													pointerId: event.pointerId,
													date: key,
													anchor:
														((event.clientY -
															column.getBoundingClientRect().top) /
															hourHeight) *
														60,
													startX: event.clientX,
													startY: event.clientY,
													column,
												};
											}}
											onPointerMove={(event) =>
												setSelection(updateSelection(event))
											}
											onPointerUp={(event) => {
												const range = updateSelection(event);
												selectionRef.current = null;
												setSelection(null);
												if (
													event.currentTarget.hasPointerCapture(event.pointerId)
												)
													event.currentTarget.releasePointerCapture(
														event.pointerId,
													);
												if (range)
													onCreate(
														range.date,
														range.time,
														"event",
														range.endAt,
													);
											}}
											onLostPointerCapture={() => {
												selectionRef.current = null;
												setSelection(null);
											}}
											onPointerCancel={() => {
												selectionRef.current = null;
												setSelection(null);
											}}
											onClick={(event) => {
												if (
													(event.nativeEvent as PointerEvent).pointerType ===
														"touch" ||
													(event.detail === 0 &&
														event.clientX === 0 &&
														event.clientY === 0)
												)
													onCreate(key, time);
											}}
										/>
									);
								})}
								{selectedRange ? (
									<div
										data-calendar-selection
										className="pointer-events-none absolute inset-x-1 z-20 rounded-md border border-blue-500 bg-blue-500/20 px-2 py-1 text-xs text-blue-700 dark:text-blue-200"
										style={{
											top: (selectedRange.start / 60) * hourHeight,
											height:
												((selectedRange.end - selectedRange.start) / 60) *
												hourHeight,
										}}
									>
										{String(Math.floor(selectedRange.start / 60)).padStart(
											2,
											"0",
										)}
										:{String(selectedRange.start % 60).padStart(2, "0")}–
										{String(Math.floor(selectedRange.end / 60)).padStart(
											2,
											"0",
										)}
										:{String(selectedRange.end % 60).padStart(2, "0")}
									</div>
								) : null}
								{hours.map((hour) => (
									<div
										key={hour}
										className="pointer-events-none absolute inset-x-0 border-t"
										style={{ top: (hour - HOUR_START) * hourHeight }}
									/>
								))}
								{hours.map((hour) => (
									<div
										key={`${hour}:30`}
										className="pointer-events-none absolute inset-x-0 border-t border-dashed border-border/35"
										style={{
											top: (hour - HOUR_START + 0.5) * hourHeight,
										}}
									/>
								))}
								<CurrentTimeIndicator day={key} hourHeight={hourHeight} />
								{previewItem &&
								previewRange &&
								previewLayout &&
								dragTarget?.time ? (
									<div
										data-calendar-drag-preview
										aria-hidden="true"
										className="pointer-events-none absolute z-20 opacity-65"
										style={{
											top: previewLayout.top,
											height: previewLayout.height,
											left: `calc(${(previewLayout.column / previewLayout.columns) * 100}% + 3px)`,
											width: `calc(${100 / previewLayout.columns}% - 5px)`,
										}}
									>
										<CalendarEvent
											item={previewItem}
											dayKey={key}
											displayTime={
												previewRange.label ? t(previewRange.label) : undefined
											}
											dense={previewLayout.height < 56}
											stickyContent={previewLayout.height >= 56}
											onClick={() => {}}
											onDragStart={() => {}}
											onDragEnd={() => {}}
										/>
									</div>
								) : null}
								{layoutTimedItems(timed, key, hourHeight).map((layout) => {
									const { top, height } = layout;
									return (
										<div
											key={layout.item.id}
											className="absolute z-10"
											style={{
												top,
												height,
												left: `calc(${(layout.column / layout.columns) * 100}% + 3px)`,
												width: `calc(${100 / layout.columns}% - 5px)`,
											}}
										>
											<CalendarEvent
												item={layout.item}
												dense={height < 56}
												stickyContent={height >= 56}
												dayKey={key}
												displayTime={layout.label ? t(layout.label) : undefined}
												resizeEndKey={key}
												onClick={() => onOpen(layout.item)}
												onDragStart={(event) => onDragStart(layout.item, event)}
												onResizeStart={(event, edge) =>
													onResizeStart(layout.item, event, edge)
												}
												onDragEnd={onDragEnd}
												dragging={draggingId === layout.item.id}
												dragOperation={dragOperation}
											/>
										</div>
									);
								})}
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
}

function MonthView(
	props: ComponentProps<typeof MonthGrid> & {
		onVisibleDate: (date: string) => void;
	},
) {
	const { t, intlLocale } = useI18n();

	const { cursor, selectedDate, byDay, onCreate, onOpen, onVisibleDate } =
		props;
	const isMobile = useIsMobile();
	const [agendaExpanded, setAgendaExpanded] = useState(false);
	const selectedItems =
		useRoutineDays(byDay, [parseDayKey(selectedDate)]).get(selectedDate) ?? [];
	const scrollRef = useRef<HTMLDivElement>(null);
	const currentWeekRef = useRef<HTMLElement>(null);
	const initialized = useRef(false);
	const pendingShift = useRef<{
		start: number;
		end: number;
		anchor: HTMLElement;
		offset: number;
		top: number;
	} | null>(null);
	const [viewportHeight, setViewportHeight] = useState(0);
	const [range, setRange] = useState({ start: -3, end: 6 });
	const firstWeek = startOfWeek(startOfMonth(cursor));

	useLayoutEffect(() => {
		const element = scrollRef.current;
		if (!element) return;
		const measure = () => setViewportHeight(element.clientHeight);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	useLayoutEffect(() => {
		const element = scrollRef.current;
		if (!element) return;
		if (
			pendingShift.current?.start === range.start &&
			pendingShift.current.end === range.end
		) {
			const previous = pendingShift.current;
			element.scrollTop =
				previous.top + previous.anchor.offsetTop - previous.offset;
			pendingShift.current = null;
		} else if (
			!initialized.current &&
			viewportHeight > 0 &&
			currentWeekRef.current
		) {
			element.scrollTop = currentWeekRef.current.offsetTop - 40;
			initialized.current = true;
		}
	}, [range.start, range.end, viewportHeight]);

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div
				ref={scrollRef}
				data-calendar-month-scroll
				className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain [overflow-anchor:none]"
				onScroll={(event) => {
					if (!initialized.current || pendingShift.current) return;
					const element = event.currentTarget;
					const top = element.getBoundingClientRect().top + 40;
					const visibleWeek = Array.from(
						element.querySelectorAll<HTMLElement>("[data-calendar-week]"),
					).find((row) => row.getBoundingClientRect().bottom > top + 1);
					if (visibleWeek?.dataset.calendarWeek)
						onVisibleDate(
							formatDayKey(
								addDays(parseDayKey(visibleWeek.dataset.calendarWeek), 4),
							),
						);
					const direction =
						element.scrollTop < 240
							? -1
							: element.scrollHeight -
										element.scrollTop -
										element.clientHeight <
									240
								? 1
								: null;
					if (direction && visibleWeek) {
						const next = extendCalendarWindow(range, direction, 6, 22);
						pendingShift.current = {
							...next,
							anchor: visibleWeek,
							offset: visibleWeek.offsetTop,
							top: element.scrollTop,
						};
						setRange(next);
					}
				}}
			>
				<div className="sticky top-0 z-30 grid h-10 grid-cols-7 border-b bg-background/95 backdrop-blur">
					{WEEKDAYS.map((day, index) => (
						<div
							key={weekdayName(day, intlLocale)}
							className={cn(
								"flex items-center justify-center border-r text-[11px] font-medium text-muted-foreground last:border-r-0",
								(index === 0 || index === 6) && "bg-muted/20",
								index === 0 && "text-red-600 dark:text-red-400",
							)}
						>
							{weekdayName(day, intlLocale)}
						</div>
					))}
				</div>
				{Array.from({ length: range.end - range.start + 1 }, (_, index) => {
					const offset = range.start + index;
					const week = addDays(firstWeek, offset * 7);
					return (
						<section
							key={formatDayKey(week)}
							ref={offset === 0 ? currentWeekRef : undefined}
							data-calendar-week={formatDayKey(week)}
							aria-label={weekLabel(week, false, intlLocale)}
						>
							<MonthGrid
								{...props}
								days={Array.from({ length: 7 }, (_, day) => addDays(week, day))}
								minHeight={Math.max(112, (viewportHeight - 40) / 5)}
							/>
						</section>
					);
				})}
			</div>
			{isMobile ? (
				<div
					data-calendar-month-agenda
					className="shrink-0 border-t bg-background"
				>
					<div className="flex min-h-11 items-center gap-2 px-3">
						<button
							type="button"
							className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left text-xs"
							aria-expanded={agendaExpanded}
							aria-controls="calendar-month-agenda-items"
							aria-label={`${shortDayLabel(selectedDate, intlLocale)} ${t(agendaExpanded ? "접기" : "펼치기")}`}
							onClick={() => setAgendaExpanded((expanded) => !expanded)}
						>
							<ChevronDown
								className={cn(
									"size-4 shrink-0 transition-transform duration-200 motion-reduce:transition-none",
									!agendaExpanded && "rotate-180",
								)}
							/>
							<span className="truncate font-medium">
								{shortDayLabel(selectedDate, intlLocale)}
							</span>
							<span className="shrink-0 text-muted-foreground">
								{t("{0}개 항목", [selectedItems.length])}
							</span>
						</button>
						<CalendarCreateButton date={selectedDate} onCreate={onCreate} />
					</div>
					<div
						id="calendar-month-agenda-items"
						aria-hidden={!agendaExpanded}
						inert={!agendaExpanded}
						className="grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none"
						style={{
							gridTemplateRows: agendaExpanded ? "1fr" : "0fr",
							opacity: agendaExpanded ? 1 : 0,
						}}
					>
						<div className="min-h-0 overflow-hidden">
							<div className="max-h-[min(28dvh,220px)] overflow-y-auto overscroll-contain px-3 pb-3">
								<MobileAgenda
									items={selectedItems}
									date={selectedDate}
									onCreate={onCreate}
									onOpen={onOpen}
									compact
								/>
							</div>
						</div>
					</div>
				</div>
			) : null}
		</div>
	);
}

function MonthGrid({
	cursor,
	days: suppliedDays,
	minHeight = 0,
	byDay: suppliedByDay,
	today,
	selectedDate,
	onSelectDate,
	onCreate,
	onOpen,
	draggingId,
	dragOperation,
	dragTarget,
	onDragStart,
	onResizeStart,
	onDragEnd,
	onDragPreview,
	onDrop,
}: {
	cursor: Date;
	days?: Date[];
	minHeight?: number;
	byDay: Map<string, OrbitItem[]>;
	today: string;
	selectedDate: string;
	onSelectDate: (date: string) => void;
	onCreate: (
		date: string,
		time?: string,
		kind?: EditorState["kind"],
		end?: string,
	) => void;
	onOpen: (item: OrbitItem) => void;
	draggingId: string | null;
	dragOperation: DragOperation;
	dragTarget: DragTarget | null;
	onDragStart: (
		item: OrbitItem,
		event: React.DragEvent<HTMLButtonElement>,
	) => void;
	onResizeStart: (
		item: OrbitItem,
		event: React.PointerEvent<HTMLButtonElement>,
		edge?: CalendarResizeEdge,
	) => void;
	onDragEnd: () => void;
	onDragPreview: (target: DragTarget | null) => void;
	onDrop: (
		target: DragTarget,
		transferredId?: string,
		operation?: DragOperation,
	) => void;
}) {
	const { t, intlLocale } = useI18n();

	const days = suppliedDays ?? gridDays(cursor);
	const byDay = useRoutineDays(suppliedByDay, days);
	const monthLayout = buildMonthLayout(byDay, days);
	const rowHeights = monthLayout.rowLaneCounts.map((count) =>
		Math.max(112, MONTH_ITEMS_TOP + count * MONTH_LANE_HEIGHT + 6),
	);
	const gridTemplateRows = rowHeights
		.map((height) => `minmax(${height}px, 1fr)`)
		.join(" ");
	return (
		<div className="flex flex-col" style={{ minHeight }}>
			<div className="flex min-w-0 flex-1 flex-col">
				<div
					className="relative flex-1"
					style={{
						minHeight: rowHeights.reduce((sum, height) => sum + height, 0),
					}}
				>
					<div
						className="absolute inset-0 grid grid-cols-7"
						style={{ gridTemplateRows }}
					>
						{days.map((day) => {
							const key = formatDayKey(day);
							return (
								// biome-ignore lint/a11y/noStaticElementInteractions: Month cells accept native date drops.
								<div
									key={key}
									className={cn(
										"group/day relative min-h-28 border-r border-b p-0.5 sm:p-1.5 last:border-r-0",
										(day.getDay() === 0 || day.getDay() === 6) &&
											"bg-muted/[0.12]",
										Boolean(koreanHolidayName(key)) && "bg-red-500/[0.025]",
										!suppliedDays &&
											day.getMonth() !== cursor.getMonth() &&
											"bg-muted/25 text-muted-foreground",
										key === selectedDate && key !== today && "bg-muted/[0.16]",
										key === today && "bg-blue-500/[0.04]",
										dragTarget?.date === key &&
											dragTarget.mode === "keep-time" &&
											"bg-accent ring-1 ring-inset ring-foreground/20",
									)}
									data-calendar-date={key}
									data-calendar-mode="keep-time"
									onDragOver={(event) => {
										event.preventDefault();
										event.dataTransfer.dropEffect = "move";
										onDragPreview({ date: key, mode: "keep-time" });
									}}
									onDragEnter={(event) => {
										event.preventDefault();
										onDragPreview({ date: key, mode: "keep-time" });
									}}
									onDragLeave={(event) => {
										if (
											event.relatedTarget instanceof Node &&
											event.currentTarget.contains(event.relatedTarget)
										)
											return;
										onDragPreview(null);
									}}
									onDrop={(event) => {
										event.preventDefault();
										const payload = dragPayload(event.dataTransfer);
										onDrop(
											{ date: key, mode: "keep-time" },
											payload.id,
											payload.operation,
										);
									}}
									onDoubleClick={() => onCreate(key)}
								>
									<div className="flex h-7 items-center justify-between">
										<button
											type="button"
											onClick={() => onSelectDate(key)}
											aria-label={calendarDateLabel(key, intlLocale)}
											className={cn(
												"relative z-20 grid size-7 place-items-center rounded-full text-xs font-medium tabular-nums hover:bg-muted",
												key !== today && calendarDayTone(day),
												key === today &&
													"bg-blue-600 text-white hover:bg-blue-600",
												key === selectedDate &&
													key !== today &&
													"bg-muted font-semibold",
												day.getDate() === 1 && "w-auto whitespace-nowrap px-1",
											)}
										>
											{day.getDate() === 1
												? t("{0}월 1일", [day.getMonth() + 1])
												: day.getDate()}
										</button>
										<CalendarCreateButton
											date={key}
											onCreate={onCreate}
											className={cn(
												"relative z-20 size-5 opacity-100 transition-opacity group-hover/day:opacity-100 focus:opacity-100 sm:size-6 sm:opacity-0",
												key !== selectedDate && "hidden sm:inline-flex",
											)}
										/>
									</div>
									<HolidayLabel date={key} className="px-1" />
								</div>
							);
						})}
					</div>

					<div
						className="pointer-events-none absolute inset-0 z-10 grid grid-cols-7"
						style={{ gridTemplateRows }}
					>
						{monthLayout.segments.map((segment) => (
							<div
								key={`${segment.item.id}:${segment.row}`}
								className="pointer-events-none min-w-0 px-0.5"
								style={{
									gridColumn: `${segment.startColumn + 1} / ${segment.endColumn + 2}`,
									gridRow: segment.row + 1,
									paddingTop:
										MONTH_ITEMS_TOP + segment.lane * MONTH_LANE_HEIGHT,
								}}
							>
								{/* biome-ignore lint/a11y/noStaticElementInteractions: Calendar bars accept native drag-and-drop across their date span. */}
								<div
									className="pointer-events-auto h-6 min-w-0"
									onDragOver={(event) => {
										event.preventDefault();
										event.dataTransfer.dropEffect = "move";
										const columns = segment.endColumn - segment.startColumn + 1;
										const columnWidth =
											event.currentTarget.clientWidth / columns;
										const offset = Math.min(
											columns - 1,
											Math.max(
												0,
												Math.floor(
													(event.clientX -
														event.currentTarget.getBoundingClientRect().left) /
														columnWidth,
												),
											),
										);
										onDragPreview({
											date: formatDayKey(
												addDays(parseDayKey(segment.startKey), offset),
											),
											mode: "keep-time",
										});
									}}
									onDrop={(event) => {
										event.preventDefault();
										event.stopPropagation();
										const columns = segment.endColumn - segment.startColumn + 1;
										const columnWidth =
											event.currentTarget.clientWidth / columns;
										const offset = Math.min(
											columns - 1,
											Math.max(
												0,
												Math.floor(
													(event.clientX -
														event.currentTarget.getBoundingClientRect().left) /
														columnWidth,
												),
											),
										);
										const payload = dragPayload(event.dataTransfer);
										onDrop(
											{
												date: formatDayKey(
													addDays(parseDayKey(segment.startKey), offset),
												),
												mode: "keep-time",
											},
											payload.id,
											payload.operation,
										);
									}}
								>
									<CalendarEvent
										item={segment.item}
										compact
										dayKey={segment.startKey}
										resizeEndKey={segment.endKey}
										onClick={() => onOpen(segment.item)}
										onDragStart={(event) => onDragStart(segment.item, event)}
										onResizeStart={(event, edge) =>
											onResizeStart(segment.item, event, edge)
										}
										onDragEnd={onDragEnd}
										dragging={draggingId === segment.item.id}
										dragOperation={dragOperation}
									/>
								</div>
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}
