import { Link, useRouterState } from "@tanstack/react-router";
import {
	Archive,
	BookOpen,
	CalendarCheck,
	CalendarDays,
	FolderKanban,
	Layers,
	ListTodo,
	LogOut,
	Mail,
} from "lucide-react";
import { useEffect } from "react";
import { logoutOrbit } from "#/lib/orbit/auth";
import { ARCHIVE_SPACE, PARA_SPACES } from "#/lib/orbit/para";
import { ModeToggle } from "@/components/mode-toggle";
import { SettingsDialog } from "@/components/settings-dialog";
import { Button } from "@/components/ui/button";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	useSidebar,
} from "@/components/ui/sidebar";

const paraIcons = {
	project: FolderKanban,
	area: Layers,
	resource: BookOpen,
};

function startsWithPath(pathname: string, href: string) {
	return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppSidebar() {
	const { setOpenMobile } = useSidebar();
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});
	useEffect(() => {
		if (!pathname) return;
		setOpenMobile(false);
	}, [pathname, setOpenMobile]);

	async function logout() {
		if ("serviceWorker" in navigator) {
			try {
				const subscription = await (
					await navigator.serviceWorker.getRegistration("/")
				)?.pushManager?.getSubscription();
				if (subscription) {
					const { mailApi } = await import("#/lib/mail/client");
					await mailApi("push/unsubscribe", {
						endpoint: subscription.endpoint,
					});
					await subscription.unsubscribe();
				}
			} catch {
				/* Logout remains available when push services are offline. */
			}
		}
		await logoutOrbit();
		window.location.replace("/login");
	}

	return (
		<Sidebar variant="inset" collapsible="icon">
			<SidebarHeader>
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton
							size="lg"
							asChild
							tooltip="Orbit"
							className="transition-colors duration-150"
						>
							<Link to="/" preload="render">
								<div className="flex aspect-square size-8 items-center justify-center overflow-hidden rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
									<img
										src="/orbit.png"
										alt=""
										width={32}
										height={32}
										className="size-8"
									/>
								</div>
								<div className="grid flex-1 text-left text-sm leading-tight">
									<span className="truncate font-semibold">Orbit</span>
									<span className="truncate text-xs text-muted-foreground">
										Markdown notes
									</span>
								</div>
							</Link>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarHeader>

			<SidebarContent>
				<SidebarGroup>
					<SidebarGroupLabel>Workspace</SidebarGroupLabel>
					<SidebarMenu>
						<SidebarMenuItem>
							<SidebarMenuButton
								asChild
								isActive={pathname === "/"}
								tooltip="Today"
							>
								<Link to="/" preload="render">
									<CalendarCheck />
									<span>Today</span>
								</Link>
							</SidebarMenuButton>
						</SidebarMenuItem>
						<SidebarMenuItem>
							<SidebarMenuButton
								asChild
								isActive={pathname === "/tasks"}
								tooltip="Tasks"
							>
								<Link to="/tasks" preload="render">
									<ListTodo />
									<span>Tasks</span>
								</Link>
							</SidebarMenuButton>
						</SidebarMenuItem>
						<SidebarMenuItem>
							<SidebarMenuButton
								asChild
								isActive={startsWithPath(pathname, "/calendar")}
								tooltip="Calendar"
							>
								<Link to="/calendar" preload="render">
									<CalendarDays />
									<span>Calendar</span>
								</Link>
							</SidebarMenuButton>
						</SidebarMenuItem>
						<SidebarMenuItem>
							<SidebarMenuButton
								asChild
								isActive={pathname === "/mail"}
								tooltip="Mail"
							>
								<Link to="/mail">
									<Mail />
									<span>Mail</span>
								</Link>
							</SidebarMenuButton>
						</SidebarMenuItem>
					</SidebarMenu>
				</SidebarGroup>

				<SidebarGroup>
					<SidebarGroupLabel>PARA</SidebarGroupLabel>
					<SidebarMenu>
						{PARA_SPACES.map((space) => {
							const Icon = paraIcons[space.id];
							return (
								<SidebarMenuItem key={space.id}>
									<SidebarMenuButton
										asChild
										isActive={startsWithPath(pathname, space.href)}
										tooltip={space.label}
									>
										<Link to={space.href} preload="render">
											<Icon />
											<span>{space.label}</span>
										</Link>
									</SidebarMenuButton>
								</SidebarMenuItem>
							);
						})}
						<SidebarMenuItem>
							<SidebarMenuButton
								asChild
								isActive={startsWithPath(pathname, "/archive")}
								tooltip="Archive"
							>
								<Link to="/archive" preload="render">
									<Archive />
									<span>{ARCHIVE_SPACE.label}</span>
								</Link>
							</SidebarMenuButton>
						</SidebarMenuItem>
					</SidebarMenu>
				</SidebarGroup>
			</SidebarContent>

			<SidebarFooter className="border-t border-sidebar-border/70">
				<div className="flex items-center justify-end px-1 group-data-[collapsible=icon]:justify-center">
					<div className="flex items-center gap-0.5">
						<SettingsDialog />
						<Button
							variant="ghost"
							size="icon"
							className="size-8 text-muted-foreground"
							title="로그아웃"
							onClick={() => void logout()}
						>
							<LogOut className="size-4" />
							<span className="sr-only">로그아웃</span>
						</Button>
						<ModeToggle />
					</div>
				</div>
			</SidebarFooter>
		</Sidebar>
	);
}
