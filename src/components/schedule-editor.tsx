import { useRouter } from "@tanstack/react-router";
import {
	AlignLeft,
	CalendarDays,
	Clock3,
	ListTodo,
	Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { mutateOrbit } from "#/lib/orbit/functions";
import { formatDayKey } from "#/lib/orbit/para";
import { type OrbitItem, orbitItemSchema } from "#/lib/orbit/schema";
import { DatePicker, TimePicker } from "@/components/schedule-controls";
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
import { Textarea } from "@/components/ui/textarea";

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
	kind,
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
	const router = useRouter();
	const today = formatDayKey();
	const [title, setTitle] = useState("");
	const [body, setBody] = useState("");
	const [startDate, setStartDate] = useState(initialDate ?? today);
	const [endDate, setEndDate] = useState(initialDate ?? today);
	const [startTime, setStartTime] = useState(initialTime);
	const [endTime, setEndTime] = useState(addHour(initialTime));
	const [allDay, setAllDay] = useState(false);
	const [taskTime, setTaskTime] = useState("");
	const [saving, setSaving] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!open) return;
		const baseDate = initialDate ?? today;
		const resolvedStart = dayOf(item?.start ?? item?.due, baseDate);
		const resolvedTime = timeOf(item?.start ?? item?.due, initialTime);
		const defaultEndTime = addHour(resolvedTime);
		const defaultEndDate =
			!item?.end && defaultEndTime <= resolvedTime
				? nextDay(resolvedStart)
				: resolvedStart;
		setTitle(item?.title ?? "");
		setBody(item?.body ?? "");
		setStartDate(resolvedStart);
		setEndDate(dayOf(item?.end, defaultEndDate));
		setStartTime(resolvedTime);
		setEndTime(timeOf(item?.end, defaultEndTime));
		setAllDay(
			kind === "event" && Boolean(item?.start && !item.start.includes("T")),
		);
		setTaskTime(
			kind === "task" && item?.due?.includes("T") ? resolvedTime : "",
		);
		setError(null);
		setDeleteOpen(false);
	}, [initialDate, initialTime, item, kind, open, today]);

	async function save() {
		const trimmed = title.trim();
		if (!trimmed || saving) return;
		if (
			kind === "event" &&
			(endDate < startDate ||
				(!allDay && endDate === startDate && endTime <= startTime))
		) {
			setError("종료는 시작보다 뒤여야 합니다.");
			return;
		}
		setSaving(true);
		setError(null);
		try {
			const start =
				kind === "event"
					? allDay
						? startDate
						: `${startDate}T${startTime}:00`
					: undefined;
			const end =
				kind === "event"
					? allDay
						? endDate
						: `${endDate}T${endTime}:00`
					: undefined;
			const due =
				kind === "task"
					? taskTime
						? `${startDate}T${taskTime}:00`
						: startDate
					: undefined;

			if (
				item &&
				item.title === trimmed &&
				item.body === body.trim() &&
				item.start === start &&
				item.end === end &&
				item.due === due
			) {
				onOpenChange(false);
				return;
			}

			let saved: OrbitItem;
			if (item) {
				saved = orbitItemSchema.parse(
					await mutateOrbit({
						data: {
							action: "file-item",
							id: item.id,
							input: {
								title: trimmed,
								body,
								type: kind,
								space:
									kind === "event"
										? "event"
										: item.space === "event"
											? "inbox"
											: item.space,
								folder: kind === "task" ? item.folder : undefined,
								status: kind === "task" ? item.status : undefined,
								start: kind === "event" ? start : null,
								end: kind === "event" ? end : null,
								due: kind === "task" ? due : null,
							},
						},
					}),
				);
			} else {
				saved = orbitItemSchema.parse(
					await mutateOrbit({
						data: {
							action: "create-item",
							input: {
								title: trimmed,
								body,
								type: kind,
								space: kind === "event" ? "event" : "inbox",
								start,
								end,
								due,
							},
						},
					}),
				);
			}
			await router.invalidate();
			onSaved?.(saved);
			onOpenChange(false);
		} catch {
			setError("저장하지 못했습니다. 날짜와 파일 권한을 확인해 주세요.");
		} finally {
			setSaving(false);
		}
	}

	async function deleteItem() {
		if (!item || deleting) return;
		setDeleting(true);
		setError(null);
		try {
			await mutateOrbit({ data: { action: "delete-item", id: item.id } });
			await router.invalidate();
			setDeleteOpen(false);
			onOpenChange(false);
		} catch {
			setDeleteOpen(false);
			setError("삭제하지 못했습니다. 파일 권한을 확인해 주세요.");
		} finally {
			setDeleting(false);
		}
	}

	return (
		<>
			<Dialog open={open} onOpenChange={onOpenChange}>
				<DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-lg">
					<form
						onSubmit={(event) => {
							event.preventDefault();
							void save();
						}}
					>
						<DialogHeader className="border-b border-border/60 px-5 pt-5 pb-4">
							<div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
								<span
									className={`size-2.5 rounded-full ${kind === "event" ? "bg-blue-500" : "bg-amber-500"}`}
								/>
								{item
									? kind === "event"
										? "일정 편집"
										: "할 일 편집"
									: kind === "event"
										? "새 일정"
										: "새 할 일"}
							</div>
							<DialogTitle className="sr-only">
								{item ? "일정 편집" : "새 일정"}
							</DialogTitle>
							<DialogDescription className="sr-only">
								제목, 날짜, 시간과 메모를 입력하세요.
							</DialogDescription>
							<Input
								autoFocus
								value={title}
								onChange={(event) => setTitle(event.target.value)}
								placeholder={kind === "event" ? "일정 제목" : "할 일"}
								className="h-auto border-0 bg-transparent px-0 py-1 text-xl font-semibold shadow-none focus-visible:ring-0"
							/>
						</DialogHeader>

						<div className="grid gap-4 px-5 py-4">
							{kind === "event" ? (
								<div className="grid gap-3">
									<div className="flex items-center gap-3">
										<CalendarDays className="size-4 shrink-0 text-muted-foreground" />
										<span className="flex-1 text-sm font-medium">
											날짜와 시간
										</span>
										<div className="flex items-center gap-2 text-xs text-muted-foreground">
											종일
											<button
												type="button"
												role="switch"
												aria-checked={allDay}
												onClick={() => setAllDay((current) => !current)}
												className={`relative h-5 w-9 rounded-full transition-colors ${allDay ? "bg-blue-500" : "bg-muted-foreground/25"}`}
											>
												<span
													className={`absolute top-0.5 size-4 rounded-full bg-white shadow-sm transition-transform ${allDay ? "translate-x-4" : "translate-x-0.5"}`}
												/>
											</button>
										</div>
									</div>
									<div className="ml-7 grid gap-2 rounded-xl bg-muted/40 p-2.5">
										<div className="grid items-center gap-2 sm:grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,0.82fr)]">
											<span className="text-xs font-medium text-muted-foreground">
												시작
											</span>
											<DatePicker
												value={startDate}
												onChange={(value) => {
													setStartDate(value);
													if (endDate < value) setEndDate(value);
												}}
												label="시작 날짜"
												className="w-full bg-background"
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
													label="시작 시간"
													className="w-full bg-background"
												/>
											) : null}
										</div>
										<div className="grid items-center gap-2 sm:grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,0.82fr)]">
											<span className="text-xs font-medium text-muted-foreground">
												종료
											</span>
											<DatePicker
												value={endDate}
												min={startDate}
												onChange={setEndDate}
												label="종료 날짜"
												className="w-full bg-background"
											/>
											{!allDay ? (
												<TimePicker
													value={endTime}
													onChange={setEndTime}
													label="종료 시간"
													className="w-full bg-background"
												/>
											) : null}
										</div>
									</div>
								</div>
							) : (
								<div className="grid grid-cols-[1rem_minmax(0,1fr)] items-start gap-3">
									<ListTodo className="mt-2.5 size-4 text-muted-foreground" />
									<div className="grid gap-2 sm:grid-cols-2">
										<DatePicker
											value={startDate}
											onChange={setStartDate}
											label="마감 날짜"
											className="w-full"
										/>
										<TimePicker
											value={taskTime}
											onChange={setTaskTime}
											label="할 일 시간"
											placeholder="시간 없음"
											allowEmpty
											className="w-full"
										/>
									</div>
								</div>
							)}

							<div className="grid grid-cols-[1rem_minmax(0,1fr)] items-start gap-3">
								<AlignLeft className="mt-2.5 size-4 text-muted-foreground" />
								<Textarea
									value={body}
									onChange={(event) => setBody(event.target.value)}
									placeholder="메모, 장소, 준비할 것"
									className="min-h-24 resize-none"
								/>
							</div>
							{error ? (
								<p className="text-sm text-destructive">{error}</p>
							) : null}
						</div>

						<div className="flex items-center justify-between border-t border-border/60 bg-muted/25 px-5 py-3">
							{item ? (
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="text-muted-foreground hover:text-destructive"
									onClick={() => setDeleteOpen(true)}
								>
									<Trash2 /> 삭제
								</Button>
							) : (
								<span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
									<Clock3 className="size-3" /> Enter로 저장
								</span>
							)}
							<div className="flex gap-2">
								<Button
									type="button"
									variant="ghost"
									onClick={() => onOpenChange(false)}
								>
									취소
								</Button>
								<Button type="submit" disabled={!title.trim() || saving}>
									{saving ? "저장 중" : item ? "저장" : "추가"}
								</Button>
							</div>
						</div>
					</form>
				</DialogContent>
			</Dialog>

			<AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>이 항목을 삭제할까요?</AlertDialogTitle>
						<AlertDialogDescription>
							“{item?.title}” 파일이 Vault에서 완전히 삭제됩니다.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={deleting}>취소</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={deleting}
							onClick={() => void deleteItem()}
						>
							{deleting ? "삭제 중" : "삭제"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
