import { useNavigate, useSearch } from "@tanstack/react-router";
import {
	CalendarDays,
	ChevronLeft,
	ChevronRight,
	Circle,
	Clock3,
	ListTodo,
	Plus,
} from "lucide-react";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { buildMonthLayout } from "#/lib/orbit/calendar-layout";
import {
	calendarMoveTime,
	calendarResizeTime,
	type CalendarDragTarget as DragTarget,
	resizeCalendarItem as resizeScheduledItem,
} from "#/lib/orbit/calendar-resize";
import { mutateOrbit } from "#/lib/orbit/functions";
import { itemColor } from "#/lib/orbit/item-colors";
import { koreanHolidayName } from "#/lib/orbit/korean-holidays";
import type { CalendarSearch } from "#/lib/orbit/navigation-search";
import { isPendingItemId } from "#/lib/orbit/optimistic-mutations";
import { formatDayKey, itemDayKey } from "#/lib/orbit/para";
import { visibleScheduleCategory } from "#/lib/orbit/schedule-categories";
import type { OrbitItem, OrbitSnapshot } from "#/lib/orbit/schema";
import {
	type CalendarDisplayOptions,
	ScheduleDisplayMenu,
	ScheduleDisplayOptions,
} from "@/components/schedule-categories";
import { ScheduleEditor } from "@/components/schedule-editor";
import { TaskCheck, taskTitleClass } from "@/components/task-check";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { useKoreanHolidays } from "@/hooks/use-korean-holidays";
import { useIsMobile } from "@/hooks/use-mobile";
import { useTaskToggle } from "@/hooks/use-task-toggle";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const HOUR_START = 0;
const HOUR_END = 24;
const HOUR_HEIGHT = 56;
const MONTH_ITEMS_TOP = 56;
const MONTH_LANE_HEIGHT = 26;

function calendarDayTone(day: Date) {
	return day.getDay() === 0 || koreanHolidayName(formatDayKey(day))
		? "text-red-600 dark:text-red-400"
		: "";
}

