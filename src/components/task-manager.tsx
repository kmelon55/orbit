import { useRouter } from "@tanstack/react-router";
import {
	ArrowRight,
	CalendarClock,
	Circle,
	GripVertical,
	Plus,
} from "lucide-react";
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
type RescheduleTarget = "today" | "tomorrow";

const RESCHEDULE_EXIT_MS = 140;
const RESCHEDULE_ENTER_MS = 200;

function waitForRescheduleExit() {
	if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
		return Promise.resolve();
	}
	return new Promise<void>((resolve) => {
		window.setTimeout(resolve, RESCHEDULE_EXIT_MS);
	});
}

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

function rescheduledDue(item: OrbitItem, day: string) {
	return `${day}${item.due?.slice(10) ?? ""}`;
}

function targetDays(item: OrbitItem, today: string): RescheduleTarget[] {
	const day = dueDay(item);
	if (!day) return [];
	if (day < today) return ["today", "tomorrow"];
	if (day === today) return ["tomorrow"];
	return ["today"];
}

export function TaskManager({ snapshot }: { snapshot: OrbitSnapshot }) {
	const router = useRouter();
	const today = formatDayKey();
	const [view, setView] = useState<TaskView>("open");
	const [editor, setEditor] = useState<{ open: boolean; item?: OrbitItem }>({
		open: false,
	});
	const [confirm, setConfirm] = useState<ItemConfirmAction | null>(null);
	const [draggingTask, setDraggingTask] = useState<OrbitItem | null>(null);
	const [dropActive, setDropActive] = useState<RescheduleTarget | null>(null);
	const [reschedulingIds, setReschedulingIds] = useState<string[]>([]);
	const [departingIds, setDepartingIds] = useState<string[]>([]);
	const [arrivingIds, setArrivingIds] = useState<string[]>([]);
	const [optimisticDueById, setOptimisticDueById] = useState<
		Record<string, string>
	>({});
	const [rescheduleError, setRescheduleError] = useState<string>();
	const taskToggle = useTaskToggle();
	useEffect(() => {
		taskToggle.sync(snapshot.items);
	}, [snapshot.items, taskToggle.sync]);
	useEffect(() => {
		setOptimisticDueById((current) => {
			let changed = false;
			const next = { ...current };
			for (const [id, due] of Object.entries(current)) {
				const persisted = snapshot.items.find((item) => item.id === id)?.due;
				if (persisted !== due) continue;
				delete next[id];
				changed = true;
			}
			return changed ? next : current;
		});
	}, [snapshot.items]);
	const tasks = useMemo(
		() =>
			snapshot.items
				.filter((item) => item.type === "task" && item.space !== "archive")
				.map((item) =>
					optimisticDueById[item.id]
						? { ...item, due: optimisticDueById[item.id] }
						: item,
				)
				.sort((left, right) =>
					(left.due ?? "9999").localeCompare(right.due ?? "9999"),
				),
		[snapshot.items, optimisticDueById],
	);
	const openTasks = tasks.filter((item) => taskToggle.keepInOpenList(item));
	const doneTasks = tasks.filter((item) => taskToggle.keepInDoneList(item));
	const groups = useMemo(
		() => [
			{
				key: "overdue",
				label: "기한 지남",
				items: openTasks.filter((item) => {
					const day = dueDay(item);
					return Boolean(day && day < today);
				}),
			},
			{
				key: "today",
				label: "오늘",
				items: openTasks.filter((item) => dueDay(item) === today),
			},
			{
				key: "upcoming",
				label: "다가오는 할 일",
				items: openTasks.filter((item) => {
					const day = dueDay(item);
					return Boolean(day && day > today);
				}),
			},
			{
				key: "unscheduled",
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

	const tomorrow = new Date();
	tomorrow.setDate(tomorrow.getDate() + 1);
	const tomorrowKey = formatDayKey(tomorrow);
	const draggingDay = draggingTask ? dueDay(draggingTask) : undefined;
	const rescheduleTargets = draggingTask
		? targetDays(draggingTask, today).map((target) => ({
				target,
				label:
					target === "tomorrow"
						? "내일로 미루기"
						: draggingDay && draggingDay > today
							? "오늘로 당겨오기"
							: "오늘로 가져오기",
				hint:
					target === "tomorrow"
						? "시간은 그대로 두고 날짜만 내일로 바뀝니다."
						: "시간은 그대로 두고 날짜만 오늘로 바뀝니다.",
			}))
		: [];

	function startRescheduleDrag(event: React.DragEvent, item: OrbitItem) {
		event.dataTransfer.effectAllowed = "move";
		event.dataTransfer.setData("application/x-orbit-task-id", item.id);
		event.dataTransfer.setData("text/plain", item.id);
		setRescheduleError(undefined);
		setDraggingTask(item);
	}

	function finishRescheduleDrag() {
		setDraggingTask(null);
		setDropActive(null);
	}

	async function rescheduleTask(item: OrbitItem, target: RescheduleTarget) {
		if (
			!targetDays(item, today).includes(target) ||
			reschedulingIds.includes(item.id)
		) {
			return;
		}
		const nextDue = rescheduledDue(
			item,
			target === "today" ? today : tomorrowKey,
		);
		setReschedulingIds((current) => [...current, item.id]);
		setDepartingIds((current) => [...current, item.id]);
		finishRescheduleDrag();
		await waitForRescheduleExit();
		setDepartingIds((current) => current.filter((id) => id !== item.id));
		setOptimisticDueById((current) => ({
			...current,
			[item.id]: nextDue,
		}));
		setArrivingIds((current) => [...current, item.id]);
		window.setTimeout(() => {
			setArrivingIds((current) => current.filter((id) => id !== item.id));
		}, RESCHEDULE_ENTER_MS);
		let persisted = false;
		try {
			await mutateOrbit({
				data: {
					action: "file-item",
					id: item.id,
					input: {
						space: item.space,
						folder: folderOf(item),
						due: nextDue,
					},
				},
			});
			persisted = true;
			await router.invalidate();
		} catch {
			if (!persisted) {
				setOptimisticDueById((current) => {
					const next = { ...current };
					delete next[item.id];
					return next;
				});
			}
			setRescheduleError(
				persisted
					? `“${item.title}”은 저장됐지만 화면 동기화가 늦어지고 있습니다.`
					: `“${item.title}”의 날짜를 ${target === "today" ? "오늘" : "내일"}로 바꾸지 못했습니다.`,
			);
		} finally {
			setReschedulingIds((current) => current.filter((id) => id !== item.id));
		}
	}

	function receiveRescheduledTask(
		event: React.DragEvent,
		target: RescheduleTarget,
	) {
		event.preventDefault();
		event.stopPropagation();
		const id =
			event.dataTransfer.getData("application/x-orbit-task-id") ||
			draggingTask?.id;
		const item = tasks.find((candidate) => candidate.id === id);
		if (item) void rescheduleTask(item, target);
	}

	return (
		<div className="relative h-full overflow-hidden bg-muted/20">
			<div className="h-full overflow-auto">
				<div className="mx-auto w-full max-w-5xl px-4 py-4 sm:px-5 sm:py-6 lg:px-8">
					<header className="mb-5 flex flex-wrap items-center justify-between gap-3 sm:mb-7">
						<div>
							<h2 className="text-xl font-semibold tracking-tight">할 일</h2>
							<p className="mt-1 hidden text-sm text-muted-foreground sm:block">
								날짜를 정하면 Today와 Calendar에도 함께 표시됩니다.
							</p>
						</div>
						<Button onClick={() => void createTask()}>
							<Plus /> 할 일
						</Button>
					</header>

					<div className="mb-4 flex w-fit rounded-lg bg-muted p-0.5 sm:mb-6">
						{(["open", "done"] as const).map((value) => (
							<Button
								key={value}
								variant="ghost"
								size="sm"
								className={cn(
									"h-7 px-3",
									view === value &&
										"bg-background shadow-sm hover:bg-background",
								)}
								onClick={() => setView(value)}
							>
								{value === "open"
									? `진행 중 ${openTasks.length}`
									: `완료 ${doneTasks.length}`}
							</Button>
						))}
					</div>

					{rescheduleError ? (
						<output className="mb-4 block rounded-lg border border-destructive/25 bg-destructive/8 px-3 py-2 text-sm text-destructive">
							{rescheduleError}
						</output>
					) : null}

					{view === "open" ? (
						<div className="space-y-4">
							{groups.map((group) => (
								<section key={group.key} className="orbit-card overflow-hidden">
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
										canReschedule={group.key !== "unscheduled"}
										settling={reschedulingIds.length > 0}
										departingIds={departingIds}
										arrivingIds={arrivingIds}
										draggingId={draggingTask?.id}
										onDragStart={startRescheduleDrag}
										onDragEnd={finishRescheduleDrag}
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
								canReschedule={false}
								settling={false}
								departingIds={[]}
								arrivingIds={[]}
								draggingId={draggingTask?.id}
								onDragStart={startRescheduleDrag}
								onDragEnd={finishRescheduleDrag}
								onOpen={(item) => setEditor({ open: true, item })}
								onCreate={() => void createTask()}
								onArchive={(item) => setConfirm({ kind: "archive", item })}
								onDelete={(item) => setConfirm({ kind: "delete", item })}
								onMove={moveItem}
							/>
						</div>
					)}
				</div>
			</div>

			<aside
				aria-hidden={!draggingTask}
				inert={!draggingTask}
				className={cn(
					"absolute inset-y-0 right-0 z-30 flex w-72 max-w-[88vw] flex-col border-l border-border/70 bg-background/96 shadow-2xl backdrop-blur-xl transition-transform duration-200 ease-[var(--interaction-ease)]",
					draggingTask
						? "translate-x-0"
						: "pointer-events-none translate-x-full",
				)}
			>
				<div className="border-b border-border/60 px-5 py-4">
					<p className="text-sm font-semibold">빠르게 날짜 이동</p>
					<p className="mt-0.5 truncate text-xs text-muted-foreground">
						{draggingTask ? `“${draggingTask.title}”` : "오늘 할 일"}
					</p>
				</div>
				<div className="grid min-h-0 flex-1 auto-rows-fr gap-3 p-4">
					{rescheduleTargets.map((option) => (
						<fieldset
							key={option.target}
							className={cn(
								"flex min-h-0 flex-1 flex-col items-center justify-center rounded-2xl border-2 border-dashed px-5 text-center transition-[border-color,background-color,transform] duration-150",
								dropActive === option.target
									? "scale-[1.02] border-foreground/45 bg-accent"
									: "border-border bg-muted/35",
							)}
							onDragEnter={() => setDropActive(option.target)}
							onDragLeave={(event) => {
								if (
									!event.currentTarget.contains(event.relatedTarget as Node)
								) {
									setDropActive((current) =>
										current === option.target ? null : current,
									);
								}
							}}
							onDragOver={(event) => {
								event.preventDefault();
								event.dataTransfer.dropEffect = "move";
								setDropActive(option.target);
							}}
							onDrop={(event) => receiveRescheduledTask(event, option.target)}
						>
							<span className="grid size-11 place-items-center rounded-full bg-background text-foreground shadow-sm ring-1 ring-border/80">
								<CalendarClock className="size-5" />
							</span>
							<p className="mt-3 text-sm font-semibold">{option.label}</p>
							<p className="mt-1 max-w-48 text-xs leading-5 text-muted-foreground">
								{option.hint}
							</p>
							<ArrowRight className="mt-4 size-4 text-muted-foreground" />
						</fieldset>
					))}
				</div>
			</aside>

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
	canReschedule,
	settling,
	departingIds,
	arrivingIds,
	draggingId,
	onDragStart,
	onDragEnd,
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
	canReschedule: boolean;
	settling: boolean;
	departingIds: string[];
	arrivingIds: string[];
	draggingId?: string;
	onDragStart: (event: React.DragEvent, item: OrbitItem) => void;
	onDragEnd: () => void;
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
				const departing = departingIds.includes(item.id);
				const arriving = arrivingIds.includes(item.id);
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
							<fieldset
								draggable={canReschedule}
								onDragStart={(event) => onDragStart(event, item)}
								onDragEnd={onDragEnd}
								className={cn(
									"group flex min-h-14 items-center gap-3 border-b border-border/55 px-3 transition-[background-color,opacity,transform] duration-150 last:border-b-0 hover:bg-muted/40 sm:px-4",
									canReschedule && "cursor-grab active:cursor-grabbing",
									draggingId === item.id && "opacity-45",
									departing && "pointer-events-none -translate-x-2 opacity-0",
									arriving &&
										"animate-in fade-in slide-in-from-right-2 duration-200",
								)}
							>
								{canReschedule ? (
									<span
										className="-mr-1 hidden size-5 shrink-0 items-center justify-center text-muted-foreground/45 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 sm:flex"
										aria-hidden="true"
									>
										<GripVertical className="size-3.5" />
									</span>
								) : null}
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
										"flex max-w-24 shrink-0 items-center gap-1 text-right text-[11px] text-muted-foreground sm:max-w-none sm:gap-1.5 sm:text-xs",
										day && day < today && !checked && "text-destructive",
									)}
								>
									<CalendarClock className="size-3.5" />{" "}
									{formatDue(item, today)}
								</span>
							</fieldset>
						</ItemContextMenu>
					</TaskExit>
				);
			})}
			<TaskEmpty show={empty} animate={!settling}>
				<ItemContextMenu createLabel="할 일 추가" onCreate={onCreate}>
					<div className="flex min-h-16 items-center gap-2 px-4 text-sm text-muted-foreground">
						<Circle className="size-3.5" /> 비어 있습니다
					</div>
				</ItemContextMenu>
			</TaskEmpty>
		</div>
	);
}
