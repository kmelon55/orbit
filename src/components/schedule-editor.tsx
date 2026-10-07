import {
	AlignLeft,
	CalendarDays,
	Clock3,
	ListTodo,
	Trash2,
} from "lucide-react";
import {
	lazy,
	type ReactNode,
	Suspense,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import { mutateOrbit } from "#/lib/orbit/functions";
import { isPendingItemId } from "#/lib/orbit/optimistic-mutations";
import { formatDayKey } from "#/lib/orbit/para";
import {
	type OrbitItem,
	type OrbitMutation,
	orbitItemSchema,
} from "#/lib/orbit/schema";
import { useI18n } from "@/components/locale-provider";
import type { NoteEditorHandle } from "@/components/note-editor";
import { ScheduleCategorySelect } from "@/components/schedule-categories";
import { DatePicker, TimePicker } from "@/components/schedule-controls";
import { ScheduleRangeCalendar } from "@/components/schedule-range-calendar";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

const MemoEditor = lazy(() =>
	import("@/components/note-editor").then(({ NoteEditor }) => ({
		default: NoteEditor,
	})),
);

function ScheduleEditorBody({ children }: { children: ReactNode }) {
	const contentRef = useRef<HTMLDivElement>(null);
	const [height, setHeight] = useState<number>();
	useLayoutEffect(() => {
		const content = contentRef.current;
		if (content) setHeight(content.getBoundingClientRect().height);
	});
	useLayoutEffect(() => {
		const content = contentRef.current;
		if (!content) return;
		const measure = () => setHeight(content.getBoundingClientRect().height);
		const observer = new ResizeObserver(measure);
		observer.observe(content);
		return () => observer.disconnect();
	}, []);
	return (
		<div
			data-slot="schedule-editor-body"
			className="min-h-0 shrink overflow-y-auto overscroll-contain transition-[height] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
			style={{ height }}
		>
			<div ref={contentRef} className="grid gap-4 px-5 py-4">
				{children}
			</div>
		</div>
	);
}

type ScheduleKind = "event" | "task";

function timeOf(value: string | undefined, fallback: string) {
	return value?.match(/T(\d{2}:\d{2})/)?.[1] ?? fallback;
}

function dayOf(value: string | undefined, fallback: string) {
	return value?.slice(0, 10) ?? fallback;
}

function addHour(value: string) {
	const [hour, minute] = value.split(":").map(Number);
	const next = (hour * 60 + minute + 60) % (24 * 60);
	return `${String(Math.floor(next / 60)).padStart(2, "0")}:${String(next % 60).padStart(2, "0")}`;
}

function nextDay(value: string) {
	const [year, month, day] = value.split("-").map(Number);
	return formatDayKey(new Date(year, month - 1, day + 1));
}

export function ScheduleEditor({
	open,
	onOpenChange,
	kind: initialKind,
	item,
	initialDate,
	initialTime = "09:00",
	onSaved,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	kind: ScheduleKind;
	item?: OrbitItem;
	initialDate?: string;
	initialTime?: string;
	onSaved?: (item: OrbitItem) => void;
}) {
	const { t, errorText } = useI18n();

	const editRevision = useRef(0);
	const memoEditorRef = useRef<NoteEditorHandle>(null);
	const today = formatDayKey();
	const [kind, setKind] = useState<ScheduleKind>(initialKind);
	const [title, setTitle] = useState("");
	const [body, setBody] = useState("");
	const color = item?.color;
	const [category, setCategory] = useState<string | undefined>();
	const [startDate, setStartDate] = useState(initialDate ?? today);
	const [endDate, setEndDate] = useState(initialDate ?? today);
	const [startTime, setStartTime] = useState(initialTime);
	const [endTime, setEndTime] = useState(addHour(initialTime));
	const [allDay, setAllDay] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!open) return;
		editRevision.current++;
		const baseDate = initialDate ?? today;
		const resolvedStart = dayOf(item?.start ?? item?.due, baseDate);
		const resolvedTime = timeOf(item?.start ?? item?.due, initialTime);
		const resolvedKind =
			item?.type === "event" || item?.type === "task" ? item.type : initialKind;
		const defaultEndTime = addHour(resolvedTime);
		const defaultEndDate =
			!item?.end &&
			(resolvedKind === "event" || item?.due?.includes("T")) &&
			defaultEndTime <= resolvedTime
				? nextDay(resolvedStart)
				: resolvedStart;
		setKind(resolvedKind);
		setTitle(item?.title ?? "");
		setCategory(item?.category);
		setBody(item?.body ?? "");
		setStartDate(
			item?.type === "task" && !item.start && !item.due ? "" : resolvedStart,
		);
		setEndDate(dayOf(item?.end, resolvedKind === "task" ? "" : defaultEndDate));
		setStartTime(resolvedTime);
		setEndTime(timeOf(item?.end, defaultEndTime));
		setAllDay(
			resolvedKind === "task"
				? !((item?.start ?? item?.due)?.includes("T") ?? Boolean(initialDate))
				: Boolean(item?.start && !item.start.includes("T")),
		);
		setError(null);
		setDeleteOpen(false);
	}, [initialDate, initialTime, item, initialKind, open, today]);

	function changeKind(next: ScheduleKind) {
		if (next === kind) return;
		if (next === "event") {
			const date = startDate || today;
			setStartDate(date);
			if (
				!endDate ||
				endDate < date ||
				(!allDay && endDate === date && endTime <= startTime)
			) {
				const time = addHour(startTime);
				setEndTime(time);
				setEndDate(!allDay && time <= startTime ? nextDay(date) : date);
			}
		}
		setKind(next);
		setError(null);
	}

	async function save() {
		const trimmed = title.trim();
		const memoBody = memoEditorRef.current?.getMarkdown() ?? body;
		if (!trimmed) return;
		if (trimmed.length > 160 || memoBody.length > (item ? 100_000 : 20_000)) {
			setError(t("제목이나 본문이 너무 깁니다."));
			return;
		}
		if (
			(kind === "event" && (!startDate || !endDate)) ||
			(endDate &&
				(!startDate ||
					endDate < startDate ||
					(!allDay && endDate === startDate && endTime <= startTime)))
		) {
			setError(t("종료는 시작보다 뒤여야 합니다."));
			return;
		}
		const start =
			kind === "event" || Boolean(startDate && endDate)
				? allDay
					? startDate
					: `${startDate}T${startTime}:00`
				: undefined;
		const end =
			kind === "event" || Boolean(startDate && endDate)
				? allDay
					? endDate
					: `${endDate}T${endTime}:00`
				: undefined;
		const due =
			kind === "task" && startDate
				? allDay
					? startDate
					: `${startDate}T${startTime}:00`
				: undefined;
		if (
			item &&
			item.type === kind &&
			item.title === trimmed &&
			item.body === memoBody.trim() &&
			item.start === start &&
			item.end === end &&
			item.due === due &&
			item.color === color &&
			item.category === category
		) {
			onOpenChange(false);
			return;
		}
		const mutation: OrbitMutation = item
			? {
					action: "file-item",
					id: item.id,
					input: {
						title: trimmed,
						body: memoBody,
						type: kind,
						color: color ?? null,
						category: category ?? null,
						space:
							kind === "event"
								? "event"
								: item.space === "event"
									? "inbox"
									: item.space,
						folder: kind === "task" ? item.folder : undefined,
						status: kind === "task" ? item.status : undefined,
						start: start ?? null,
						end: end ?? null,
						due: due ?? null,
					},
				}
			: {
					action: "create-item",
					input: {
						title: trimmed,
						body: memoBody,
						type: kind,
						color,
						category,
						space: kind === "event" ? "event" : "inbox",
						start,
						end,
						due,
					},
				};
		const revision = editRevision.current;
		let running = false;
		const persist = async () => {
			if (running) return;
			running = true;
			try {
				const saved = orbitItemSchema.parse(
					await mutateOrbit({ data: mutation }),
				);
				if (revision === editRevision.current) onSaved?.(saved);
			} catch {
				toast.error(t("저장하지 못했습니다."), {
					description: trimmed,
					duration: 15000,
					action: {
						label: t("다시 시도"),
						onClick: () => {
							void persist();
						},
					},
				});
			} finally {
				running = false;
			}
		};
		setError(null);
		onOpenChange(false);
		void persist();
	}

	async function deleteItem() {
		if (!item || deleting) return;
		setDeleting(true);
		setError(null);
		setDeleteOpen(false);
		onOpenChange(false);
		try {
			await mutateOrbit({ data: { action: "delete-item", id: item.id } });
		} catch {
			setDeleteOpen(false);
			toast.error(t("삭제하지 못했습니다. 항목을 원래대로 돌렸습니다."));
		} finally {
			setDeleting(false);
		}
	}

	if (isPendingItemId(item?.id)) return null;
	return (
		<>
			<Dialog open={open} onOpenChange={onOpenChange}>
				<DialogContent className="top-[max(0.75rem,env(safe-area-inset-top))] flex max-h-[calc(100svh-1.5rem)] translate-y-0 gap-0 overflow-hidden p-0 sm:top-[6svh] sm:max-h-[88svh] sm:max-w-xl">
					<form
						className="flex min-h-0 w-full flex-col"
						onSubmit={(event) => {
							event.preventDefault();
							void save();
						}}
					>
						<DialogHeader className="shrink-0 border-b border-border/60 px-5 pt-5 pb-4">
							<fieldset
								aria-label={t("항목 종류")}
								className="relative grid w-full grid-cols-2 rounded-xl bg-muted/60 p-1"
							>
								<span
									aria-hidden="true"
									className={`pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-lg bg-background shadow-sm transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${kind === "event" ? "translate-x-full" : "translate-x-0"}`}
								/>
								{(["task", "event"] as const).map((value) => {
									const Icon = value === "task" ? ListTodo : CalendarDays;
									return (
										<Button
											key={value}
											type="button"
											variant="ghost"
											size="sm"
											aria-pressed={kind === value}
											onClick={() => changeKind(value)}
											className={`relative h-9 w-full rounded-lg hover:bg-transparent ${kind === value ? "text-foreground" : "text-muted-foreground"}`}
										>
											<Icon /> {value === "task" ? t("할 일") : t("일정")}
										</Button>
									);
								})}
							</fieldset>
							<DialogTitle className="sr-only">
								{item
									? kind === "task"
										? t("할 일 편집")
										: t("일정 편집")
									: kind === "task"
										? t("새 할 일")
										: t("새 일정")}
							</DialogTitle>
							<DialogDescription className="sr-only">
								{t("제목, 날짜, 시간과 메모를 입력하세요.")}
							</DialogDescription>
							<Input
								autoFocus
								value={title}
								onChange={(event) => setTitle(event.target.value)}
								placeholder={kind === "event" ? t("일정 제목") : t("할 일")}
								className="h-auto border-0 bg-transparent px-0 py-1 text-xl font-semibold shadow-none focus-visible:ring-0"
							/>
						</DialogHeader>

						<ScheduleEditorBody>
							<ScheduleCategorySelect value={category} onChange={setCategory} />
							<div className="grid gap-3">
								<div className="flex items-center gap-3">
									<CalendarDays className="size-4 shrink-0 text-muted-foreground" />
									<span className="flex-1 text-sm font-medium">
										{t("날짜와 시간")}
									</span>
									<div className="flex items-center gap-2 text-xs text-muted-foreground">
										{t("종일")}
										<button
											type="button"
											role="switch"
											aria-label={t("종일")}
											aria-checked={allDay}
											onClick={() => setAllDay((current) => !current)}
											className={`relative h-5 w-9 rounded-full transition-colors ${allDay ? "bg-blue-500" : "bg-muted-foreground/25"}`}
										>
											<span
												className={`absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow-sm transition-transform ${allDay ? "translate-x-4" : "translate-x-0"}`}
											/>
										</button>
									</div>
								</div>
								<div className="ml-7 grid gap-2 rounded-xl bg-muted/40 p-2.5">
									<div className="grid items-center gap-2 sm:grid-cols-[2rem_minmax(0,1fr)_9.5rem]">
										<span className="text-xs font-medium text-muted-foreground">
											{t("시작")}
										</span>
										<DatePicker
											value={startDate}
											onChange={(value) => {
												setStartDate(value);
												if (!value) setEndDate("");
												else if (endDate && endDate < value) setEndDate(value);
											}}
											label={t("시작 날짜")}
											allowClear={kind === "task"}
											placeholder={t("날짜 없음")}
											className={`w-full min-w-0 bg-background ${allDay ? "sm:col-span-2" : ""}`}
										/>
										{!allDay ? (
											<TimePicker
												value={startTime}
												onChange={(value) => {
													setStartTime(value);
													if (endDate === startDate && endTime <= value) {
														const nextEndTime = addHour(value);
														setEndTime(nextEndTime);
														if (nextEndTime <= value)
															setEndDate(nextDay(startDate));
													}
												}}
												label={t("시작 시간")}
												disabled={!startDate}
												className="w-full bg-background"
											/>
										) : null}
									</div>
									<div className="grid items-center gap-2 sm:grid-cols-[2rem_minmax(0,1fr)_9.5rem]">
										<span className="text-xs font-medium text-muted-foreground">
											{t("종료")}
										</span>
										<DatePicker
											value={endDate}
											min={startDate}
											onChange={setEndDate}
											label={t("종료 날짜")}
											allowClear={kind === "task"}
											disabled={!startDate}
											placeholder={t("날짜 없음")}
											className={`w-full min-w-0 bg-background ${allDay ? "sm:col-span-2" : ""}`}
										/>
										{!allDay ? (
											<TimePicker
												value={endTime}
												onChange={setEndTime}
												label={t("종료 시간")}
												disabled={!endDate}
												className="w-full bg-background"
											/>
										) : null}
									</div>
								</div>
								{startDate && endDate ? (
									<ScheduleRangeCalendar
										value={{ startDate, endDate, startTime, endTime }}
										onChange={(range) => {
											setStartDate(range.startDate);
											setEndDate(range.endDate);
											setStartTime(range.startTime);
											setEndTime(range.endTime);
										}}
									/>
								) : (
									<DatePicker
										inline
										value={startDate}
										onChange={setStartDate}
										label={t("할 일 날짜 달력")}
										allowClear
									/>
								)}
							</div>

							<div className="grid grid-cols-[1rem_minmax(0,1fr)] items-start gap-3">
								<AlignLeft className="mt-2.5 size-4 text-muted-foreground" />
								<div className="orbit-schedule-memo min-w-0 rounded-xl border bg-background">
									<Suspense
										fallback={
											<div
												className="min-h-24 px-3 py-2 text-sm text-muted-foreground"
												aria-busy="true"
											>
												{body || t("메모")}
											</div>
										}
									>
										<MemoEditor
											ref={memoEditorRef}
											key={`${item?.id ?? "new"}:${editRevision.current}`}
											noteId={`schedule-memo:${item?.id ?? "new"}:${editRevision.current}`}
											markdown={body}
											onChange={setBody}
											placeholder={t("메모, 장소, 준비할 것")}
											label={t("메모 (Markdown)")}
											compact
										/>
									</Suspense>
								</div>
							</div>
							{error ? (
								<p className="text-sm text-destructive">{errorText(error)}</p>
							) : null}
						</ScheduleEditorBody>

						<div className="flex shrink-0 items-center justify-between border-t border-border/60 bg-muted/25 px-5 py-3">
							{item ? (
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="text-muted-foreground hover:text-destructive"
									onClick={() => setDeleteOpen(true)}
								>
									<Trash2 /> {t("삭제")}
								</Button>
							) : (
								<span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
									<Clock3 className="size-3" /> {t("Enter로 저장")}
								</span>
							)}
							<div className="flex gap-2">
								<Button
									type="button"
									variant="ghost"
									onClick={() => onOpenChange(false)}
								>
									{t("취소")}
								</Button>
								<Button type="submit" disabled={!title.trim()}>
									{item ? t("저장") : t("추가")}
								</Button>
							</div>
						</div>
					</form>
				</DialogContent>
			</Dialog>

			<AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t("이 항목을 삭제할까요?")}</AlertDialogTitle>
						<AlertDialogDescription>
							“{item?.title}
							{t("” 항목을 삭제합니다.")}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={deleting}>
							{t("취소")}
						</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={deleting}
							onClick={() => void deleteItem()}
						>
							{deleting ? t("삭제 중") : t("삭제")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
