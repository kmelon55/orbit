import { useRouter } from "@tanstack/react-router";
import {
	CalendarDays,
	ChevronLeft,
	ChevronRight,
	ListTodo,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import { cn } from "@/lib/utils";

type ScheduleKind = "event" | "task";

function parseDay(value: string) {
	const [year, month, day] = value.split("-").map(Number);
	return new Date(year, month - 1, day);
}

function addDays(value: string, amount: number) {
	const date = parseDay(value);
	date.setDate(date.getDate() + amount);
	return formatDayKey(date);
}

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

function dateLabel(value: string) {
	return new Intl.DateTimeFormat("ko-KR", {
		month: "short",
		day: "numeric",
		weekday: "short",
	}).format(parseDay(value));
}

function DateStrip({
	value,
	onChange,
}: {
	value: string;
	onChange: (value: string) => void;
}) {
	const days = useMemo(
		() => Array.from({ length: 7 }, (_, index) => addDays(value, index - 3)),
		[value],
	);

	return (
		<div className="space-y-2">
			<div className="flex items-center gap-1">
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					onClick={() => onChange(addDays(value, -7))}
					aria-label="일주일 전"
				>
					<ChevronLeft />
				</Button>
				<div className="grid min-w-0 flex-1 grid-cols-7 gap-1">
					{days.map((day) => {
						const parsed = parseDay(day);
						const selected = day === value;
						return (
							<button
								key={day}
								type="button"
								onClick={() => onChange(day)}
								className={cn(
									"grid min-w-0 place-items-center rounded-lg px-1 py-2 text-xs transition-colors",
									selected
										? "bg-foreground text-background"
										: "text-muted-foreground hover:bg-muted hover:text-foreground",
								)}
							>
								<span>
									{["일", "월", "화", "수", "목", "금", "토"][parsed.getDay()]}
								</span>
								<span className="mt-1 text-sm font-semibold">
									{parsed.getDate()}
								</span>
							</button>
						);
					})}
				</div>
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					onClick={() => onChange(addDays(value, 7))}
					aria-label="일주일 후"
				>
					<ChevronRight />
				</Button>
			</div>
			<div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
				<span className="text-sm">{dateLabel(value)}</span>
				<DatePicker
					value={value}
					onChange={onChange}
					label="날짜 직접 선택"
					className="h-7 max-w-40 border-0 px-2 text-xs shadow-none"
				/>
			</div>
		</div>
	);
}

function TimeSelect({
	value,
	onChange,
	label,
}: {
	value: string;
	onChange: (value: string) => void;
	label: string;
}) {
	return (
		<div className="grid gap-1.5">
			<span className="text-xs font-medium text-muted-foreground">{label}</span>
			<TimePicker
				value={value}
				onChange={onChange}
				label={label}
				className="w-full justify-start"
			/>
		</div>
	);
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
			!allDay &&
			endDate === startDate &&
			endTime <= startTime
		) {
			setError("종료 시간은 시작 시간보다 뒤여야 합니다.");
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
								space: kind === "event" ? "event" : item.space,
								folder: kind === "task" ? item.folder : undefined,
								status: kind === "task" ? item.status : undefined,
								start,
								end,
								due,
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

					<div>
						<p className="mb-2 text-xs font-medium text-muted-foreground">
							{kind === "event" ? "시작 날짜" : "마감 날짜"}
						</p>
						<DateStrip
							value={startDate}
							onChange={(value) => {
								setStartDate(value);
								if (endDate < value) setEndDate(value);
							}}
						/>
					</div>

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
							{!allDay ? (
								<div className="grid grid-cols-2 gap-3">
									<TimeSelect
										label="시작"
										value={startTime}
										onChange={setStartTime}
									/>
									<TimeSelect
										label="종료"
										value={endTime}
										onChange={setEndTime}
									/>
								</div>
							) : null}
							<div className="grid gap-1.5">
								<span className="text-xs font-medium text-muted-foreground">
									종료 날짜
								</span>
								<DatePicker
									value={endDate}
									min={startDate}
									onChange={setEndDate}
									label="종료 날짜"
									className="w-full"
								/>
							</div>
						</div>
					) : (
						<div className="grid gap-1.5">
							<span className="text-xs font-medium text-muted-foreground">
								시간 선택 (선택 사항)
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