function calendarDateLabel(day: string) {
	const holiday = koreanHolidayName(day);
	return holiday ? `${shortDayLabel(day)} · ${holiday}` : shortDayLabel(day);
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

type CalendarView = "day" | "week" | "month";
type EditorState = {
	open: boolean;
	kind: "event" | "task";
	item?: OrbitItem;
	date?: string;
	time?: string;
};
type DragOperation = "move" | "resize";
type CalendarVisibility = {
	event: boolean;
	task: boolean;
};

const CalendarTasks = createContext<ReturnType<typeof useTaskToggle> | null>(
	null,
);

function CalendarTaskCheck({
	item,
	className,
}: {
	item: OrbitItem;
	className?: string;
}) {
	const tasks = useContext(CalendarTasks);
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
				"absolute left-1 top-1/2 z-20 -translate-y-1/2 after:inset-0",
				className,
			)}
			aria-label={checked ? `${item.title} 다시 열기` : `${item.title} 완료`}
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
	onCreate: (date: string, time?: string, kind?: EditorState["kind"]) => void;
	className?: string;
}) {
	const [open, setOpen] = useState(false);
	function choose(kind: EditorState["kind"]) {
		setOpen(false);
		onCreate(date, undefined, kind);
	}
	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button
					variant="ghost"
					size="icon-xs"
					className={className}
					aria-label={`${date} 항목 추가`}
					onClick={(event) => event.stopPropagation()}
					onDoubleClick={(event) => event.stopPropagation()}
				>
					<Plus />
				</Button>
			</DialogTrigger>
			<DialogContent className="max-w-sm gap-4 p-4 sm:p-5">
				<DialogTitle>{shortDayLabel(date)}</DialogTitle>
				<DialogDescription className="sr-only">
					추가할 항목을 선택하세요.
				</DialogDescription>
				<div className="grid grid-cols-2 gap-3">
					<Button
						variant="outline"
						className="h-28 flex-col gap-3 rounded-xl text-base"
						onClick={() => choose("task")}
					>
						<ListTodo className="size-7" /> 할 일
					</Button>
					<Button
						variant="outline"
						className="h-28 flex-col gap-3 rounded-xl text-base"
						onClick={() => choose("event")}
					>
						<CalendarDays className="size-7" /> 일정
					</Button>
				</div>
			</DialogContent>
		</Dialog>
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
	return (
		<span
			className={taskTitleClass(
				item.type === "task" &&
					(tasks?.isChecked(item) ?? item.status === "done"),
				className,
			)}
		>
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

function minutesOf(value?: string) {
	const time = timeOf(value);
	if (!time) return null;
	const [hour, minute] = time.split(":").map(Number);
	return hour * 60 + minute;
}

function dateTime(date: Date) {
	const hour = String(date.getHours()).padStart(2, "0");
	const minute = String(date.getMinutes()).padStart(2, "0");
	const second = String(date.getSeconds()).padStart(2, "0");
	return `${formatDayKey(date)}T${hour}:${minute}:${second}`;
}

function durationMinutes(item: OrbitItem) {
	if (!item.start || !item.end || !timeOf(item.start) || !timeOf(item.end)) {
		return item.type === "event" ? 60 : 30;
	}
	const duration =
		(new Date(item.end).getTime() - new Date(item.start).getTime()) / 60_000;
	return Number.isFinite(duration) && duration > 0 ? duration : 60;
}

function daySpan(item: OrbitItem) {
	if (!item.start || !item.end) return 0;
	const start = new Date(`${item.start.slice(0, 10)}T00:00:00`);
	const end = new Date(`${item.end.slice(0, 10)}T00:00:00`);
	return Math.max(
		0,
		Math.round((end.getTime() - start.getTime()) / 86_400_000),
	);
}

function spansMultipleDays(item: OrbitItem) {
	return Boolean(
		item.type === "event" &&
			item.start &&
			item.end &&
			item.end.slice(0, 10) > item.start.slice(0, 10),
	);
}

function visibleEndDayKey(item: OrbitItem) {
	const startKey = itemDayKey(item);
	const endKey = item.type === "event" ? item.end?.slice(0, 10) : undefined;
	if (!startKey || !endKey) return endKey;
	if (timeOf(item.start) && timeOf(item.end) === "00:00" && endKey > startKey) {
		return formatDayKey(addDays(parseDayKey(endKey), -1));
	}
	return endKey;
}

function visibleDayKeys(item: OrbitItem) {
	const startKey = itemDayKey(item);
	if (!startKey || !spansMultipleDays(item)) return startKey ? [startKey] : [];
	const endKey = visibleEndDayKey(item) ?? startKey;
	const cursor = new Date(`${startKey}T00:00:00`);
	const keys: string[] = [];
	while (formatDayKey(cursor) <= endKey && keys.length < 367) {
		keys.push(formatDayKey(cursor));
		cursor.setDate(cursor.getDate() + 1);
	}
	return keys;
}

function moveScheduledItem(item: OrbitItem, target: DragTarget): OrbitItem {
	if (item.type === "task") {
		const currentTime = timeOf(item.due);
		const nextTime =
			target.mode === "time"
				? target.time
				: target.mode === "keep-time"
					? currentTime
					: undefined;
		return {
			...item,
			due: nextTime ? `${target.date}T${nextTime}:00` : target.date,
		};
	}

	if (target.mode === "all-day" || !timeOf(item.start)) {
		const span = daySpan(item);
		return {
			...item,
			start: target.date,
			end: formatDayKey(addDays(new Date(`${target.date}T00:00:00`), span)),
		};
	}

	const nextTime = target.mode === "time" ? target.time : timeOf(item.start);
	if (!nextTime) return item;
	const start = new Date(`${target.date}T${nextTime}:00`);
	const end = new Date(start.getTime() + durationMinutes(item) * 60_000);
	return { ...item, start: dateTime(start), end: dateTime(end) };
}

function dragPayload(dataTransfer: DataTransfer) {
	return {
		id: dataTransfer.getData("text/orbit-item-id"),
		operation: "move" as const,
	};
}

function monthLabel(date: Date) {
	return new Intl.DateTimeFormat("ko-KR", {
		year: "numeric",
		month: "long",
	}).format(date);
}

function weekLabel(date: Date) {
	const start = startOfWeek(date);
	const end = addDays(start, 6);
	const formatter = new Intl.DateTimeFormat("ko-KR", {
		month: "short",
		day: "numeric",
	});
	return `${start.getFullYear()}년 ${formatter.format(start)} – ${formatter.format(end)}`;
}

function dayLabel(date: Date) {
	return new Intl.DateTimeFormat("ko-KR", {
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

function shortDayLabel(value: string) {
	return new Intl.DateTimeFormat("ko-KR", {
		month: "long",
		day: "numeric",
		weekday: "short",
	}).format(parseDayKey(value));
}

function itemTimeLabel(item: OrbitItem) {
	const start = timeOf(item.start ?? item.due);
	if (!start) return "종일";
	const end = item.type === "event" ? timeOf(item.end) : undefined;
	return end ? `${start}–${end}` : start;
}

function eventTone(item: OrbitItem) {
	return itemColor(item).surface;
}

function itemAccent(item: OrbitItem) {
	return itemColor(item).dot;
}

function timedRangeForDay(item: OrbitItem, dayKey: string) {
	const startKey = itemDayKey(item) ?? dayKey;
	const endKey = item.type === "event" ? item.end?.slice(0, 10) : undefined;
	const point = minutesOf(item.start ?? item.due) ?? 0;
	if (item.type === "task") {
		return {
			start: point,
			end: Math.min(24 * 60, point + 30),
			label: timeOf(item.due),
		};
	}

	const start = dayKey === startKey ? point : 0;
	const end =
		endKey && dayKey === endKey
			? (minutesOf(item.end) ?? 24 * 60)
			: endKey && dayKey < endKey
				? 24 * 60
				: (minutesOf(item.end) ?? Math.min(24 * 60, start + 60));
	const label =
		startKey !== endKey
			? dayKey === startKey
				? `${timeOf(item.start) ?? "00:00"}–24:00`
				: dayKey === endKey
					? `00:00–${timeOf(item.end) ?? "24:00"}`
					: "종일 계속"
			: itemTimeLabel(item);
	return { start, end: Math.max(start + 1, end), label };
}

function layoutTimedItems(items: OrbitItem[], dayKey: string) {
	type Entry = {
		item: OrbitItem;
		start: number;
		end: number;
		label?: string;
		column: number;
		columns: number;
	};
	const entries: Entry[] = items
		.map((item) => {
			const range = timedRangeForDay(item, dayKey);
			return {
				item,
				start: range.start,
				end: range.end,
				label: range.label,
				column: 0,
				columns: 1,
			};
		})
		.sort((left, right) => left.start - right.start || left.end - right.end);
	const result: Entry[] = [];
	let cluster: Entry[] = [];
	let clusterEnd = -1;

	function flush() {
		if (cluster.length === 0) return;
		const columnEnds: number[] = [];
		for (const entry of cluster) {
			const available = columnEnds.findIndex((end) => end <= entry.start);
			entry.column = available === -1 ? columnEnds.length : available;
			columnEnds[entry.column] = entry.end;
		}
		for (const entry of cluster) entry.columns = columnEnds.length;
		result.push(...cluster);
		cluster = [];
	}

	for (const entry of entries) {
		if (cluster.length > 0 && entry.start >= clusterEnd) flush();
		cluster.push(entry);
		clusterEnd = Math.max(clusterEnd, entry.end);
	}
	flush();
	return result;
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
}: {
	item: OrbitItem;
	compact?: boolean;
	dense?: boolean;
	dayKey?: string;
	displayTime?: string;
	resizeEndKey?: string;
	onClick: () => void;
	onDragStart: (event: React.DragEvent<HTMLButtonElement>) => void;
	onResizeStart?: (event: React.PointerEvent<HTMLButtonElement>) => void;
	onDragEnd: () => void;
	dragging?: boolean;
	dragOperation?: DragOperation;
}) {
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
			item.type === "event" &&
			(!endKey || !dayKey || (resizeEndKey ?? dayKey) === endKey),
	);
	return (
		<div
			className={cn(
				"group/event relative h-full min-h-0 cursor-grab active:cursor-grabbing",
				dragging && dragOperation === "move" && "opacity-35",
			)}
		>
			<button
				type="button"
				draggable
				onDragStart={onDragStart}
				onDragEnd={onDragEnd}
				onClick={(event) => {
					event.stopPropagation();
					onClick();
				}}
				onDoubleClick={(event) => event.stopPropagation()}
				className={cn(
					"flex h-full min-h-0 w-full min-w-0 items-start overflow-hidden border px-0.5 sm:px-2 text-left transition-colors",
					eventTone(item),
					continuesFromBefore ? "rounded-l-sm border-l-0" : "rounded-l-md",
					continuesAfter ? "rounded-r-sm border-r-0" : "rounded-r-md",
					compact
						? "h-6 items-center text-[9px] sm:text-[11px] leading-6"
						: dense
							? "items-center py-0.5 text-[11px] shadow-sm"
							: "py-1.5 text-xs shadow-sm",
				)}
			>
				<span
					className={cn(
						"min-w-0 flex-1",
						item.type === "task" && "pl-6",
						dense && "flex items-center gap-1.5",
					)}
				>
					<span className={cn("block truncate font-medium", dense && "flex-1")}>
						{compact && !continuesFromBefore ? (
							<span className="mr-1 hidden sm:inline font-normal tabular-nums opacity-65">
								{displayTime ?? timeOf(item.start ?? item.due)}
							</span>
						) : null}
						<CalendarItemTitle item={item} />
					</span>
					{compact ? null : dense ? (
						<span className="shrink-0 tabular-nums opacity-75">
							{displayTime ?? timeOf(item.start ?? item.due)}
						</span>
					) : (
						<span className="mt-0.5 block truncate opacity-70">
							{displayTime ?? itemTimeLabel(item)}
						</span>
					)}
				</span>
			</button>
			<CalendarTaskCheck item={item} />
			{canResize ? (
				<button
					type="button"
					onPointerDown={onResizeStart}
					onClick={(event) => event.stopPropagation()}
					title={compact ? "종료 날짜 조정" : "종료 시간 조정"}
					aria-label={compact ? "종료 날짜 조정" : "종료 시간 조정"}
					className={cn(
						"absolute z-20 touch-none",
						compact
							? "inset-y-0 right-0 w-2 cursor-ew-resize"
							: "inset-x-0 bottom-0 h-2 cursor-ns-resize",
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
	const isMobile = useIsMobile();
	const location = useSearch({ from: "/calendar" });
	const navigate = useNavigate({ from: "/calendar" });
	const view = location.view ?? "month";
	const cursorKey = location.date ?? formatDayKey();
	const cursor = useMemo(() => parseDayKey(cursorKey), [cursorKey]);
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
	const [visibility, setVisibility] = useState<CalendarVisibility>({
		event: true,
		task: true,
	});
	const [editor, setEditor] = useState<EditorState>({
		open: false,
		kind: "event",
	});
	const displayOptions: CalendarDisplayOptions = {
		visibility,
		onChangeVisibility: (kind) =>
			setVisibility((current) => ({ ...current, [kind]: !current[kind] })),
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
	const [localItems, setLocalItems] = useState(snapshot.items);
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
				updateCalendar({
					view: nextView,
					date: nextView === "day" ? selectedDate : cursorKey,
				});
				return;
			}
			if (event.key.toLowerCase() === "t") {
				event.preventDefault();
				const now = new Date();
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
							? addDays(cursor, amount * 7)
							: addMonths(cursor, amount);
				updateCalendar({
					date: formatDayKey(next),
					selected: formatDayKey(next),
				});
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [cursor, cursorKey, selectedDate, view, updateCalendar]);
	const today = formatDayKey();
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
							(item.type === "task" && visibility.task && item.due)),
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
				items.sort((left, right) =>
					(left.start ?? left.due ?? "").localeCompare(
						right.start ?? right.due ?? "",
					),
				);
				map.set(day, items);
			}
		}
		return map;
	}, [dated]);
	const selectedItems = byDay.get(selectedDate) ?? [];

	function openNew(
		date = formatDayKey(cursor),
		time = "09:00",
		kind: EditorState["kind"] = "event",
	) {
		updateCalendar({ selected: date });
		setEditor({
			open: true,
			kind,
			date,
			time: kind === "event" ? time : undefined,
		});
	}

	function openItem(item: OrbitItem) {
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

	function chooseView(next: CalendarView) {
		updateCalendar({
			view: next,
			date: next === "day" ? selectedDate : cursorKey,
		});
	}

	function move(amount: number) {
		const next =
			view === "day"
				? addDays(cursor, amount)
				: view === "week"
					? addDays(cursor, amount * 7)
					: addMonths(cursor, amount);
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
		event.dataTransfer.effectAllowed = "move";
		event.dataTransfer.setData("text/orbit-item-id", item.id);
		const rect = event.currentTarget.getBoundingClientRect();
		const timed = event.currentTarget.closest('[data-calendar-mode="time"]');
		setDragGrabOffset(timed ? Math.max(0, event.clientY - rect.top) : 0);
		event.dataTransfer.setDragImage(
			event.currentTarget,
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
	) {
		if (event.button !== 0 || isPendingItemId(item.id)) return;
		event.preventDefault();
		event.stopPropagation();
		resizePointerRef.current = event.pointerId;
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
						current.time === target.time
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
		const current = localItemsRef.current.find((item) => item.id === id);
		if (!current) return;
		const next =
			operation === "resize"
				? resizeScheduledItem(current, target)
				: moveScheduledItem(current, target);
		if (next === current) return;
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
							due: next.due,
							start: next.start,
							end: next.end,
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
						? "일정 길이를 저장하지 못해 원래대로 돌렸습니다."
						: "일정을 저장하지 못해 원래 위치로 돌렸습니다.",
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
						time: calendarResizeTime(event.clientY, rect.top, HOUR_HEIGHT),
					};
				}
				return { date, mode: "keep-time" };
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
		<div ref={calendarRef} className="h-full min-h-0 bg-muted/20 p-0 md:p-3">
			<div className="orbit-card flex h-full min-h-0 flex-col overflow-hidden rounded-none border-x-0 bg-background shadow-none md:rounded-[var(--radius-xl)] md:border-x md:shadow-sm">
				<header className="flex min-h-14 shrink-0 items-center gap-1.5 border-b border-border/60 px-2 sm:min-h-16 sm:gap-2 sm:px-4">
					<Button
						variant="outline"
						size="sm"
						className="hidden font-medium sm:inline-flex"
						onClick={() => {
							const now = new Date();
							updateCalendar({
								date: formatDayKey(now),
								selected: formatDayKey(now),
							});
						}}
					>
						오늘
					</Button>
					<div className="flex items-center gap-0.5">
						<Button
							variant="ghost"
							size="icon-sm"
							onClick={() => move(-1)}
							aria-label={`이전 ${view === "day" ? "날" : view === "week" ? "주" : "달"}`}
						>
							<ChevronLeft />
						</Button>
						<Button
							variant="ghost"
							size="icon-sm"
							onClick={() => move(1)}
							aria-label={`다음 ${view === "day" ? "날" : view === "week" ? "주" : "달"}`}
						>
							<ChevronRight />
						</Button>
					</div>
					<h2 className="min-w-0 flex-1 truncate px-1 text-base font-semibold tracking-tight sm:text-lg">
						{view === "day"
							? dayLabel(cursor)
							: view === "week"
								? weekLabel(cursor)
								: monthLabel(cursor)}
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
								{value === "day" ? "일간" : value === "week" ? "주간" : "월간"}
								<span className="ml-1 hidden text-[10px] text-muted-foreground sm:inline">
									{index + 1}
								</span>
							</Button>
						))}
					</div>
					<ScheduleDisplayMenu {...displayOptions} />
					<Button
						size="sm"
						aria-label="일정 추가"
						onClick={() => openNew(selectedDate)}
					>
						<Plus /> <span className="hidden sm:inline">일정 추가</span>
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
							{value === "day" ? "일" : value === "week" ? "주" : "월"}
						</Button>
					))}
				</div>
				{dragError ? (
					<div className="shrink-0 border-b bg-destructive/5 px-4 py-2 text-xs text-destructive">
						{dragError}
					</div>
				) : null}

				<div className="flex min-h-0 flex-1">
					{isMobile && view !== "month" ? (
						<MobileCalendarView
							view={view}
							cursor={cursor}
							byDay={byDay}
							today={today}
							selectedDate={selectedDate}
							onSelectDate={selectDate}
							onCreate={openNew}
							onOpen={openItem}
							onMove={move}
						/>
					) : (
						<>
							<CalendarRail
								cursor={cursor}
								selectedDate={selectedDate}
								selectedItems={selectedItems}
								displayOptions={displayOptions}
								onMoveMonth={(amount) =>
									updateCalendar({
										date: formatDayKey(addMonths(cursor, amount)),
									})
								}
								onSelectDate={selectDate}
								onCreate={openNew}
								onOpen={openItem}
							/>

							<div className="flex min-w-0 flex-1 flex-col">
								{view !== "month" ? (
									<WeekView
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
						</>
					)}
				</div>
			</div>

			<ScheduleEditor
				open={editor.open}
				onOpenChange={(open) => setEditor((current) => ({ ...current, open }))}
				kind={editor.kind}
				item={editor.item}
				initialDate={editor.date}
				initialTime={editor.time}
			/>
		</div>
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
	onCreate: (date: string, time?: string, kind?: EditorState["kind"]) => void;
	onOpen: (item: OrbitItem) => void;
	compact?: boolean;
}) {
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
				<Plus className="size-4" /> 이 날의 첫 일정 추가
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
								item.type === "task" && "w-[6.5rem] pl-9",
							)}
						>
							{timeOf(item.start ?? item.due) ? (
								<>
									<span className="text-sm text-foreground">
										{timeOf(item.start ?? item.due)}
									</span>
									{item.type === "event" && timeOf(item.end) ? (
										<span>{timeOf(item.end)}까지</span>
									) : null}
								</>
							) : (
								<span>종일</span>
							)}
						</span>
						<span className="min-w-0 flex-1 self-center px-3 py-2.5">
							<span className="block truncate text-sm font-medium">
								<CalendarItemTitle item={item} />
							</span>
							<span className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
								{item.type === "event" ? (
									<CalendarDays className="size-3" />
								) : (
									<ListTodo className="size-3" />
								)}
								{item.type === "event" ? "일정" : "할 일"}
								{spansMultipleDays(item) ? " · 여러 날" : ""}
							</span>
						</span>
					</button>
					<CalendarTaskCheck item={item} className="left-2" />
				</div>
			))}
		</div>
	);
}

