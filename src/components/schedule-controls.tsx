import {
	CalendarDays,
	Check,
	ChevronLeft,
	ChevronRight,
	Clock3,
} from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { useEffect, useMemo, useState } from "react";
import { formatDayKey } from "#/lib/orbit/para";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const TIME_OPTIONS = Array.from({ length: 48 }, (_, index) => {
	const hour = Math.floor(index / 2);
	const minute = index % 2 === 0 ? "00" : "30";
	return `${String(hour).padStart(2, "0")}:${minute}`;
});

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
					<span>{value || placeholder}</span>
				</Button>
			</PopoverPrimitive.Trigger>
			<PopoverPrimitive.Portal>
				<PopoverPrimitive.Content
					align="start"
					sideOffset={6}
					className="z-[60] w-64 rounded-xl border bg-popover p-2 text-popover-foreground shadow-xl outline-none"
				>
					<p className="px-2 pt-1 pb-2 text-xs font-medium text-muted-foreground">
						{label}
					</p>
					<div className="max-h-64 overflow-y-auto pr-1">
						{allowEmpty ? (
							<button
								type="button"
								onClick={() => {
									onChange("");
									setOpen(false);
								}}
								className={cn(
									"mb-1 flex h-9 w-full items-center justify-between rounded-lg px-2.5 text-sm hover:bg-muted",
									!value && "bg-muted font-medium",
								)}
							>
								시간 없음 {!value ? <Check className="size-4" /> : null}
							</button>
						) : null}
						<div className="grid grid-cols-4 gap-1">
							{TIME_OPTIONS.map((time) => (
								<button
									key={time}
									type="button"
									onClick={() => {
										onChange(time);
										setOpen(false);
									}}
									className={cn(
										"h-9 rounded-lg text-sm tabular-nums transition-colors hover:bg-muted",
										value === time &&
											"bg-foreground font-medium text-background hover:bg-foreground",
									)}
								>
									{time}
								</button>
							))}
						</div>
					</div>
				</PopoverPrimitive.Content>
			</PopoverPrimitive.Portal>
		</PopoverPrimitive.Root>
	);
}
