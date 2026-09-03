import { Link, useRouterState } from "@tanstack/react-router";
import {
	CalendarDays,
	CalendarRange,
	Inbox,
	ListTodo,
	Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
	{ to: "/", label: "Today", icon: CalendarDays, primary: false },
	{ to: "/inbox", label: "Inbox", icon: Inbox, primary: false },
	{ to: "/capture", label: "기록", icon: Plus, primary: true },
	{ to: "/tasks", label: "할 일", icon: ListTodo, primary: false },
	{ to: "/calendar", label: "캘린더", icon: CalendarRange, primary: false },
] as const;

export function MobileNavigation() {
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});

	return (
		<nav
			aria-label="모바일 주요 메뉴"
			className="orbit-mobile-nav shrink-0 border-t border-border/70 bg-background/95 px-2 pt-1.5 backdrop-blur-xl md:hidden"
		>
			<div className="grid grid-cols-5 items-end">
				{items.map(({ to, label, icon: Icon, primary }) => {
					const active =
						to === "/"
							? pathname === "/"
							: pathname === to || pathname.startsWith(`${to}/`);
					return (
						<Link
							key={to}
							to={to}
							aria-current={active ? "page" : undefined}
							className={cn(
								"flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-xl text-[10px] font-medium text-muted-foreground transition-colors",
								active && !primary && "text-foreground",
								primary && "relative -mt-5 text-foreground",
							)}
						>
							<span
								className={cn(
									"grid size-7 place-items-center rounded-lg",
									active && !primary && "bg-accent",
									primary &&
										"size-11 rounded-2xl bg-foreground text-background shadow-lg shadow-foreground/15",
								)}
							>
								<Icon className={primary ? "size-5" : "size-[1.15rem]"} />
							</span>
							<span>{label}</span>
						</Link>
					);
				})}
			</div>
		</nav>
	);
}