function MobileDayView({
	cursor,
	byDay,
	today,
	selectedDate,
	onSelectDate,
	onCreate,
	onOpen,
}: {
	cursor: Date;
	byDay: Map<string, OrbitItem[]>;
	today: string;
	selectedDate: string;
	onSelectDate: (date: string) => void;
	onCreate: (date: string, time?: string, kind?: EditorState["kind"]) => void;
	onOpen: (item: OrbitItem) => void;
}) {
	const start = startOfWeek(cursor);
	const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));
	const items = byDay.get(selectedDate) ?? [];
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="grid shrink-0 grid-cols-7 border-b border-border/60 px-1 py-1.5">
				{days.map((day) => {
					const key = formatDayKey(day);
					const selected = key === selectedDate;
					const count = (byDay.get(key) ?? []).length;
					return (
						<button
							key={key}
							type="button"
							onClick={() => onSelectDate(key)}
							aria-label={calendarDateLabel(key)}
							className="flex min-h-14 flex-col items-center justify-center rounded-xl text-[10px] text-muted-foreground"
						>
							<span className={calendarDayTone(day)}>
								{WEEKDAYS[day.getDay()]}
							</span>
							<span
								className={cn(
									"mt-0.5 grid size-7 place-items-center rounded-full text-sm font-semibold text-foreground",
									!selected && key !== today && calendarDayTone(day),
									selected && "bg-foreground text-background",
									key === today && !selected && "text-blue-600",
								)}
							>
								{day.getDate()}
							</span>
							<span
								className={cn(
									"mt-0.5 size-1 rounded-full",
									count > 0 ? "bg-foreground/65" : "bg-transparent",
								)}
							/>
						</button>
					);
				})}
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">
				<div className="mb-3 flex items-center justify-between">
					<div>
						<h3 className="text-base font-semibold">
							{shortDayLabel(selectedDate)}
						</h3>
						<HolidayLabel date={selectedDate} />
						<p className="text-xs text-muted-foreground">
							{items.length > 0 ? `${items.length}개 항목` : "여유 있는 날"}
						</p>
					</div>
					<CalendarCreateButton date={selectedDate} onCreate={onCreate} />
				</div>
				<MobileAgenda
					items={items}
					date={selectedDate}
					onCreate={onCreate}
					onOpen={onOpen}
				/>
			</div>
		</div>
	);
}

