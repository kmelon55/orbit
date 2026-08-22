import { Link } from "@tanstack/react-router";
import { CalendarCheck, FileText } from "lucide-react";
import type { ReactNode } from "react";
import { ModeToggle } from "@/components/mode-toggle";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const navigation = [
	{ to: "/" as const, label: "Today", icon: CalendarCheck, exact: true },
	{ to: "/notes" as const, label: "Notes", icon: FileText, exact: false },
];

export function AppShell({ children }: { children: ReactNode }) {
	return (
		<div className="min-h-svh bg-background text-foreground md:grid md:grid-cols-[220px_minmax(0,1fr)]">
			<aside className="sticky top-0 hidden h-svh flex-col border-r border-sidebar-border bg-sidebar p-3 md:flex">
				<Link to="/" className="mb-5 flex h-10 items-center gap-2.5 px-2">
					<span className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground">
						<span className="size-2 rounded-full border-2 border-current" />
					</span>
					<span className="text-sm font-semibold tracking-tight">Orbit</span>
				</Link>
				<nav className="space-y-1" aria-label="주요 메뉴">
					{navigation.map((item) => {
						const Icon = item.icon;
						return (
							<Link
								key={item.to}
								to={item.to}
								activeOptions={{ exact: item.exact }}
								className={cn(
									buttonVariants({ variant: "ghost" }),
									"w-full justify-start text-muted-foreground",
								)}
								activeProps={{
									className: cn(
										buttonVariants({ variant: "secondary" }),
										"w-full justify-start text-foreground",
									),
								}}
							>
								<Icon />
								{item.label}
							</Link>
						);
					})}
				</nav>
				<div className="mt-auto flex items-center justify-between border-t border-sidebar-border px-2 pt-3">
					<div className="flex items-center gap-2 text-xs text-muted-foreground">
						<span className="size-1.5 rounded-full bg-emerald-500" />
						Local files
					</div>
					<ModeToggle />
				</div>
			</aside>

			<div className="min-w-0">
				<header className="sticky top-0 z-20 flex h-14 items-center border-b bg-background/90 px-4 backdrop-blur md:hidden">
					<Link
						to="/"
						className="mr-auto flex items-center gap-2 text-sm font-semibold"
					>
						<span className="grid size-6 place-items-center rounded-md bg-primary text-primary-foreground">
							<span className="size-1.5 rounded-full border border-current" />
						</span>
						Orbit
					</Link>
					<nav className="mr-1 flex items-center">
						{navigation.map((item) => (
							<Link
								key={item.to}
								to={item.to}
								activeOptions={{ exact: item.exact }}
								className="rounded-md px-2.5 py-1.5 text-xs text-muted-foreground"
								activeProps={{ className: "bg-muted text-foreground" }}
							>
								{item.label}
							</Link>
						))}
					</nav>
					<ModeToggle />
				</header>
				{children}
			</div>
		</div>
	);
}
