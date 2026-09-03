import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import {
	ArrowRight,
	CalendarDays,
	Circle,
	FolderClosed,
	FolderKanban,
	ListTodo,
	Plus,
} from "lucide-react";
import { useEffect, useState } from "react";
import { mutateOrbit } from "#/lib/orbit/functions";
import { folderOf, formatDayKey } from "#/lib/orbit/para";
import type { OrbitItem, OrbitSpace } from "#/lib/orbit/schema";
import {
	ConfirmItemDialog,
	type ItemConfirmAction,
	ItemContextMenu,
} from "@/components/item-context-menu";
import { QuickCapture } from "@/components/quick-capture";
import { ScheduleEditor } from "@/components/schedule-editor";
import {
	TaskCheck,
	TaskEmpty,
	TaskExit,
	taskTitleClass,
} from "@/components/task-check";
import { Button } from "@/components/ui/button";
import { useTaskToggle } from "@/hooks/use-task-toggle";
import { cn } from "@/lib/utils";
import { useOrbitSnapshot } from "./__root";

export const Route = createFileRoute("/")({
	component: TodayPage,
});

function formatTime(value?: string) {
	if (!value) return "종일";
	return value.match(/T(\d{2}:\d{2})/)?.[1] ?? "종일";
}

function TodayPage() {
	const snapshot = useOrbitSnapshot();
	const router = useRouter();
	const [editor, setEditor] = useState<{
		open: boolean;
		kind: "task" | "event";
		item?: OrbitItem;
	}>({ open: false, kind: "task" });
	const [confirm, setConfirm] = useState<ItemConfirmAction | null>(null);
	const taskToggle = useTaskToggle();
	useEffect(() => {
		taskToggle.sync(snapshot.items);
	}, [snapshot.items, taskToggle.sync]);
	const todayKey = formatDayKey();
	const todayTasks = snapshot.items.filter((item) => {
		if (item.type !== "task") return false;
		const due = (item.due ?? item.start)?.slice(0, 10);
		const onToday =
			due === todayKey ||
			snapshot.today.tasks.some((task) => task.id === item.id);
		return onToday && taskToggle.keepInOpenList(item);
	});
	async function archiveItem(item: OrbitItem) {
		await mutateOrbit({ data: { action: "archive-item", id: item.id } });
		await router.invalidate();
	}

	async function deleteItem(item: OrbitItem) {
		await mutateOrbit({ data: { action: "delete-item", id: item.id } });
		await router.invalidate();
	}

	async function moveItem(item: OrbitItem, space: OrbitSpace, folder?: string) {
		await mutateOrbit({
			data: {
				action: "file-item",
				id: item.id,
				input: { space, folder },
			},
		});
		await router.invalidate();
	}

	return (
		<div className="h-full overflow-auto bg-muted/20">
			<div className="mx-auto w-full max-w-6xl px-4 py-4 sm:px-5 sm:py-6 lg:px-8">
				<header className="mb-5 flex flex-wrap items-end justify-between gap-4 sm:mb-6">
					<div>
						<p className="text-xs font-medium text-muted-foreground">
							{snapshot.displayDate.longLabel}
						</p>
						<h2 className="mt-1 text-2xl font-semibold tracking-tight">
							Today
						</h2>
					</div>
					<div className="hidden items-center gap-2 sm:flex">
						<Button
							variant="outline"
							onClick={() => setEditor({ open: true, kind: "task" })}
						>
							<Plus /> 할 일
						</Button>
						<Button onClick={() => setEditor({ open: true, kind: "event" })}>
							<Plus /> 일정
						</Button>
					</div>
				</header>

				<div className="mb-5 sm:mb-8">
					<QuickCapture onSaved={() => void router.invalidate()} />
				</div>

				<div className="grid gap-4 lg:grid-cols-2">
					<section className="orbit-card overflow-hidden">
						<div className="flex items-center justify-between border-b border-border/60 px-4 py-3.5">
							<div className="flex items-center gap-2">
								<ListTodo className="size-4" />
								<h3 className="text-sm font-semibold">오늘 할 일</h3>
								<span className="text-xs tabular-nums text-muted-foreground">
									{todayTasks.length}
								</span>
							</div>
							<Link
								to="/tasks"
								className="text-xs text-muted-foreground hover:text-foreground"
							>
								전체 보기
							</Link>
						</div>
						<div>
							{todayTasks.map((task) => {
								const checked = taskToggle.isChecked(task);
								return (
									<TaskExit
										key={task.id}
										active={taskToggle.isExiting(task.id)}
									>
										<ItemContextMenu
											item={task}
											snapshot={snapshot}
											createLabel="할 일 추가"
											onCreate={() => setEditor({ open: true, kind: "task" })}
											onOpen={() =>
												setEditor({
													open: true,
													kind: "task",
													item: task,
												})
											}
											onArchive={() =>
												setConfirm({ kind: "archive", item: task })
											}
											onDelete={() =>
												setConfirm({ kind: "delete", item: task })
											}
											onToggleTask={() =>
												void taskToggle.toggle(task, { exit: true })
											}
											onMove={(space, folder) =>
												void moveItem(task, space, folder)
											}
										>
											<div className="flex min-h-14 items-center gap-3 border-b border-border/55 px-4 last:border-b-0">
												<TaskCheck
													checked={checked}
													animate={taskToggle.isAnimating(task.id)}
													disabled={taskToggle.isBusy(task.id)}
													onClick={() =>
														void taskToggle.toggle(task, { exit: true })
													}
													aria-label={`${task.title} 완료`}
												/>
												<button
													type="button"
													onClick={() =>
														setEditor({
															open: true,
															kind: "task",
															item: task,
														})
													}
													className="min-w-0 flex-1 py-2 text-left"
												>
													<span
														className={taskTitleClass(
															checked,
															"block text-sm font-medium",
														)}
													>
														{task.title}
													</span>
													<span className="mt-0.5 block text-xs text-muted-foreground">
														{folderOf(task) ??
															(task.space === "inbox" ? "Inbox" : task.space)}
													</span>
												</button>
												<span className="text-xs tabular-nums text-muted-foreground">
													{formatTime(task.due)}
												</span>
											</div>
										</ItemContextMenu>
									</TaskExit>
								);
							})}
							<TaskEmpty
								show={todayTasks.every((task) => taskToggle.isExiting(task.id))}
							>
								<EmptyRow icon={Circle} text="오늘 할 일이 없습니다" />
							</TaskEmpty>
						</div>
					</section>

					<section className="orbit-card overflow-hidden">
						<div className="flex items-center justify-between border-b border-border/60 px-4 py-3.5">
							<div className="flex items-center gap-2">
								<CalendarDays className="size-4" />
								<h3 className="text-sm font-semibold">오늘 일정</h3>
								<span className="text-xs tabular-nums text-muted-foreground">
									{snapshot.today.events.length}
								</span>
							</div>
							<Link
								to="/calendar"
								className="text-xs text-muted-foreground hover:text-foreground"
							>
								캘린더
							</Link>
						</div>
						<div>
							{snapshot.today.events.length > 0 ? (
								snapshot.today.events.map((event) => (
									<ItemContextMenu
										key={event.id}
										item={event}
										snapshot={snapshot}
										createLabel="일정 추가"
										onCreate={() => setEditor({ open: true, kind: "event" })}
										onOpen={() =>
											setEditor({ open: true, kind: "event", item: event })
										}
										onArchive={() =>
											setConfirm({ kind: "archive", item: event })
										}
										onDelete={() => setConfirm({ kind: "delete", item: event })}
										onMove={(space, folder) =>
											void moveItem(event, space, folder)
										}
									>
										<button
											type="button"
											onClick={() =>
												setEditor({ open: true, kind: "event", item: event })
											}
											className="flex min-h-14 w-full items-center gap-3 border-b border-border/55 px-4 text-left transition-colors last:border-b-0 hover:bg-muted/40"
										>
											<span className="w-12 shrink-0 text-xs font-medium tabular-nums">
												{formatTime(event.start)}
											</span>
											<span className="h-7 w-px bg-foreground/30" />
											<span className="min-w-0 flex-1 truncate text-sm font-medium">
												{event.title}
											</span>
										</button>
									</ItemContextMenu>
								))
							) : (
								<EmptyRow icon={CalendarDays} text="오늘 일정이 없습니다" />
							)}
						</div>
					</section>
				</div>

				<section className="orbit-card mt-4 overflow-hidden">
					<div className="flex items-center justify-between border-b border-border/60 px-4 py-3.5">
						<div className="flex items-center gap-2">
							<FolderKanban className="size-4" />
							<h3 className="text-sm font-semibold">Projects</h3>
							<span className="text-xs tabular-nums text-muted-foreground">
								{snapshot.folders.project.length}
							</span>
						</div>
						<Link
							to="/projects"
							className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
						>
							전체 보기
							<ArrowRight className="size-3.5" />
						</Link>
					</div>
					{snapshot.folders.project.length > 0 ? (
						<div className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
							{snapshot.folders.project.map((folder) => (
								<Link
									key={folder.slug}
									to="/projects/$folder"
									params={{ folder: folder.slug }}
									className="group flex min-w-0 items-center gap-3 rounded-xl border border-border/60 bg-background/55 px-3.5 py-3 transition-colors hover:border-border hover:bg-muted/55"
								>
									<FolderClosed className="size-8 shrink-0 fill-amber-300/55 text-amber-600/80 transition-transform group-hover:scale-105 dark:fill-amber-400/20 dark:text-amber-300/80" />
									<span className="min-w-0 flex-1">
										<span className="block truncate text-sm font-medium">
											{folder.slug}
										</span>
										<span className="mt-0.5 block text-xs text-muted-foreground">
											{folder.count}개 항목
										</span>
									</span>
									<ArrowRight className="size-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
								</Link>
							))}
						</div>
					) : (
						<div className="flex min-h-24 items-center justify-center px-4 text-sm text-muted-foreground">
							<Link to="/projects" className="hover:text-foreground">
								프로젝트 폴더를 만들면 여기에 바로 표시됩니다
							</Link>
						</div>
					)}
				</section>
			</div>

			<ScheduleEditor
				open={editor.open}
				onOpenChange={(open) => setEditor((current) => ({ ...current, open }))}
				kind={editor.kind}
				item={editor.item}
			/>
			<ConfirmItemDialog
				action={confirm}
				onOpenChange={(open) => {
					if (!open) setConfirm(null);
				}}
				onConfirm={() => {
					if (!confirm) return;
					const next = confirm;
					setConfirm(null);
					void (next.kind === "delete"
						? deleteItem(next.item)
						: archiveItem(next.item));
				}}
			/>
		</div>
	);
}

function EmptyRow({ icon: Icon, text }: { icon: typeof Circle; text: string }) {
	return (
		<div
			className={cn(
				"flex min-h-20 items-center justify-center gap-2 text-sm text-muted-foreground",
			)}
		>
			<Icon className="size-4" /> {text}
		</div>
	);
}