function MobileWeekView({
	cursor,
	byDay,
	today,
	selectedDate,
	onSelectDate,
	onCreate,
	onOpen,
}: {
	cursor: Date;
	byDay: Map<string, OrbitItem[]>;
	today: string;
	selectedDate: string;
	onSelectDate: (date: string) => void;
	onCreate: (date: string, time?: string, kind?: EditorState["kind"]) => void;
	onOpen: (item: OrbitItem) => void;
}) {
	const start = startOfWeek(cursor);
	const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));
	return (
		<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-muted/20 p-2.5">
			<div className="space-y-2">
				{days.map((day) => {
					const key = formatDayKey(day);
					const items = byDay.get(key) ?? [];
					return (
						<section
							key={key}
							className={cn(
								"overflow-hidden rounded-2xl border bg-background",
								key === selectedDate && "ring-1 ring-foreground/15",
							)}
						>
							<div className="flex items-center gap-2 border-b border-border/50 px-2 py-1.5">
								<button
									type="button"
									onClick={() => onSelectDate(key)}
									aria-label={calendarDateLabel(key)}
									className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1 text-left"
								>
									<span
										className={cn(
											"grid size-8 shrink-0 place-items-center rounded-full text-sm font-semibold",
											key !== today && calendarDayTone(day),
											key === today && "bg-blue-600 text-white",
										)}
									>
										{day.getDate()}
									</span>
									<span className="min-w-0 flex-1">
										<span
											className={cn(
												"text-sm font-medium",
												calendarDayTone(day),
											)}
										>
											{WEEKDAYS[day.getDay()]}요일
										</span>
										<HolidayLabel date={key} />
									</span>
									<span className="text-xs text-muted-foreground">
										{items.length ? `${items.length}개` : "비어 있음"}
									</span>
								</button>
								<CalendarCreateButton date={key} onCreate={onCreate} />
							</div>
							{items.length > 0 ? (
								<div className="space-y-1 p-1.5">
									{items.map((item) => (
										<button
											key={item.id}
											type="button"
											onClick={() => onOpen(item)}
											className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2 text-left active:bg-muted"
										>
											<span
												className={cn(
													"size-2 shrink-0 rounded-full",
													itemAccent(item),
												)}
											/>
											<span className="w-16 shrink-0 text-[11px] tabular-nums text-muted-foreground">
												{itemTimeLabel(item)}
											</span>
											<span className="min-w-0 flex-1 truncate text-sm font-medium">
												{item.title}
											</span>
										</button>
									))}
								</div>
							) : null}
						</section>
					);
				})}
			</div>
		</div>
	);
}

