import { useRouter } from "@tanstack/react-router";
import { CalendarClock, Circle, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { mutateOrbit } from "#/lib/orbit/functions";
import { folderOf, formatDayKey } from "#/lib/orbit/para";
import type { OrbitItem, OrbitSnapshot, OrbitSpace } from "#/lib/orbit/schema";
import {
	ConfirmItemDialog,
	type ItemConfirmAction,
	ItemContextMenu,
} from "@/components/item-context-menu";
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

type TaskView = "open" | "done";

function dueDay(item: OrbitItem) {
	return item.due?.slice(0, 10);
}

function dueTime(item: OrbitItem) {
	return item.due?.match(/T(\d{2}:\d{2})/)?.[1];
}

function formatDue(item: OrbitItem, today: string) {
	const day = dueDay(item);
	if (!day) return "날짜 없음";
	const time = dueTime(item);
	if (day === today) return time ? `오늘 ${time}` : "오늘";
	const date = new Date(`${day}T00:00:00`);
	const label = new Intl.DateTimeFormat("ko-KR", {
		month: "short",
		day: "numeric",
		weekday: "short",
	}).format(date);
	return time ? `${label} ${time}` : label;
}

function taskContext(item: OrbitItem) {
	return folderOf(item) ?? (item.space === "inbox" ? "Inbox" : item.space);
}

export function TaskManager({ snapshot }: { snapshot: OrbitSnapshot }) {
	const router = useRouter();
	const today = formatDayKey();
	const [view, setView] = useState<TaskView>("open");
	const [editor, setEditor] = useState<{ open: boolean; item?: OrbitItem }>({
		open: false,
	});
	const [confirm, setConfirm] = useState<ItemConfirmAction | null>(null);
	const taskToggle = useTaskToggle();
	useEffect(() => {
		taskToggle.sync(snapshot.items);
	}, [snapshot.items, taskToggle.sync]);
	const tasks = useMemo(
		() =>
			snapshot.items
				.filter((item) => item.type === "task" && item.space !== "archive")
				.sort((left, right) =>
					(left.due ?? "9999").localeCompare(right.due ?? "9999"),
				),
		[snapshot.items],
	);
	const openTasks = tasks.filter((item) => taskToggle.keepInOpenList(item));
	const doneTasks = tasks.filter((item) => taskToggle.keepInDoneList(item));
	const groups = useMemo(
		() => [
			{
				label: "기한 지남",
				items: openTasks.filter((item) => {
					const day = dueDay(item);
					return Boolean(day && day < today);
				}),
			},
			{
				label: "오늘",
				items: openTasks.filter((item) => dueDay(item) === today),
			},
			{
				label: "다가오는 할 일",
				items: openTasks.filter((item) => {
					const day = dueDay(item);
					return Boolean(day && day > today);
				}),
			},
			{
				label: "날짜 없음",
				items: openTasks.filter((item) => !dueDay(item)),
			},
		],
		[openTasks, today],
	);

	async function createTask() {
		setEditor({ open: true });
	}

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
			<div className="mx-auto w-full max-w-5xl px-5 py-6 lg:px-8">
				<header className="mb-7 flex flex-wrap items-center justify-between gap-3">
					<div>
						<h2 className="text-xl font-semibold tracking-tight">할 일</h2>
						<p className="mt-1 text-sm text-muted-foreground">
							날짜를 정하면 Today와 Calendar에도 함께 표시됩니다.
						</p>
					</div>
					<Button onClick={() => void createTask()}>
						<Plus /> 할 일
					</Button>
				</header>

				<div className="mb-6 flex w-fit rounded-lg bg-muted p-0.5">
					{(["open", "done"] as const).map((value) => (
						<Button
							key={value}
							variant="ghost"
							size="sm"
							className={cn(
								"h-7 px-3",
								view === value && "bg-background shadow-sm hover:bg-background",
							)}
							onClick={() => setView(value)}
						>
							{value === "open"
								? `진행 중 ${openTasks.length}`
								: `완료 ${doneTasks.length}`}
						</Button>
					))}
				</div>

				{view === "open" ? (
					<div className="space-y-4">
						{groups.map((group) => (
							<section key={group.label} className="orbit-card overflow-hidden">
								<div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
									<h3 className="text-xs font-semibold text-muted-foreground">
										{group.label}
									</h3>
									<span className="text-xs tabular-nums text-muted-foreground/70">
										{group.items.length}
									</span>
								</div>
								<TaskRows
									items={group.items}
									snapshot={snapshot}
									today={today}
									taskToggle={taskToggle}
									onOpen={(item) => setEditor({ open: true, item })}
									onCreate={() => void createTask()}
									onArchive={(item) => setConfirm({ kind: "archive", item })}
									onDelete={(item) => setConfirm({ kind: "delete", item })}
									onMove={moveItem}
								/>
							</section>
						))}
					</div>
				) : (
					<div className="orbit-card overflow-hidden">
						<TaskRows
							items={doneTasks}
							snapshot={snapshot}
							today={today}
							taskToggle={taskToggle}
							onOpen={(item) => setEditor({ open: true, item })}
							onCreate={() => void createTask()}
							onArchive={(item) => setConfirm({ kind: "archive", item })}
							onDelete={(item) => setConfirm({ kind: "delete", item })}
							onMove={moveItem}
						/>
					</div>
				)}
			</div>

			<ScheduleEditor
				open={editor.open}
				onOpenChange={(open) => setEditor((current) => ({ ...current, open }))}
				kind="task"
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

function TaskRows({
	items,
	snapshot,
	today,
	taskToggle,
	onOpen,
	onCreate,
	onArchive,
	onDelete,
	onMove,
}: {
	items: OrbitItem[];
	snapshot: OrbitSnapshot;
	today: string;
	taskToggle: ReturnType<typeof useTaskToggle>;
	onOpen: (item: OrbitItem) => void;
	onCreate: () => void;
	onArchive: (item: OrbitItem) => void;
	onDelete: (item: OrbitItem) => void;
	onMove: (item: OrbitItem, space: OrbitSpace, folder?: string) => void;
}) {
	const empty = items.every((item) => taskToggle.isExiting(item.id));

	return (
		<div>
			{items.map((item) => {
				const day = dueDay(item);
				const checked = taskToggle.isChecked(item);
				return (
					<TaskExit key={item.id} active={taskToggle.isExiting(item.id)}>
						<ItemContextMenu
							item={item}
							snapshot={snapshot}
							createLabel="할 일 추가"
							onCreate={onCreate}
							onOpen={() => onOpen(item)}
							onArchive={() => onArchive(item)}
							onDelete={() => onDelete(item)}
							onToggleTask={() => void taskToggle.toggle(item, { exit: true })}
							onMove={(space, folder) => onMove(item, space, folder)}
						>
							<div className="group flex min-h-14 items-center gap-3 border-b border-border/55 px-4 transition-colors last:border-b-0 hover:bg-muted/40">
								<TaskCheck
									checked={checked}
									animate={taskToggle.isAnimating(item.id)}
									disabled={taskToggle.isBusy(item.id)}
									onClick={() => void taskToggle.toggle(item, { exit: true })}
									aria-label={
										checked ? `${item.title} 다시 열기` : `${item.title} 완료`
									}
								/>
								<button
									type="button"
									onClick={() => onOpen(item)}
									className="min-w-0 flex-1 py-2 text-left"
								>
									<span
										className={taskTitleClass(
											checked,
											"block text-sm font-medium",
										)}
									>
										{item.title}
									</span>
									<span className="mt-0.5 block truncate text-xs text-muted-foreground">
										{taskContext(item)}
									</span>
								</button>
								<span
									className={cn(
										"flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground",
										day && day < today && !checked && "text-destructive",
									)}
								>
									<CalendarClock className="size-3.5" />{" "}
									{formatDue(item, today)}
								</span>
							</div>
						</ItemContextMenu>
					</TaskExit>
				);
			})}
			<TaskEmpty show={empty}>
				<ItemContextMenu createLabel="할 일 추가" onCreate={onCreate}>
					<div className="flex min-h-16 items-center gap-2 px-4 text-sm text-muted-foreground">
						<Circle className="size-3.5" /> 비어 있습니다
					</div>
				</ItemContextMenu>
			</TaskEmpty>
		</div>
	);
}
