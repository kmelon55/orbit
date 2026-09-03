import { useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { OrbitSnapshot } from "#/lib/orbit/schema";
import { AppSidebar } from "@/components/app-sidebar";
import { MobileNavigation } from "@/components/mobile-navigation";
import {
	SidebarInset,
	SidebarProvider,
	SidebarTrigger,
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";

function pageTitle(pathname: string) {
	if (pathname === "/") return "Today";
	if (pathname === "/inbox") return "Inbox";
	if (pathname === "/capture") return "빠른 기록";
	if (pathname === "/tasks") return "Tasks";
	if (pathname.startsWith("/calendar")) return "Calendar";
	if (pathname === "/archive") return "Archive";
	if (pathname.startsWith("/whiteboards")) return "Whiteboards";
	if (pathname.startsWith("/projects/")) {
		return decodeURIComponent(pathname.slice("/projects/".length));
	}
	if (pathname === "/projects") return "Projects";
	if (pathname.startsWith("/areas/")) {
		return decodeURIComponent(pathname.slice("/areas/".length));
	}
	if (pathname === "/areas") return "Areas";
	if (pathname.startsWith("/resources/")) {
		return decodeURIComponent(pathname.slice("/resources/".length));
	}
	if (pathname === "/resources") return "Resources";
	return "Orbit";
}

export function AppShell({
	children,
	snapshot,
}: {
	children: ReactNode;
	snapshot: OrbitSnapshot;
}) {
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});

	return (
		<TooltipProvider delayDuration={0}>
			<SidebarProvider className="h-svh min-h-0 overflow-hidden bg-sidebar">
				<AppSidebar snapshot={snapshot} />
				<SidebarInset className="min-h-0 overflow-hidden border-border/70 bg-background md:border md:shadow-sm">
					<header className="orbit-mobile-header flex h-12 shrink-0 items-center gap-3 border-b border-border/60 bg-background/90 px-4 backdrop-blur-xl">
						<SidebarTrigger className="-ml-1 text-muted-foreground" />
						<div className="hidden h-4 w-px bg-border/80 sm:block" />
						<div className="flex min-w-0 items-center gap-2 text-sm">
							<span className="hidden text-muted-foreground md:inline">
								Orbit
							</span>
							<span className="hidden text-muted-foreground md:inline">/</span>
							<h1 className="truncate font-medium">{pageTitle(pathname)}</h1>
						</div>
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
