import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import {
	CalendarDays,
	CalendarRange,
	FileText,
	Inbox,
	ListTodo,
	Plus,
} from "lucide-react";
import { type PointerEvent, useRef, useState } from "react";
import type { OrbitItemType } from "#/lib/orbit/schema";
import { QuickCapture } from "@/components/quick-capture";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const items = [
	{ to: "/", label: "Today", icon: CalendarDays },
	{ to: "/inbox", label: "Inbox", icon: Inbox },
	{ to: "/tasks", label: "할 일", icon: ListTodo },
	{ to: "/calendar", label: "캘린더", icon: CalendarRange },
] as const;

type QuickKind = Extract<OrbitItemType, "note" | "task" | "event">;
type QuickSelection = QuickKind | "cancel";

const QUICK_KINDS: {
	type: QuickKind;
	label: string;
	icon: typeof FileText;
	path: string;
	labelPosition: string;
}[] = [
	{
		type: "task",
		label: "할 일",
		icon: ListTodo,
		path: "M131 115 L80 33 A140 135 0 0 0 10 150 L112 150 A38 40 0 0 1 131 115 Z",
		labelPosition: "left-[24%] top-[57%]",
	},
	{
		type: "note",
		label: "노트",
		icon: FileText,
		path: "M169 115 L220 33 A140 135 0 0 0 80 33 L131 115 A38 40 0 0 1 169 115 Z",
		labelPosition: "left-1/2 top-[25%]",
	},
	{
		type: "event",
		label: "일정",
		icon: CalendarDays,
		path: "M188 150 L290 150 A140 135 0 0 0 220 33 L169 115 A38 40 0 0 1 188 150 Z",
		labelPosition: "left-[76%] top-[57%]",
	},
];

