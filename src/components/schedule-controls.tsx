import { CalendarDays, ChevronLeft, ChevronRight, Clock3 } from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatDayKey } from "#/lib/orbit/para";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const MINUTES = Array.from({ length: 60 }, (_, minute) => minute);
const WHEEL_ROW_HEIGHT = 36;

function parseTime(value: string) {
	const match = value.match(/^(\d{2}):(\d{2})$/);
	if (!match) return { hour: 9, minute: 0 };
	return {
		hour: Math.min(23, Number(match[1])),
		minute: Math.min(59, Number(match[2])),
	};
}

function timeValue(hour: number, minute: number) {
	return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function hourLabel(hour: number) {
	return `${hour < 12 ? "오전" : "오후"} ${hour === 0 || hour === 12 ? hour : hour % 12}시`;
}

function timeLabel(value: string) {
	if (!value) return "";
	const { hour, minute } = parseTime(value);
	return `${hourLabel(hour).replace("시", "")}시 ${String(minute).padStart(2, "0")}분`;
}

function TimeWheel({
	label,
	values,
	selected,
	onSelect,
	format,
	className,
}: {
	label: string;
	values: number[];
	selected: number;
	onSelect: (value: number) => void;
	format: (value: number) => string;
	className?: string;
}) {
	const viewportRef = useRef<HTMLDivElement>(null);
	const settleTimerRef = useRef<number | undefined>(undefined);

	useEffect(() => {
		viewportRef.current?.scrollTo({
			top: selected * WHEEL_ROW_HEIGHT,
			behavior: "auto",
		});
	}, [selected]);

	useEffect(
		() => () => {
			if (settleTimerRef.current) window.clearTimeout(settleTimerRef.current);
		},
		[],
	);

	return (
		<div className={cn("min-w-0", className)}>
			<p className="mb-1.5 text-center text-[11px] font-medium text-muted-foreground">
				{label}
			</p>
			<div className="relative overflow-hidden rounded-xl border bg-background/60">
				<div className="pointer-events-none absolute inset-x-1 top-1/2 z-10 h-9 -translate-y-1/2 rounded-lg bg-foreground/[0.07] ring-1 ring-foreground/10" />
				<div
					ref={viewportRef}
					role="listbox"
					aria-label={label}
					onScroll={(event) => {
						if (settleTimerRef.current)
							window.clearTimeout(settleTimerRef.current);
						const scrollTop = event.currentTarget.scrollTop;
						settleTimerRef.current = window.setTimeout(() => {
							const index = Math.max(
								0,
								Math.min(
									values.length - 1,
									Math.round(scrollTop / WHEEL_ROW_HEIGHT),
								),
							);
							onSelect(values[index]);
						}, 70);
					}}
					className="h-[180px] snap-y snap-mandatory overflow-y-auto overscroll-contain scroll-smooth py-[72px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
				>
					{values.map((value) => (
						<button
							key={value}
							type="button"
							role="option"
							aria-selected={value === selected}
							onClick={() => onSelect(value)}
							className={cn(
								"relative z-20 flex h-9 w-full snap-center items-center justify-center whitespace-nowrap px-2 text-sm tabular-nums transition-[color,opacity] duration-100",
								value === selected
									? "font-semibold text-foreground"
									: "text-muted-foreground/55 hover:text-foreground/80",
							)}
						>
							{format(value)}
						</button>
					))}
				</div>
			</div>
		</div>
	);
}

function parseDay(value?: string) {
	const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (!match) return new Date();
	return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function addDays(date: Date, amount: number) {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
}

function addMonths(date: Date, amount: number) {
	return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function dateLabel(value: string, placeholder: string) {
	if (!value) return placeholder;
	const today = formatDayKey();
	const tomorrow = formatDayKey(addDays(new Date(), 1));
	const prefix =
		value === today ? "오늘 · " : value === tomorrow ? "내일 · " : "";
	return `${prefix}${new Intl.DateTimeFormat("ko-KR", {
		month: "long",
		day: "numeric",
		weekday: "short",
	}).format(parseDay(value))}`;
}

export function DatePicker({
	value,
	onChange,
	label,
	placeholder = "날짜 선택",
	min,
	allowClear = false,
	className,
}: {
	value: string;
	onChange: (value: string) => void;
	label: string;
	placeholder?: string;
	min?: string;
	allowClear?: boolean;
	className?: string;
}) {
	const [open, setOpen] = useState(false);
	const [cursor, setCursor] = useState(() => parseDay(value));

	useEffect(() => {
		if (open) setCursor(parseDay(value));
	}, [open, value]);

	const days = useMemo(() => {
		const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
		const start = addDays(first, -first.getDay());
		return Array.from({ length: 42 }, (_, index) => addDays(start, index));
	}, [cursor]);

	return (
		<PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
			<PopoverPrimitive.Trigger asChild>
				<Button
					type="button"
					variant="outline"
					aria-label={label}
					className={cn(
						"justify-start gap-2 font-normal tabular-nums",
						!value && "text-muted-foreground",
						className,
					)}
				>
					<CalendarDays className="size-4" />
					<span className="truncate">{dateLabel(value, placeholder)}</span>
				</Button>
			</PopoverPrimitive.Trigger>
			<PopoverPrimitive.Portal>
				<PopoverPrimitive.Content
					align="start"
					sideOffset={6}
					className="z-[60] w-72 rounded-xl border bg-popover p-3 text-popover-foreground shadow-xl outline-none"
				>
					<div className="mb-3 flex items-center justify-between">
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							onClick={() => setCursor((current) => addMonths(current, -1))}
							aria-label="이전 달"
						>
							<ChevronLeft />
						</Button>
						<p className="text-sm font-semibold">
							{cursor.getFullYear()}년 {cursor.getMonth() + 1}월
						</p>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							onClick={() => setCursor((current) => addMonths(current, 1))}
							aria-label="다음 달"
						>
							<ChevronRight />
						</Button>
					</div>
					<div className="mb-1 grid grid-cols-7 text-center text-[11px] font-medium text-muted-foreground">
						{["일", "월", "화", "수", "목", "금", "토"].map((day) => (
							<span key={day} className="py-1">
								{day}
							</span>
						))}
					</div>
					<div className="grid grid-cols-7 gap-0.5">
						{days.map((day) => {
							const key = formatDayKey(day);
							const selected = key === value;
							const today = key === formatDayKey();
							const outside = day.getMonth() !== cursor.getMonth();
							const disabled = Boolean(min && key < min);
							return (
								<button
									key={key}
									type="button"
									disabled={disabled}
									onClick={() => {
										onChange(key);
										setOpen(false);
									}}
									className={cn(
										"relative grid size-9 place-items-center rounded-lg text-sm transition-colors",
										selected
											? "bg-foreground font-semibold text-background"
											: "hover:bg-muted",
										outside && !selected && "text-muted-foreground/45",
										today && !selected && "font-semibold text-foreground",
										disabled &&
											"cursor-not-allowed opacity-25 hover:bg-transparent",
									)}
								>
									{day.getDate()}
									{today ? (
										<span className="absolute bottom-1 size-1 rounded-full bg-current" />
									) : null}
								</button>
							);
						})}
					</div>
					<div className="mt-3 flex items-center justify-between border-t pt-2">
						{allowClear ? (
							<Button
								type="button"
								variant="ghost"
								size="sm"
								onClick={() => {
									onChange("");
									setOpen(false);
								}}
							>
								날짜 없음
							</Button>
						) : (
							<span />
						)}
						<Button
							type="button"
							variant="ghost"
							size="sm"
							disabled={Boolean(min && formatDayKey() < min)}
							onClick={() => {
								onChange(formatDayKey());
								setOpen(false);
							}}
						>
							오늘
						</Button>
					</div>
				</PopoverPrimitive.Content>
			</PopoverPrimitive.Portal>
		</PopoverPrimitive.Root>
	);
}

export function TimePicker({
	value,
	onChange,
	label,
	placeholder = "시간 선택",
	allowEmpty = false,
	className,
}: {
	value: string;
	onChange: (value: string) => void;
	label: string;
	placeholder?: string;
	allowEmpty?: boolean;
	className?: string;
}) {
	const [open, setOpen] = useState(false);
	const initial = parseTime(value);
	const [hour, setHour] = useState(initial.hour);
	const [minute, setMinute] = useState(initial.minute);

	useEffect(() => {
		if (!open) return;
		const next = parseTime(value);
		setHour(next.hour);
		setMinute(next.minute);
	}, [open, value]);

	return (
		<PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
			<PopoverPrimitive.Trigger asChild>
				<Button
					type="button"
					variant="outline"
					aria-label={label}
					className={cn(
						"justify-start gap-2 font-normal tabular-nums",
						!value && "text-muted-foreground",
						className,
					)}
				>
					<Clock3 className="size-4" />
					<span>{value ? timeLabel(value) : placeholder}</span>
				</Button>
			</PopoverPrimitive.Trigger>
			<PopoverPrimitive.Portal>
				<PopoverPrimitive.Content
					align="start"
					sideOffset={6}
					className="z-[60] w-72 rounded-xl border bg-popover p-3 text-popover-foreground shadow-xl outline-none"
				>
					<div className="mb-3 flex items-center justify-between gap-3">
						<p className="text-xs font-medium text-muted-foreground">{label}</p>
						<p className="text-sm font-semibold tabular-nums">
							{timeLabel(timeValue(hour, minute))}
						</p>
					</div>
					<div className="grid grid-cols-[1.5fr_1fr] gap-2">
						<TimeWheel
							label="시"
							values={HOURS}
							selected={hour}
							onSelect={setHour}
							format={hourLabel}
						/>
						<TimeWheel
							label="분"
							values={MINUTES}
							selected={minute}
							onSelect={setMinute}
							format={(nextMinute) =>
								`${String(nextMinute).padStart(2, "0")}분`
							}
						/>
					</div>
					<div className="mt-3 flex items-center justify-between border-t pt-2">
						{allowEmpty ? (
							<Button
								type="button"
								variant="ghost"
								size="sm"
								onClick={() => {
									onChange("");
									setOpen(false);
								}}
							>
								시간 없음
							</Button>
						) : (
							<span />
						)}
						<Button
							type="button"
							size="sm"
							onClick={() => {
								onChange(timeValue(hour, minute));
								setOpen(false);
							}}
						>
							완료
						</Button>
					</div>
				</PopoverPrimitive.Content>
			</PopoverPrimitive.Portal>
		</PopoverPrimitive.Root>
	);
}
