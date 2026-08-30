import { useRouter } from "@tanstack/react-router";
import { CalendarDays, ListTodo } from "lucide-react";
import { useEffect, useState } from "react";
import { mutateOrbit } from "#/lib/orbit/functions";
import { formatDayKey } from "#/lib/orbit/para";
import { type OrbitItem, orbitItemSchema } from "#/lib/orbit/schema";
import { DatePicker, TimePicker } from "@/components/schedule-controls";
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
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!open) return;
		const baseDate = initialDate ?? today;
		const resolvedStart = dayOf(item?.start ?? item?.due, baseDate);
		const resolvedTime = timeOf(item?.start ?? item?.due, initialTime);
		setTitle(item?.title ?? "");
		setBody(item?.body ?? "");
		setStartDate(resolvedStart);
		setEndDate(dayOf(item?.end, resolvedStart));
		setStartTime(resolvedTime);
		setEndTime(timeOf(item?.end, addHour(resolvedTime)));
		setAllDay(
			kind === "event" && Boolean(item?.start && !item.start.includes("T")),
		);
		setTaskTime(
			kind === "task" && item?.due?.includes("T") ? resolvedTime : "",
		);
		setError(null);
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

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
				<DialogHeader>
					<div className="mb-1 flex size-9 items-center justify-center rounded-lg bg-muted">
						{kind === "event" ? <CalendarDays /> : <ListTodo />}
					</div>
					<DialogTitle>
						{item
							? kind === "event"
								? "일정 편집"
								: "할 일 편집"
							: kind === "event"
								? "새 일정"
								: "새 할 일"}
					</DialogTitle>
					<DialogDescription>
						{kind === "event"
							? "시간을 확보하고 필요한 맥락을 함께 적어두세요."
							: "마감일을 정하고 오늘 실행할 수 있게 만드세요."}
					</DialogDescription>
				</DialogHeader>

				<div className="grid gap-5 pt-2">
					<Input
						autoFocus
						value={title}
						onChange={(event) => setTitle(event.target.value)}
						placeholder={kind === "event" ? "일정 제목" : "할 일"}
						className="h-11 text-base"
					/>

					{kind === "event" ? (
						<div className="grid gap-3">
							<div className="flex items-center justify-between rounded-lg border px-3 py-2">
								<div>
									<p className="text-sm font-medium">종일</p>
									<p className="text-xs text-muted-foreground">
										시간 없이 날짜만 표시
									</p>
								</div>
								<Button
									type="button"
									variant={allDay ? "default" : "outline"}
									size="sm"
									onClick={() => setAllDay((current) => !current)}
								>
									{allDay ? "켜짐" : "꺼짐"}
								</Button>
							</div>
							<div className="grid gap-2 rounded-xl border p-3">
								<div className="grid items-center gap-2 sm:grid-cols-[3rem_minmax(0,1fr)_minmax(0,0.9fr)]">
									<span className="text-xs font-semibold text-muted-foreground">
										시작
									</span>
									<DatePicker
										value={startDate}
										onChange={(value) => {
											setStartDate(value);
											if (endDate < value) setEndDate(value);
										}}
										label="시작 날짜"
										className="w-full"
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
											className="w-full"
										/>
									) : null}
								</div>
								<div className="grid items-center gap-2 sm:grid-cols-[3rem_minmax(0,1fr)_minmax(0,0.9fr)]">
									<span className="text-xs font-semibold text-muted-foreground">
										종료
									</span>
									<DatePicker
										value={endDate}
										min={startDate}
										onChange={setEndDate}
										label="종료 날짜"
										className="w-full"
									/>
									{!allDay ? (
										<TimePicker
											value={endTime}
											onChange={setEndTime}
											label="종료 시간"
											className="w-full"
										/>
									) : null}
								</div>
							</div>
							<p className="text-xs text-muted-foreground">
								종료 날짜를 바꾸면 여러 날에 걸친 일정으로 저장됩니다.
							</p>
						</div>
					) : (
						<div className="grid gap-3 sm:grid-cols-2">
							<div className="grid gap-1.5">
								<span className="text-xs font-medium text-muted-foreground">
									마감 날짜
								</span>
								<DatePicker
									value={startDate}
									onChange={setStartDate}
									label="마감 날짜"
									className="w-full"
								/>
							</div>
							<div className="grid gap-1.5">
								<span className="text-xs font-medium text-muted-foreground">
									시간 (선택)
								</span>
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

					<Textarea
						value={body}
						onChange={(event) => setBody(event.target.value)}
						placeholder="메모, 장소, 준비할 것"
						className="min-h-24"
					/>
					{error ? <p className="text-sm text-destructive">{error}</p> : null}
					<div className="flex justify-end gap-2">
						<Button
							type="button"
							variant="ghost"
							onClick={() => onOpenChange(false)}
						>
							취소
						</Button>
						<Button
							type="button"
							disabled={!title.trim() || saving}
							onClick={() => void save()}
						>
							{saving ? "저장 중" : item ? "변경 저장" : "추가"}
						</Button>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