function MobileCalendarView({
	view,
	cursor,
	byDay,
	today,
	selectedDate,
	onSelectDate,
	onCreate,
	onOpen,
	onMove,
}: {
	view: CalendarView;
	cursor: Date;
	byDay: Map<string, OrbitItem[]>;
	today: string;
	selectedDate: string;
	onSelectDate: (date: string) => void;
	onCreate: (date: string, time?: string, kind?: EditorState["kind"]) => void;
	onOpen: (item: OrbitItem) => void;
	onMove: (amount: number) => void;
}) {
	const touchStart = useRef<{ x: number; y: number } | null>(null);
	const shared = {
		cursor,
		byDay,
		today,
		selectedDate,
		onSelectDate,
		onCreate,
		onOpen,
	};
	return (
		<div
			className={cn(
				"flex min-h-0 min-w-0 flex-1 overflow-hidden",
				view === "month" && "touch-pan-y",
			)}
			onTouchStart={(event) => {
				if (event.touches.length !== 1) {
					touchStart.current = null;
					return;
				}
				const touch = event.touches[0];
				touchStart.current = touch
					? { x: touch.clientX, y: touch.clientY }
					: null;
			}}
			onTouchEnd={(event) => {
				const start = touchStart.current;
				const touch = event.changedTouches[0];
				touchStart.current = null;
				if (!start || !touch) return;
				const dx = touch.clientX - start.x;
				const dy = touch.clientY - start.y;
				if (Math.abs(dx) > 64 && Math.abs(dx) > Math.abs(dy) * 1.35) {
					onMove(dx > 0 ? -1 : 1);
				}
			}}
			onTouchCancel={() => {
				touchStart.current = null;
			}}
		>
			{view === "day" ? (
				<MobileDayView {...shared} />
			) : (
				<MobileWeekView {...shared} />
			)}
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
	onCreate: (date: string, time?: string, kind?: EditorState["kind"]) => void;
	onOpen: (item: OrbitItem) => void;
}) {
	const days = gridDays(cursor);
	const today = formatDayKey();
	return (
		<aside className="hidden w-60 shrink-0 flex-col border-r border-border/60 bg-muted/[0.12] xl:flex">
			<div className="border-b border-border/60 p-3.5">
				<div className="mb-2 flex items-center justify-between px-1">
					<p className="text-sm font-semibold">{monthLabel(cursor)}</p>
					<div className="flex items-center">
						<Button
							variant="ghost"
							size="icon-xs"
							onClick={() => onMoveMonth(-1)}
							aria-label="미니 캘린더 이전 달"
						>
							<ChevronLeft />
						</Button>
						<Button
							variant="ghost"
							size="icon-xs"
							onClick={() => onMoveMonth(1)}
							aria-label="미니 캘린더 다음 달"
						>
							<ChevronRight />
						</Button>
					</div>
				</div>
				<div className="grid grid-cols-7 text-center text-[10px] font-medium text-muted-foreground">
					{WEEKDAYS.map((day) => (
						<span key={day} className="py-1">
							{day}
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
								aria-label={calendarDateLabel(key)}
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
							{shortDayLabel(selectedDate)}
						</p>
						<HolidayLabel date={selectedDate} />
						<p className="text-[11px] text-muted-foreground">
							{selectedItems.length}개 항목
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
											<Clock3 className="size-2.5" /> {itemTimeLabel(item)}
										</span>
									</span>
								</button>
								<CalendarTaskCheck item={item} className="left-2" />
							</div>
						))}
					</div>
				) : (
					<div className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-xl border border-dashed text-center text-xs text-muted-foreground">
						<Circle className="size-4" />
						<span>예정된 항목이 없습니다</span>
					</div>
				)}
			</div>
			<div className="border-t border-border/60 px-4 py-2.5 text-[10px] leading-4 text-muted-foreground">
				빈 시간을 클릭해 추가 · 카드를 드래그해 이동 · 끝 모서리로 기간 조정
			</div>
		</aside>
	);
}