export function MobileNavigation() {
	const router = useRouter();
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});
	const [composerOpen, setComposerOpen] = useState(false);
	const [composerKind, setComposerKind] = useState<QuickKind>("note");
	const [radialOpen, setRadialOpen] = useState(false);
	const [selectedKind, setSelectedKind] = useState<QuickSelection | null>(null);
	const radialOpenRef = useRef(false);
	const selectedKindRef = useRef<QuickSelection | null>(null);
	const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const gestureStartRef = useRef({ x: 0, y: 0 });

	function openComposer(kind: QuickKind) {
		setComposerKind(kind);
		setComposerOpen(true);
	}

	function clearHoldTimer() {
		if (!holdTimerRef.current) return;
		clearTimeout(holdTimerRef.current);
		holdTimerRef.current = null;
	}

	function closeRadial() {
		radialOpenRef.current = false;
		selectedKindRef.current = null;
		setRadialOpen(false);
		setSelectedKind(null);
	}

	function kindAtPointer(event: PointerEvent<HTMLButtonElement>) {
		const dx = event.clientX - gestureStartRef.current.x;
		const upward = gestureStartRef.current.y - event.clientY;
		const distance = Math.hypot(dx, upward);
		if (distance <= 70) return "cancel";
		if (distance > 260) return null;
		if (upward < 16) return null;
		const angle = (Math.atan2(upward, dx) * 180) / Math.PI;
		if (angle >= 120) return "task";
		if (angle <= 60) return "event";
		return "note";
	}

	function onQuickPointerDown(event: PointerEvent<HTMLButtonElement>) {
		if (event.pointerType === "mouse" && event.button !== 0) return;
		event.currentTarget.setPointerCapture(event.pointerId);
		gestureStartRef.current = { x: event.clientX, y: event.clientY };
		clearHoldTimer();
		holdTimerRef.current = setTimeout(() => {
			radialOpenRef.current = true;
			selectedKindRef.current = "cancel";
			setRadialOpen(true);
			setSelectedKind("cancel");
			if (typeof navigator.vibrate === "function") navigator.vibrate(12);
		}, 280);
	}

	function onQuickPointerMove(event: PointerEvent<HTMLButtonElement>) {
		if (!radialOpenRef.current) return;
		const next = kindAtPointer(event);
		if (next === selectedKindRef.current) return;
		selectedKindRef.current = next;
		setSelectedKind(next);
		if (next && typeof navigator.vibrate === "function") navigator.vibrate(8);
	}

	function onQuickPointerUp(event: PointerEvent<HTMLButtonElement>) {
		clearHoldTimer();
		const distance = Math.hypot(
			event.clientX - gestureStartRef.current.x,
			event.clientY - gestureStartRef.current.y,
		);
		if (radialOpenRef.current) {
			const kind = selectedKindRef.current;
			closeRadial();
			if (kind && kind !== "cancel") openComposer(kind);
			return;
		}
		if (distance < 14) openComposer("note");
	}

	function NavLink({ to, label, icon: Icon }: (typeof items)[number]) {
		const active =
			to === "/"
				? pathname === "/"
				: pathname === to || pathname.startsWith(`${to}/`);
		return (
			<Link
				to={to}
				aria-current={active ? "page" : undefined}
				className={cn(
					"flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-xl text-[10px] font-medium text-muted-foreground transition-colors",
					active && "text-foreground",
				)}
			>
				<span
					className={cn(
						"grid size-7 place-items-center rounded-lg",
						active && "bg-accent",
					)}
				>
					<Icon className="size-[1.15rem]" />
				</span>
				<span>{label}</span>
			</Link>
		);
	}

	return (
		<>
			{radialOpen ? (
				<div
					className="pointer-events-none fixed inset-0 z-[60] bg-background/60 backdrop-blur-[1px] md:hidden"
					aria-hidden="true"
				>
					<div className="fixed bottom-[calc(max(.35rem,env(safe-area-inset-bottom))+3.45rem)] left-1/2 aspect-[15/8] w-[20rem] max-w-[calc(100vw-1.5rem)] -translate-x-1/2 animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-5 duration-150">
						<svg
							viewBox="0 0 300 160"
							className="absolute inset-0 size-full overflow-visible drop-shadow-[0_12px_24px_rgba(0,0,0,0.12)]"
							role="presentation"
						>
							{QUICK_KINDS.map(({ type, path }) => (
								<path
									key={type}
									d={path}
									className="fill-popover stroke-border stroke-[1.5]"
								/>
							))}
						</svg>
						{QUICK_KINDS.map(({ type, label, icon: Icon, labelPosition }) => (
							<div
								key={type}
								className={cn(
									"absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 text-muted-foreground transition-[transform,color] duration-100",
									labelPosition,
									selectedKind === type && "scale-110 text-foreground",
								)}
							>
								<Icon
									className="size-[1.15rem]"
									strokeWidth={selectedKind === type ? 2.35 : 1.8}
								/>
								<span
									className={cn(
										"text-[11px] font-medium",
										selectedKind === type && "font-semibold",
									)}
								>
									{label}
								</span>
							</div>
						))}
					</div>
				</div>
			) : null}

			<nav
				aria-label="모바일 주요 메뉴"
				className={cn(
					"orbit-mobile-nav relative shrink-0 border-t border-border/70 bg-background/95 px-2 pt-1.5 backdrop-blur-xl md:hidden",
					radialOpen ? "z-[70]" : "z-40",
				)}
			>
				<div className="grid grid-cols-5 items-end">
					<NavLink {...items[0]} />
					<NavLink {...items[1]} />

					<button
						type="button"
						className="relative -mt-5 flex min-h-12 touch-none select-none flex-col items-center justify-center gap-0.5 rounded-xl text-[10px] font-medium text-foreground"
						onPointerDown={onQuickPointerDown}
						onPointerMove={onQuickPointerMove}
						onPointerUp={onQuickPointerUp}
						onPointerCancel={() => {
							clearHoldTimer();
							closeRadial();
						}}
						onContextMenu={(event) => event.preventDefault()}
						onKeyDown={(event) => {
							if (event.key === "Enter" || event.key === " ") {
								event.preventDefault();
								openComposer("note");
							}
						}}
						aria-label="새 노트. 길게 누른 채 움직여 기록 종류 선택"
						aria-expanded={radialOpen}
					>
						<span
							className={cn(
								"grid size-12 place-items-center rounded-2xl bg-foreground text-background shadow-lg shadow-foreground/15 transition-[background-color,color,box-shadow] duration-200 ease-out",
								radialOpen &&
									"bg-muted text-muted-foreground shadow-sm shadow-transparent",
							)}
						>
							<Plus
								className={cn(
									"size-5 transition-transform duration-200 ease-out",
									radialOpen && "rotate-45",
								)}
							/>
						</span>
						<span>{radialOpen ? "취소" : "새로 만들기"}</span>
					</button>

					<NavLink {...items[2]} />
					<NavLink {...items[3]} />
				</div>
			</nav>

			<Sheet open={composerOpen} onOpenChange={setComposerOpen}>
				<SheetContent
					side="bottom"
					className="max-h-[88svh] overflow-y-auto rounded-t-[1.5rem] px-3 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]"
				>
					<div className="mx-auto h-1 w-10 rounded-full bg-muted-foreground/25" />
					<SheetHeader className="px-1 pt-1 pb-0">
						<SheetTitle>
							{composerKind === "note"
								? "새 노트"
								: composerKind === "task"
									? "새 할 일"
									: "새 일정"}
						</SheetTitle>
						<SheetDescription>
							바로 입력하거나 마이크를 눌러 말하세요.
						</SheetDescription>
					</SheetHeader>
					<QuickCapture
						key={`${composerKind}:${composerOpen}`}
						initialKind={composerKind}
						autoFocus
						placeholder={
							composerKind === "note"
								? "무엇을 기억할까요?"
								: composerKind === "task"
									? "무엇을 해야 하나요?"
									: "무슨 일정인가요?"
						}
						className="border-0 bg-transparent p-0 shadow-none"
						onSaved={() => {
							setComposerOpen(false);
							void router.invalidate();
						}}
					/>
				</SheetContent>
			</Sheet>
		</>
	);
}
