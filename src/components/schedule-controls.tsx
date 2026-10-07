import { CalendarDays, ChevronLeft, ChevronRight, Clock3 } from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { resolveLocale, translate, weekdayName } from "#/lib/i18n";
import { formatDayKey } from "#/lib/orbit/para";
import { useI18n } from "@/components/locale-provider";
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

function hourLabel(hour: number, locale = "ko-KR") {
	return new Intl.DateTimeFormat(locale, { hour: "numeric" }).format(
		new Date(2023, 0, 1, hour),
	);
}

function timeLabel(value: string, locale = "ko-KR") {
	if (!value) return "";
	const { hour, minute } = parseTime(value);
	return new Intl.DateTimeFormat(locale, {
		hour: "numeric",
		minute: "2-digit",
	}).format(new Date(2023, 0, 1, hour, minute));
}

type WheelMotion = {
	active: () => boolean;
	choose: (index: number) => void;
	jump: (index: number) => void;
	begin: () => void;
	drag: (top: number) => void;
	finish: () => void;
};

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
	const dragRef = useRef<{ y: number; top: number; moved: boolean } | null>(
		null,
	);
	const suppressClick = useRef(false);
	const latestSelected = useRef(selected);
	const onSelectRef = useRef(onSelect);
	const motion = useRef<WheelMotion | null>(null);
	const [dragging, setDragging] = useState(false);

	useEffect(() => {
		onSelectRef.current = onSelect;
	}, [onSelect]);

	useEffect(() => {
		const viewport = viewportRef.current;
		if (!viewport) return;
		const element = viewport;
		const max = (values.length - 1) * WHEEL_ROW_HEIGHT;
		const clamp = (top: number) => Math.max(0, Math.min(max, top));
		const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
		let target = latestSelected.current * WHEEL_ROW_HEIGHT;
		let position = target;
		let frame = 0;
		let lastFrame = 0;
		let settleTimer = 0;
		let touching = false;
		let touchHeld = false;
		let lastHaptic = -Infinity;
		element.scrollTop = target;

		function publish(top: number) {
			const index = Math.round(clamp(top) / WHEEL_ROW_HEIGHT);
			if (values[index] === latestSelected.current) return;
			latestSelected.current = values[index];
			onSelectRef.current(values[index]);
			const now = performance.now();
			if (now - lastHaptic >= 40 && typeof navigator.vibrate === "function") {
				lastHaptic = now;
				try {
					navigator.vibrate(6);
				} catch {
					/* Optional device feedback. */
				}
			}
		}

		function stop() {
			cancelAnimationFrame(frame);
			frame = 0;
			window.clearTimeout(settleTimer);
			settleTimer = 0;
		}

		function tick(now: number) {
			const elapsed = Math.max(0, Math.min(64, now - lastFrame));
			lastFrame = now;
			position += (target - position) * (1 - Math.exp(-elapsed / 45));
			const settled = Math.abs(target - position) < 0.2;
			if (settled) position = target;
			element.scrollTop = position;
			publish(position);
			frame = settled ? 0 : requestAnimationFrame(tick);
		}

		function animate() {
			if (reducedMotion.matches) {
				position = target;
				element.scrollTop = position;
				publish(position);
				return;
			}
			if (!frame) {
				lastFrame = performance.now();
				frame = requestAnimationFrame(tick);
			}
		}

		function settle() {
			window.clearTimeout(settleTimer);
			settleTimer = 0;
			settleTimer = window.setTimeout(() => {
				settleTimer = 0;
				touching = false;
				target = Math.round(target / WHEEL_ROW_HEIGHT) * WHEEL_ROW_HEIGHT;
				animate();
			}, 120);
		}

		const controller: WheelMotion = {
			active: () =>
				Boolean(frame || settleTimer || touching || dragRef.current),
			choose(index) {
				touching = false;
				window.clearTimeout(settleTimer);
				settleTimer = 0;
				target = clamp(index * WHEEL_ROW_HEIGHT);
				animate();
			},
			jump(index) {
				stop();
				touching = false;
				latestSelected.current = values[index];
				position = target = clamp(index * WHEEL_ROW_HEIGHT);
				element.scrollTop = position;
			},
			begin() {
				stop();
				position = target = element.scrollTop;
			},
			drag(top) {
				position = target = clamp(top);
				element.scrollTop = position;
				publish(position);
			},
			finish() {
				touching = false;
				target =
					Math.round(element.scrollTop / WHEEL_ROW_HEIGHT) * WHEEL_ROW_HEIGHT;
				animate();
			},
		};
		motion.current = controller;

		function wheel(event: WheelEvent) {
			if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY))
				return;
			event.preventDefault();
			touching = false;
			const scale =
				event.deltaMode === 1
					? WHEEL_ROW_HEIGHT
					: event.deltaMode === 2
						? 180
						: 1;
			target = clamp(target + event.deltaY * scale);
			animate();
			settle();
		}
		function touchStart() {
			controller.begin();
			touching = true;
			touchHeld = true;
		}
		function scroll() {
			if (!touching) return;
			position = target = element.scrollTop;
			publish(position);
			if (!touchHeld) settle();
		}
		function touchEnd() {
			touchHeld = false;
			settle();
		}
		element.addEventListener("wheel", wheel, { passive: false });
		element.addEventListener("touchstart", touchStart, { passive: true });
		element.addEventListener("touchend", touchEnd, { passive: true });
		element.addEventListener("touchcancel", touchEnd, { passive: true });
		element.addEventListener("scroll", scroll, { passive: true });
		return () => {
			stop();
			motion.current = null;
			element.removeEventListener("wheel", wheel);
			element.removeEventListener("touchstart", touchStart);
			element.removeEventListener("touchend", touchEnd);
			element.removeEventListener("touchcancel", touchEnd);
			element.removeEventListener("scroll", scroll);
		};
	}, [values]);

	useEffect(() => {
		// Parent echoes of a moving selection must not interrupt the animation.
		if (!motion.current?.active() && latestSelected.current !== selected)
			motion.current?.jump(selected);
	}, [selected]);

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
					onKeyDown={(event) => {
						let next = latestSelected.current;
						if (event.key === "ArrowDown")
							next = Math.min(values.length - 1, next + 1);
						else if (event.key === "ArrowUp") next = Math.max(0, next - 1);
						else if (event.key === "Home") next = 0;
						else if (event.key === "End") next = values.length - 1;
						else return;
						event.preventDefault();
						motion.current?.choose(next);
						viewportRef.current
							?.querySelectorAll<HTMLButtonElement>("[role=option]")
							[next]?.focus({ preventScroll: true });
					}}
					onPointerDown={(event) => {
						if (event.pointerType !== "mouse" || event.button !== 0) return;
						motion.current?.begin();
						dragRef.current = {
							y: event.clientY,
							top: event.currentTarget.scrollTop,
							moved: false,
						};
						suppressClick.current = false;
					}}
					onPointerMove={(event) => {
						const drag = dragRef.current;
						if (!drag) return;
						const delta = event.clientY - drag.y;
						if (!drag.moved && Math.abs(delta) < 4) return;
						if (!drag.moved) {
							drag.moved = true;
							setDragging(true);
							event.currentTarget.setPointerCapture(event.pointerId);
						}
						motion.current?.drag(drag.top - delta);
					}}
					onPointerUp={() => {
						const drag = dragRef.current;
						if (!drag) return;
						suppressClick.current = drag.moved;
						dragRef.current = null;
						setDragging(false);
						if (drag.moved) motion.current?.finish();
					}}
					onLostPointerCapture={() => {
						if (!dragRef.current) return;
						dragRef.current = null;
						setDragging(false);
						motion.current?.finish();
					}}
					onPointerCancel={() => {
						if (!dragRef.current) return;
						dragRef.current = null;
						setDragging(false);
						motion.current?.finish();
					}}
					onClickCapture={(event) => {
						if (suppressClick.current) {
							event.preventDefault();
							event.stopPropagation();
							suppressClick.current = false;
						}
					}}
					className={cn(
						"h-[180px] cursor-grab touch-pan-y select-none overflow-y-auto overscroll-contain py-[72px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
						dragging && "cursor-grabbing",
					)}
				>
					{values.map((value) => (
						<button
							key={value}
							type="button"
							role="option"
							aria-selected={value === selected}
							tabIndex={value === selected ? 0 : -1}
							onClick={() => motion.current?.choose(value)}
							className={cn(
								"relative z-20 flex h-9 w-full items-center justify-center whitespace-nowrap px-2 text-sm tabular-nums transition-[color,opacity] duration-100",
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

function dateLabel(value: string, placeholder: string, locale = "ko-KR") {
	if (!value) return placeholder;
	const today = formatDayKey();
	const tomorrow = formatDayKey(addDays(new Date(), 1));
	const prefix =
		value === today
			? `${translate(resolveLocale(null, locale), "오늘")} · `
			: value === tomorrow
				? `${translate(resolveLocale(null, locale), "내일")} · `
				: "";
	return `${prefix}${new Intl.DateTimeFormat(locale, {
		month: "long",
		day: "numeric",
		weekday: "short",
	}).format(parseDay(value))}`;
}

export function DatePicker({
	value,
	onChange,
	label,
	placeholder = "날짜",
	min,
	allowClear = false,
	className,
	inline = false,
	disabled = false,
	triggerContent,
	variant = "outline",
}: {
	value: string;
	onChange: (value: string) => void;
	label: string;
	placeholder?: string;
	min?: string;
	allowClear?: boolean;
	className?: string;
	inline?: boolean;
	disabled?: boolean;
	triggerContent?: ReactNode;
	variant?: "outline" | "ghost";
}) {
	const { t, intlLocale } = useI18n();

	const [open, setOpen] = useState(false);
	const [cursor, setCursor] = useState(() => parseDay(value));

	useEffect(() => {
		if (open || inline) setCursor(parseDay(value));
	}, [open, inline, value]);

	const days = useMemo(() => {
		const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
		const start = addDays(first, -first.getDay());
		return Array.from({ length: 42 }, (_, index) => addDays(start, index));
	}, [cursor]);

	const calendar = (
		<>
			<div className="mb-3 flex items-center justify-between">
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					onClick={() => setCursor((current) => addMonths(current, -1))}
					disabled={disabled}
					aria-label={t("이전 달")}
				>
					<ChevronLeft />
				</Button>
				<p className="text-sm font-semibold">
					{new Intl.DateTimeFormat(intlLocale, {
						year: "numeric",
						month: "long",
					}).format(cursor)}
				</p>
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					onClick={() => setCursor((current) => addMonths(current, 1))}
					disabled={disabled}
					aria-label={t("다음 달")}
				>
					<ChevronRight />
				</Button>
			</div>
			<div className="mb-1 grid grid-cols-7 text-center text-[11px] font-medium text-muted-foreground">
				{Array.from({ length: 7 }, (_, index) =>
					weekdayName(index, intlLocale),
				).map((day) => (
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
					const dayDisabled = disabled || Boolean(min && key < min);
					return (
						<button
							key={key}
							type="button"
							disabled={dayDisabled}
							aria-label={key}
							aria-pressed={selected}
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
								dayDisabled &&
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
						disabled={disabled}
						onClick={() => {
							onChange("");
							setOpen(false);
						}}
					>
						{t("날짜 없음")}
					</Button>
				) : (
					<span />
				)}
				<Button
					type="button"
					variant="ghost"
					size="sm"
					disabled={disabled || Boolean(min && formatDayKey() < min)}
					onClick={() => {
						onChange(formatDayKey());
						setOpen(false);
					}}
				>
					{t("오늘")}
				</Button>
			</div>
		</>
	);
	if (inline)
		return (
			<section
				aria-label={label}
				className={cn("rounded-xl border bg-background p-3", className)}
			>
				{calendar}
			</section>
		);

	return (
		<PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
			<PopoverPrimitive.Trigger asChild>
				<Button
					type="button"
					variant={variant}
					disabled={disabled}
					aria-label={label}
					className={cn(
						"w-56 min-w-0 justify-start gap-2 font-normal tabular-nums",
						!value && "text-muted-foreground",
						className,
					)}
				>
					<CalendarDays className="size-4" />
					<span className="truncate">
						{triggerContent ?? dateLabel(value, t(placeholder), intlLocale)}
					</span>
				</Button>
			</PopoverPrimitive.Trigger>
			<PopoverPrimitive.Portal>
				<PopoverPrimitive.Content
					align="start"
					sideOffset={6}
					className="z-[60] w-72 rounded-xl border bg-popover p-3 text-popover-foreground shadow-xl outline-none"
				>
					{calendar}
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
	disabled = false,
	className,
}: {
	value: string;
	onChange: (value: string) => void;
	label: string;
	placeholder?: string;
	allowEmpty?: boolean;
	disabled?: boolean;
	className?: string;
}) {
	const { t, intlLocale } = useI18n();

	const [open, setOpen] = useState(false);
	const { hour, minute } = parseTime(value);
	const currentTime = useRef({ hour, minute });

	return (
		<PopoverPrimitive.Root
			open={open}
			onOpenChange={(nextOpen) => {
				if (nextOpen) currentTime.current = parseTime(value);
				setOpen(nextOpen);
			}}
		>
			<PopoverPrimitive.Trigger asChild>
				<Button
					type="button"
					variant="outline"
					aria-label={label}
					disabled={disabled}
					className={cn(
						"w-[9.5rem] min-w-0 shrink-0 justify-start gap-2 font-normal tabular-nums",
						!value && "text-muted-foreground",
						className,
					)}
				>
					<Clock3 className="size-4" />
					<span className="min-w-0 flex-1 truncate text-left">
						{value ? timeLabel(value, intlLocale) : t(placeholder)}
					</span>
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
						<p className="w-32 shrink-0 text-right text-sm font-semibold tabular-nums">
							{timeLabel(timeValue(hour, minute), intlLocale)}
						</p>
					</div>
					<div className="grid grid-cols-[1.5fr_1fr] gap-2">
						<TimeWheel
							label={t("시")}
							values={HOURS}
							selected={hour}
							onSelect={(next) => {
								currentTime.current.hour = next;
								onChange(timeValue(next, currentTime.current.minute));
							}}
							format={(value) => hourLabel(value, intlLocale)}
						/>
						<TimeWheel
							label={t("분")}
							values={MINUTES}
							selected={minute}
							onSelect={(next) => {
								currentTime.current.minute = next;
								onChange(timeValue(currentTime.current.hour, next));
							}}
							format={(nextMinute) =>
								t("{0}분", [String(nextMinute).padStart(2, "0")])
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
								{t("시간 없음")}
							</Button>
						) : (
							<span />
						)}
						<Button
							type="button"
							size="sm"
							onClick={() => {
								onChange(
									timeValue(
										currentTime.current.hour,
										currentTime.current.minute,
									),
								);
								setOpen(false);
							}}
						>
							{t("완료")}
						</Button>
					</div>
				</PopoverPrimitive.Content>
			</PopoverPrimitive.Portal>
		</PopoverPrimitive.Root>
	);
}
