import { useRouter } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, GripVertical, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { mutateOrbit } from "#/lib/orbit/functions";
import { formatDayKey, itemDayKey } from "#/lib/orbit/para";
import type { OrbitItem, OrbitSnapshot } from "#/lib/orbit/schema";
import { ScheduleEditor } from "@/components/schedule-editor";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"];
const HOUR_START = 6;
const HOUR_END = 23;
const HOUR_HEIGHT = 52;

type CalendarView = "day" | "week" | "month";
type EditorState = {
	open: boolean;
	kind: "event" | "task";
	item?: OrbitItem;
	date?: string;
	time?: string;
};
type DragTarget = {
	date: string;
	mode: "time" | "all-day" | "keep-time";
	time?: string;
};

function startOfMonth(date: Date) {
	return new Date(date.getFullYear(), date.getMonth(), 1);
}

function startOfWeek(date: Date) {
	const next = new Date(date);
	const offset = (next.getDay() + 6) % 7;
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

function visibleDayKeys(item: OrbitItem) {
	const startKey = itemDayKey(item);
	if (!startKey || !spansMultipleDays(item)) return startKey ? [startKey] : [];
	const endKey = item.end?.slice(0, 10) ?? startKey;
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

function CalendarEvent({
	item,
	compact = false,
	onClick,
	onDragStart,
	onDragEnd,
	dragging = false,
}: {
	item: OrbitItem;
	compact?: boolean;
	onClick: () => void;
	onDragStart: (event: React.DragEvent<HTMLButtonElement>) => void;
	onDragEnd: () => void;
	dragging?: boolean;
}) {
	return (
		<div
			className={cn(
				"group/event h-full cursor-grab active:cursor-grabbing",
				dragging && "opacity-35",
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
				className={cn(
					"flex h-full w-full min-w-0 items-start rounded-md px-2 text-left transition-colors",
					item.type === "task"
						? "border border-border bg-background text-foreground hover:bg-muted"
						: "bg-foreground text-background hover:bg-foreground/85",
					compact
						? "h-5 items-center text-[10px] leading-5"
						: "min-h-7 py-1 text-xs",
				)}
			>
				<GripVertical className="mr-0.5 mt-0.5 size-3 shrink-0 opacity-0 transition-opacity group-hover/event:opacity-60" />
				<span className="min-w-0 flex-1">
					<span className="block truncate font-medium">{item.title}</span>
					{compact ? null : (
						<span className="mt-0.5 block truncate opacity-70">
							{timeOf(item.start ?? item.due) ?? "종일"}
						</span>
					)}
				</span>
			</button>
		</div>
	);
}

export function CalendarMonth({ snapshot }: { snapshot: OrbitSnapshot }) {
	const router = useRouter();
	const [view, setView] = useState<CalendarView>("week");
	const [cursor, setCursor] = useState(() => new Date());
	const [editor, setEditor] = useState<EditorState>({
		open: false,
		kind: "event",
	});
	const [localItems, setLocalItems] = useState(snapshot.items);
	const [draggingId, setDraggingId] = useState<string | null>(null);
	const [dragTarget, setDragTarget] = useState<DragTarget | null>(null);
	const [dragError, setDragError] = useState<string | null>(null);
	const localItemsRef = useRef(localItems);
	const draggingIdRef = useRef<string | null>(null);
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
			const next =
				event.key === "1"
					? "day"
					: event.key === "2"
						? "week"
						: event.key === "3"
							? "month"
							: null;
			if (!next) return;
			event.preventDefault();
			setView(next);
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);
	const today = formatDayKey();
	const dated = useMemo(
		() =>
			localItems.filter(
				(item) =>
					(item.type === "event" && item.start) ||
					(item.type === "task" && item.due),
			),
		[localItems],
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

	function openNew(date = formatDayKey(cursor), time = "09:00") {
		setEditor({ open: true, kind: "event", date, time });
	}

	function openItem(item: OrbitItem) {
		setEditor({
			open: true,
			kind: item.type === "task" ? "task" : "event",
			item,
			date: itemDayKey(item),
			time: timeOf(item.start ?? item.due),
		});
	}

	function move(amount: number) {
		setCursor((current) =>
			view === "day"
				? addDays(current, amount)
				: view === "week"
					? addDays(current, amount * 7)
					: addMonths(current, amount),
		);
	}

	function startDrag(
		item: OrbitItem,
		event: React.DragEvent<HTMLButtonElement>,
	) {
		event.dataTransfer.effectAllowed = "move";
		event.dataTransfer.setData("text/orbit-item-id", item.id);
		draggingIdRef.current = item.id;
		setDraggingId(item.id);
		setDragTarget(null);
		setDragError(null);
	}

	function endDrag() {
		if (draggingIdRef.current && dragTargetRef.current) {
			dropOn(dragTargetRef.current);
			return;
		}
		setDraggingId(null);
		setDragTarget(null);
		const endedId = draggingIdRef.current;
		setTimeout(() => {
			if (draggingIdRef.current === endedId) draggingIdRef.current = null;
		}, 0);
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

	function dropOn(target: DragTarget, transferredId?: string) {
		const id = transferredId || draggingIdRef.current || draggingId;
		if (!id) return;
		const current = localItemsRef.current.find((item) => item.id === id);
		if (!current) return;
		const next = moveScheduledItem(current, target);
		setLocalItems((items) =>
			items.map((item) => (item.id === id ? next : item)),
		);
		setDraggingId(null);
		draggingIdRef.current = null;
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
							status: next.status,
							due: next.due,
							start: next.start,
							end: next.end,
						},
					},
				});
			})
			.then(async () => {
				if (saveVersionsRef.current.get(id) !== version) return;
				await router.invalidate();
			})
			.catch(() => {
				if (saveVersionsRef.current.get(id) !== version) return;
				setLocalItems((items) =>
					items.map((item) => (item.id === id ? current : item)),
				);
				setDragError("일정을 저장하지 못해 원래 위치로 돌렸습니다.");
			});
		saveQueuesRef.current.set(id, save);
	}

	return (
		<div className="h-full min-h-0 bg-muted/20 p-2 md:p-3">
			<div className="orbit-card flex h-full min-h-0 flex-col overflow-hidden bg-background">
				<header className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b border-border/60 px-4 py-2">
					<div className="flex items-center gap-1">
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
					<h2 className="min-w-0 flex-1 truncate text-sm font-semibold">
						{view === "day"
							? dayLabel(cursor)
							: view === "week"
								? weekLabel(cursor)
								: monthLabel(cursor)}
					</h2>
					<span className="hidden text-xs text-muted-foreground xl:inline">
						카드를 드래그해 일정 변경
					</span>
					<Button
						variant="outline"
						size="sm"
						onClick={() => setCursor(new Date())}
					>
						오늘
					</Button>
					<div className="flex rounded-lg bg-muted p-0.5">
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
								onClick={() => setView(value)}
							>
								{value === "day" ? "일" : value === "week" ? "주" : "월"}
								<span className="ml-1 text-[10px] text-muted-foreground">
									{index + 1}
								</span>
							</Button>
						))}
					</div>
					<Button size="sm" onClick={() => openNew(today)}>
						<Plus /> 일정
					</Button>
				</header>
				{dragError ? (
					<div className="shrink-0 border-b bg-destructive/5 px-4 py-2 text-xs text-destructive">
						{dragError}
					</div>
				) : null}

				{view !== "month" ? (
					<WeekView
						cursor={cursor}
						dayCount={view === "day" ? 1 : 7}
						byDay={byDay}
						today={today}
						onCreate={openNew}
						onOpen={openItem}
						draggingId={draggingId}
						dragTarget={dragTarget}
						onDragStart={startDrag}
						onDragEnd={endDrag}
						onDragPreview={previewDrag}
						onDrop={dropOn}
					/>
				) : (
					<MonthView
						cursor={cursor}
						byDay={byDay}
						today={today}
						onCreate={openNew}
						onOpen={openItem}
						draggingId={draggingId}
						dragTarget={dragTarget}
						onDragStart={startDrag}
						onDragEnd={endDrag}
						onDragPreview={previewDrag}
						onDrop={dropOn}
					/>
				)}
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

