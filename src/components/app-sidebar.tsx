import {
	Link,
	useNavigate,
	useRouter,
	useRouterState,
} from "@tanstack/react-router";
import {
	Archive,
	BookOpen,
	CalendarCheck,
	CalendarDays,
	FolderKanban,
	Inbox,
	Layers,
	ListTodo,
	LogOut,
} from "lucide-react";
import { useEffect } from "react";
import { logoutOrbit } from "#/lib/orbit/auth";
import { mutateOrbit } from "#/lib/orbit/functions";
import { ARCHIVE_SPACE, PARA_SPACES } from "#/lib/orbit/para";
import type { OrbitSnapshot, OrbitSpace } from "#/lib/orbit/schema";
import { ItemContextMenu } from "@/components/item-context-menu";
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
	SidebarMenuBadge,
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

export function AppSidebar({ snapshot }: { snapshot: OrbitSnapshot }) {
	const { setOpenMobile } = useSidebar();
	const navigate = useNavigate();
	const router = useRouter();
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});
	useEffect(() => {
		if (!pathname) return;
		setOpenMobile(false);
	}, [pathname, setOpenMobile]);

	async function createNote(space: OrbitSpace, folder?: string, href?: string) {
		await mutateOrbit({
			data: {
				action: "create-item",
				input: { title: "새 노트", type: "note", body: "", space, folder },
			},
		});
		await router.invalidate();
		if (folder) {
			const spaceMeta = PARA_SPACES.find((item) => item.space === space);
			if (spaceMeta?.folderHref) {
				await navigate({
					to: spaceMeta.folderHref,
					params: { folder },
				});
				return;
			}
		}
		if (href) await navigate({ to: href });
	}

	async function logout() {
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
							<Link to="/inbox">
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
					<SidebarGroupLabel>Notes</SidebarGroupLabel>
					<SidebarMenu>
						<ItemContextMenu
							createLabel="노트 추가"
							onCreate={() => void createNote("inbox", undefined, "/inbox")}
							onOpen={() => void navigate({ to: "/inbox" })}
						>
							<SidebarMenuItem>
								<SidebarMenuButton
									asChild
									isActive={pathname === "/inbox"}
									tooltip="Inbox"
									className="font-medium"
								>
									<Link to="/inbox">
										<Inbox />
										<span>Inbox</span>
									</Link>
								</SidebarMenuButton>
								{snapshot.counts.inbox > 0 ? (
									<SidebarMenuBadge>{snapshot.counts.inbox}</SidebarMenuBadge>
								) : null}
							</SidebarMenuItem>
						</ItemContextMenu>
					</SidebarMenu>
				</SidebarGroup>

				<SidebarGroup>
					<SidebarGroupLabel>Plan</SidebarGroupLabel>
					<SidebarMenu>
						<SidebarMenuItem>
							<SidebarMenuButton
								asChild
								isActive={pathname === "/"}
								tooltip="Today"
							>
								<Link to="/">
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
								<Link to="/tasks">
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
								<Link to="/calendar">
									<CalendarDays />
									<span>Calendar</span>
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
										<Link to={space.href}>
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
								<Link to="/archive">
									<Archive />
									<span>{ARCHIVE_SPACE.label}</span>
								</Link>
							</SidebarMenuButton>
						</SidebarMenuItem>
					</SidebarMenu>
				</SidebarGroup>
			</SidebarContent>

			<SidebarFooter className="border-t border-sidebar-border/70">
				<div className="flex items-center justify-between px-1 group-data-[collapsible=icon]:justify-center">
					<div className="flex items-center gap-2 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
						<span className="size-1.5 rounded-full bg-emerald-500" />
						Local files
					</div>
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
