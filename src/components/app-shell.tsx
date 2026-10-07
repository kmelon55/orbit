import { Link, useRouterState } from "@tanstack/react-router";
import { ListTodo, Mail } from "lucide-react";
import type { ReactNode } from "react";
import type { OrbitSnapshot } from "#/lib/orbit/schema";
import { AppSidebar } from "@/components/app-sidebar";
import { GlobalSearch } from "@/components/global-search";
import { useI18n } from "@/components/locale-provider";
import { MobileNavigation } from "@/components/mobile-navigation";
import { Button } from "@/components/ui/button";
import {
	SidebarInset,
	SidebarProvider,
	SidebarTrigger,
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";

function pageTitle(pathname: string, t: (message: string) => string) {
	if (pathname === "/") return t("Today");
	if (pathname === "/inbox") return t("Inbox");
	if (pathname === "/mail") return t("Mail");
	if (pathname === "/capture") return t("빠른 기록");
	if (pathname === "/tasks") return t("Tasks");
	if (pathname === "/routines") return t("Routines");
	if (pathname.startsWith("/calendar")) return t("Calendar");
	if (pathname === "/archive") return t("Archive");
	if (pathname.startsWith("/whiteboards")) return t("Whiteboards");
	if (pathname.startsWith("/projects/")) {
		return decodeURIComponent(pathname.slice("/projects/".length));
	}
	if (pathname === "/projects") return t("Projects");
	if (pathname.startsWith("/areas/")) {
		return decodeURIComponent(pathname.slice("/areas/".length));
	}
	if (pathname === "/areas") return t("Areas");
	if (pathname.startsWith("/resources/")) {
		return decodeURIComponent(pathname.slice("/resources/".length));
	}
	if (pathname === "/resources") return t("Resources");
	return "Orbit";
}

export function AppShell({
	children,
	snapshot,
}: {
	children: ReactNode;
	snapshot: OrbitSnapshot;
}) {
	const { t } = useI18n();

	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});

	return (
		<TooltipProvider delayDuration={0}>
			<SidebarProvider className="h-svh min-h-0 overflow-hidden bg-sidebar">
				<AppSidebar />
				<SidebarInset className="min-h-0 overflow-hidden border-border/70 bg-background md:border md:shadow-sm">
					<header className="orbit-mobile-header flex h-12 shrink-0 items-center gap-3 border-b border-border/60 bg-background/90 px-4 backdrop-blur-xl">
						<SidebarTrigger className="-ml-1 text-muted-foreground" />
						<div className="hidden h-4 w-px bg-border/80 sm:block" />
						<div className="flex min-w-0 items-center gap-2 text-sm">
							<span className="hidden text-muted-foreground md:inline">
								Orbit
							</span>
							<span className="hidden text-muted-foreground md:inline">/</span>
							<h1 className="truncate font-medium">{pageTitle(pathname, t)}</h1>
						</div>
						<nav
							aria-label={t("빠른 이동")}
							className="ml-auto flex shrink-0 items-center gap-1"
						>
							<GlobalSearch snapshot={snapshot} />
							<Button
								asChild
								variant={pathname === "/mail" ? "secondary" : "ghost"}
								size="sm"
							>
								<Link
									to="/mail"
									aria-current={pathname === "/mail" ? "page" : undefined}
								>
									<Mail /> {t("메일")}
								</Link>
							</Button>
							<Button
								asChild
								variant={pathname === "/tasks" ? "secondary" : "ghost"}
								size="sm"
								className="hidden md:inline-flex"
							>
								<Link
									to="/tasks"
									aria-current={pathname === "/tasks" ? "page" : undefined}
								>
									<ListTodo /> {t("할 일")}
								</Link>
							</Button>
						</nav>
					</header>
					<div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
						{children}
					</div>
					<MobileNavigation />
				</SidebarInset>
			</SidebarProvider>
		</TooltipProvider>
	);
}