function WeekView({
	cursor,
	dayCount,
	byDay,
	today,
	onCreate,
	onOpen,
	draggingId,
	dragTarget,
	onDragStart,
	onDragEnd,
	onDragPreview,
	onDrop,
}: {
	cursor: Date;
	dayCount: 1 | 7;
	byDay: Map<string, OrbitItem[]>;
	today: string;
	onCreate: (date: string, time?: string) => void;
	onOpen: (item: OrbitItem) => void;
	draggingId: string | null;
	dragTarget: DragTarget | null;
	onDragStart: (
		item: OrbitItem,
		event: React.DragEvent<HTMLButtonElement>,
	) => void;
	onDragEnd: () => void;
	onDragPreview: (target: DragTarget | null) => void;
	onDrop: (target: DragTarget, transferredId?: string) => void;
}) {
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

	function timeAt(clientY: number, element: HTMLElement) {
		const rect = element.getBoundingClientRect();
		const relativeMinutes = Math.max(
			0,
			Math.min(
				(HOUR_END - HOUR_START) * 60 - 30,
				Math.round(((clientY - rect.top) / HOUR_HEIGHT) * 2) * 30,
			),
		);
		const absoluteMinutes = HOUR_START * 60 + relativeMinutes;
		return `${String(Math.floor(absoluteMinutes / 60)).padStart(2, "0")}:${String(absoluteMinutes % 60).padStart(2, "0")}`;
	}

	return (
		<div className="min-h-0 flex-1 overflow-auto">
			<div className={dayCount === 1 ? "min-w-[440px]" : "min-w-[760px]"}>
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
								className="border-r px-2 py-2 text-center last:border-r-0 hover:bg-muted/60"
								onClick={() => onCreate(key)}
							>
								<span className="block text-[11px] text-muted-foreground">
									{WEEKDAYS[(day.getDay() + 6) % 7]}
								</span>
								<span
									className={cn(
										"mt-1 inline-grid size-7 place-items-center rounded-full text-sm font-semibold",
										key === today && "bg-foreground text-background",
									)}
								>
									{day.getDate()}
								</span>
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
							(item) =>
								!timeOf(item.start ?? item.due) || spansMultipleDays(item),
						);
						return (
							// biome-ignore lint/a11y/noStaticElementInteractions: Calendar cells are native drop targets; items remain keyboard-editable.
							<div
								key={key}
								className={cn(
									"min-h-10 space-y-1 border-r p-1 last:border-r-0",
									dragTarget?.date === key &&
										dragTarget.mode === "all-day" &&
										"bg-accent ring-1 ring-inset ring-foreground/20",
								)}
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
									onDrop(
										{ date: key, mode: "all-day" },
										event.dataTransfer.getData("text/orbit-item-id"),
									);
								}}
							>
								{allDay.map((item) => (
									<CalendarEvent
										key={item.id}
										item={item}
										compact
										onClick={() => onOpen(item)}
										onDragStart={(event) => onDragStart(item, event)}
										onDragEnd={onDragEnd}
										dragging={draggingId === item.id}
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
						const timed = (byDay.get(key) ?? []).filter(
							(item) =>
								timeOf(item.start ?? item.due) && !spansMultipleDays(item),
						);
						return (
							// biome-ignore lint/a11y/noStaticElementInteractions: Timeline columns accept native schedule drops.
							<div
								key={key}
								className="relative border-r last:border-r-0"
								style={{ height: calendarHeight }}
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
									onDrop(
										{
											date: key,
											mode: "time",
											time: timeAt(event.clientY, event.currentTarget),
										},
										event.dataTransfer.getData("text/orbit-item-id"),
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
								{draggingItem &&
								dragTarget?.date === key &&
								dragTarget.mode === "time" &&
								dragTarget.time ? (
									<div
										className="pointer-events-none absolute inset-x-1 z-20 rounded-md border border-foreground/30 bg-foreground/15 px-2 py-1 text-xs backdrop-blur-sm"
										style={{
											top:
												(((minutesOf(`2000-01-01T${dragTarget.time}:00`) ??
													HOUR_START * 60) -
													HOUR_START * 60) /
													60) *
												HOUR_HEIGHT,
											height: Math.max(
												24,
												(durationMinutes(draggingItem) / 60) * HOUR_HEIGHT,
											),
										}}
									>
										<span className="block truncate font-medium">
											{draggingItem.title}
										</span>
										<span className="opacity-70">{dragTarget.time}</span>
									</div>
								) : null}
								{timed.map((item) => {
									const start =
										minutesOf(item.start ?? item.due) ?? HOUR_START * 60;
									const end =
										minutesOf(item.end) ??
										start + (item.type === "event" ? 60 : 30);
									const top = ((start - HOUR_START * 60) / 60) * HOUR_HEIGHT;
									const height = Math.max(
										24,
										((end - start) / 60) * HOUR_HEIGHT,
									);
									return (
										<div
											key={item.id}
											className="absolute inset-x-1 z-10"
											style={{ top, height }}
										>
											<CalendarEvent
												item={item}
												onClick={() => onOpen(item)}
												onDragStart={(event) => onDragStart(item, event)}
												onDragEnd={onDragEnd}
												dragging={draggingId === item.id}
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
	onCreate,
	onOpen,
	draggingId,
	dragTarget,
	onDragStart,
	onDragEnd,
	onDragPreview,
	onDrop,
}: {
	cursor: Date;
	byDay: Map<string, OrbitItem[]>;
	today: string;
	onCreate: (date: string) => void;
	onOpen: (item: OrbitItem) => void;
	draggingId: string | null;
	dragTarget: DragTarget | null;
	onDragStart: (
		item: OrbitItem,
		event: React.DragEvent<HTMLButtonElement>,
	) => void;
	onDragEnd: () => void;
	onDragPreview: (target: DragTarget | null) => void;
	onDrop: (target: DragTarget, transferredId?: string) => void;
}) {
	const days = gridDays(cursor);
	return (
		<div className="min-h-0 flex-1 overflow-auto">
			<div className="min-w-[760px]">
				<div className="grid grid-cols-7 border-b bg-muted/30">
					{WEEKDAYS.map((day) => (
						<div
							key={day}
							className="border-r px-2 py-2 text-center text-[11px] font-medium text-muted-foreground last:border-r-0"
						>
							{day}
						</div>
					))}
				</div>
				<div className="grid grid-cols-7">
					{days.map((day) => {
						const key = formatDayKey(day);
						const items = byDay.get(key) ?? [];
						return (
							// biome-ignore lint/a11y/noStaticElementInteractions: Month cells accept native date drops.
							<div
								key={key}
								className={cn(
									"relative min-h-28 border-r border-b p-1.5 last:border-r-0",
									day.getMonth() !== cursor.getMonth() &&
										"bg-muted/20 text-muted-foreground",
									dragTarget?.date === key &&
										dragTarget.mode === "keep-time" &&
										"bg-accent ring-1 ring-inset ring-foreground/20",
								)}
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
									onDrop(
										{ date: key, mode: "keep-time" },
										event.dataTransfer.getData("text/orbit-item-id"),
									);
								}}
							>
								<button
									type="button"
									onClick={() => onCreate(key)}
									onDragOver={(event) => {
										event.preventDefault();
										event.dataTransfer.dropEffect = "move";
										onDragPreview({ date: key, mode: "keep-time" });
									}}
									onDrop={(event) => {
										event.preventDefault();
										event.stopPropagation();
										onDrop(
											{ date: key, mode: "keep-time" },
											event.dataTransfer.getData("text/orbit-item-id"),
										);
									}}
									className={cn(
										"relative z-10 mb-1 grid size-7 place-items-center rounded-full text-xs font-medium hover:bg-muted",
										key === today &&
											"bg-foreground text-background hover:bg-foreground",
									)}
								>
									{day.getDate()}
								</button>
								<div className="relative z-10 space-y-1">
									{items.slice(0, 4).map((item) => (
										<CalendarEvent
											key={item.id}
											item={item}
											compact
											onClick={() => onOpen(item)}
											onDragStart={(event) => onDragStart(item, event)}
											onDragEnd={onDragEnd}
											dragging={draggingId === item.id}
										/>
									))}
									{items.length > 4 ? (
										<p className="px-1 text-[10px] text-muted-foreground">
											+{items.length - 4}개
										</p>
									) : null}
								</div>
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
}