function WeekView({
	cursor,
	dayCount,
	byDay,
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
	cursor: Date;
	dayCount: 1 | 7;
	byDay: Map<string, OrbitItem[]>;
	today: string;
	selectedDate: string;
	onSelectDate: (date: string) => void;
	onCreate: (date: string, time?: string, kind?: EditorState["kind"]) => void;
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
	) => void;
	onDragEnd: () => void;
	onDragPreview: (target: DragTarget | null) => void;
	onDrop: (
		target: DragTarget,
		transferredId?: string,
		operation?: DragOperation,
	) => void;
}) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const start = dayCount === 1 ? new Date(cursor) : startOfWeek(cursor);
	start.setHours(0, 0, 0, 0);
	const days = Array.from({ length: dayCount }, (_, index) =>
		addDays(start, index),
	);
	const hours = Array.from(
		{ length: HOUR_END - HOUR_START },
		(_, index) => HOUR_START + index,
	);
	const calendarHeight = (HOUR_END - HOUR_START) * HOUR_HEIGHT;
	const draggingItem = Array.from(byDay.values())
		.flat()
		.find((item) => item.id === draggingId);

	useEffect(() => {
		const hour = formatDayKey(cursor) === today ? new Date().getHours() : 8;
		scrollRef.current?.scrollTo({
			top: Math.max(0, (hour - 2) * HOUR_HEIGHT),
			behavior: "auto",
		});
	}, [cursor, today]);

	function timeAt(clientY: number, element: HTMLElement) {
		return calendarMoveTime(
			clientY,
			element.getBoundingClientRect().top,
			HOUR_HEIGHT,
			dragGrabOffset,
		);
	}

	return (
		<div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
			<div className={dayCount === 1 ? "min-w-[340px]" : "min-w-[760px]"}>
				<div
					className="sticky top-0 z-20 grid border-b bg-background/95 backdrop-blur"
					style={{
						gridTemplateColumns: `56px repeat(${dayCount}, minmax(96px, 1fr))`,
					}}
				>
					<div className="border-r" />
					{days.map((day) => {
						const key = formatDayKey(day);
						return (
							<button
								key={key}
								type="button"
								aria-label={calendarDateLabel(key)}
								className={cn(
									"relative border-r px-2 py-2 text-center last:border-r-0 hover:bg-muted/60",
									dayCount > 1 && key === selectedDate && "bg-muted/45",
								)}
								onClick={() => onSelectDate(key)}
								onDoubleClick={() => onCreate(key)}
							>
								<span
									className={cn(
										"block text-[11px] text-muted-foreground",
										calendarDayTone(day),
									)}
								>
									{WEEKDAYS[day.getDay()]}
								</span>
								<span
									className={cn(
										"mt-1 inline-grid size-7 place-items-center rounded-full text-sm font-semibold",
										key !== today && calendarDayTone(day),
										key === today && "bg-blue-600 text-white",
									)}
								>
									{day.getDate()}
								</span>
								<HolidayLabel date={key} />
							</button>
						);
					})}
				</div>

				<div
					className="grid border-b"
					style={{
						gridTemplateColumns: `56px repeat(${dayCount}, minmax(96px, 1fr))`,
					}}
				>
					<div className="border-r px-2 py-2 text-[10px] text-muted-foreground">
						종일
					</div>
					{days.map((day) => {
						const key = formatDayKey(day);
						const allDay = (byDay.get(key) ?? []).filter(
							(item) => !timeOf(item.start ?? item.due),
						);
						return (
							// biome-ignore lint/a11y/noStaticElementInteractions: Calendar cells are native drop targets; items remain keyboard-editable.
							<div
								key={key}
								className={cn(
									"min-h-11 space-y-1 border-r p-1 last:border-r-0",
									key === today && "bg-blue-500/[0.025]",
									dragTarget?.date === key &&
										dragTarget.mode === "all-day" &&
										"bg-accent ring-1 ring-inset ring-foreground/20",
								)}
								data-calendar-date={key}
								data-calendar-mode="keep-time"
								onDragOver={(event) => {
									event.preventDefault();
									event.dataTransfer.dropEffect = "move";
									onDragPreview({ date: key, mode: "all-day" });
								}}
								onDragEnter={(event) => {
									event.preventDefault();
									onDragPreview({ date: key, mode: "all-day" });
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
										{ date: key, mode: "all-day" },
										payload.id,
										payload.operation,
									);
								}}
								onDoubleClick={() => onCreate(key)}
							>
								{allDay.map((item) => (
									<CalendarEvent
										key={item.id}
										item={item}
										compact
										dayKey={key}
										onClick={() => onOpen(item)}
										onDragStart={(event) => onDragStart(item, event)}
										onResizeStart={(event) => onResizeStart(item, event)}
										onDragEnd={onDragEnd}
										dragging={draggingId === item.id}
										dragOperation={dragOperation}
									/>
								))}
							</div>
						);
					})}
				</div>

				<div
					className="grid"
					style={{
						gridTemplateColumns: `56px repeat(${dayCount}, minmax(96px, 1fr))`,
					}}
				>
					<div className="relative border-r" style={{ height: calendarHeight }}>
						{hours.map((hour) => (
							<span
								key={hour}
								className="absolute right-2 -translate-y-1/2 text-[10px] text-muted-foreground"
								style={{ top: (hour - HOUR_START) * HOUR_HEIGHT }}
							>
								{String(hour).padStart(2, "0")}:00
							</span>
						))}
					</div>
					{days.map((day) => {
						const key = formatDayKey(day);
						const timed = (byDay.get(key) ?? []).filter((item) =>
							timeOf(item.start ?? item.due),
						);
						const previewItem =
							dragOperation === "move" &&
							draggingItem &&
							dragTarget?.mode === "time" &&
							dragTarget.time
								? moveScheduledItem(draggingItem, dragTarget)
								: null;
						const previewRange =
							previewItem && visibleDayKeys(previewItem).includes(key)
								? timedRangeForDay(previewItem, key)
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
								<button
									type="button"
									aria-label={`${key} 시간 선택`}
									className="absolute inset-0 z-0 w-full text-left"
									onClick={(event) => {
										onCreate(key, timeAt(event.clientY, event.currentTarget));
									}}
								/>
								{hours.map((hour) => (
									<div
										key={hour}
										className="pointer-events-none absolute inset-x-0 border-t"
										style={{ top: (hour - HOUR_START) * HOUR_HEIGHT }}
									/>
								))}
								{hours.map((hour) => (
									<div
										key={`${hour}:30`}
										className="pointer-events-none absolute inset-x-0 border-t border-dashed border-border/35"
										style={{
											top: (hour - HOUR_START + 0.5) * HOUR_HEIGHT,
										}}
									/>
								))}
								{key === today ? (
									<div
										className="pointer-events-none absolute inset-x-0 z-20 border-t border-red-500"
										style={{
											top:
												((new Date().getHours() * 60 +
													new Date().getMinutes()) /
													60) *
												HOUR_HEIGHT,
										}}
									>
										<span className="absolute -top-1 -left-1 size-2 rounded-full bg-red-500" />
									</div>
								) : null}
								{previewItem && previewRange && dragTarget?.time ? (
									<div
										className="pointer-events-none absolute inset-x-1 z-20 overflow-hidden rounded-md border border-foreground/30 bg-foreground/15 px-2 py-1 text-xs backdrop-blur-sm"
										style={{
											top:
												((previewRange.start - HOUR_START * 60) / 60) *
												HOUR_HEIGHT,
											height:
												((previewRange.end - previewRange.start) / 60) *
												HOUR_HEIGHT,
										}}
									>
										<span className="block truncate font-medium">
											{previewItem.title}
										</span>
										<span className="opacity-70">{previewRange.label}</span>
									</div>
								) : null}
								{layoutTimedItems(timed, key).map((layout) => {
									const top =
										((layout.start - HOUR_START * 60) / 60) * HOUR_HEIGHT;
									const height =
										layout.item.type === "task"
											? 24
											: Math.max(
													2,
													((layout.end - layout.start) / 60) * HOUR_HEIGHT,
												);
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
												dense={height < 40}
												dayKey={key}
												displayTime={layout.label}
												resizeEndKey={key}
												onClick={() => onOpen(layout.item)}
												onDragStart={(event) => onDragStart(layout.item, event)}
												onResizeStart={(event) =>
													onResizeStart(layout.item, event)
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

function MonthView({
	cursor,
	byDay,
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
	byDay: Map<string, OrbitItem[]>;
	today: string;
	selectedDate: string;
	onSelectDate: (date: string) => void;
	onCreate: (date: string, time?: string, kind?: EditorState["kind"]) => void;
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
	) => void;
	onDragEnd: () => void;
	onDragPreview: (target: DragTarget | null) => void;
	onDrop: (
		target: DragTarget,
		transferredId?: string,
		operation?: DragOperation,
	) => void;
}) {
	const isMobile = useIsMobile();
	const days = gridDays(cursor);
	const monthLayout = buildMonthLayout(byDay, days);
	const rowHeights = monthLayout.rowLaneCounts.map((count) =>
		Math.max(112, MONTH_ITEMS_TOP + count * MONTH_LANE_HEIGHT + 6),
	);
	const gridTemplateRows = rowHeights
		.map((height) => `minmax(${height}px, 1fr)`)
		.join(" ");
	return (
		<div className="min-h-0 flex-1 overflow-auto">
			<div className="flex min-h-full min-w-0 flex-col">
				<div className="sticky top-0 z-20 grid shrink-0 grid-cols-7 border-b bg-background/95 backdrop-blur">
					{WEEKDAYS.map((day, index) => (
						<div
							key={day}
							className={cn(
								"border-r px-2 py-2.5 text-center text-[11px] font-medium text-muted-foreground last:border-r-0",
								(index === 0 || index === 6) && "bg-muted/20",
								index === 0 && "text-red-600 dark:text-red-400",
							)}
						>
							{day}
						</div>
					))}
				</div>
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
											aria-label={calendarDateLabel(key)}
											className={cn(
												"relative z-20 grid size-7 place-items-center rounded-full text-xs font-medium tabular-nums hover:bg-muted",
												key !== today && calendarDayTone(day),
												key === today &&
													"bg-blue-600 text-white hover:bg-blue-600",
												key === selectedDate &&
													key !== today &&
													"bg-muted font-semibold",
											)}
										>
											{day.getDate()}
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
										onResizeStart={(event) =>
											onResizeStart(segment.item, event)
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
			{isMobile ? (
				<div className="border-t bg-muted/20 p-3">
					<div className="mb-2 flex items-center justify-between">
						<div>
							<h3 className="text-sm font-semibold">
								{shortDayLabel(selectedDate)}
							</h3>
							<HolidayLabel date={selectedDate} />
						</div>
						<CalendarCreateButton date={selectedDate} onCreate={onCreate} />
					</div>
					<MobileAgenda
						items={byDay.get(selectedDate) ?? []}
						date={selectedDate}
						onCreate={onCreate}
						onOpen={onOpen}
						compact
					/>
				</div>
			) : null}
		</div>
	);
}
