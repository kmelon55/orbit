import { Link } from "@tanstack/react-router";
import {
	AlertCircle,
	ArrowUpRight,
	CalendarDays,
	Check,
	ChevronDown,
	Circle,
	Ellipsis,
	Flag,
	List,
	Pencil,
	Plus,
	Route,
	Trash2,
	X,
} from "lucide-react";
import { Fragment, useState } from "react";
import { toast } from "sonner";
import type { Goal } from "#/lib/orbit/assistant-schema";
import { mutateOrbit } from "#/lib/orbit/functions";
import {
	type GoalProjectGroup,
	goalAttention,
	goalMilestones,
	goalProjectGroups,
	goalTasks,
} from "#/lib/orbit/goal-portfolio";
import { goalInput, goalWeekStart } from "#/lib/orbit/goals";
import { formatDayKey } from "#/lib/orbit/para";
import type { OrbitItem } from "#/lib/orbit/schema";
import { cn } from "#/lib/utils";
import { GoalCalendar, GoalMap } from "./goal-board";
import { GoalEditor } from "./goal-editor";
import { GoalMetricHistory, GoalMetricSummary } from "./goal-metric";
import { useGoals } from "./goal-provider";
import { GoalWorkspace as RoadmapWorkspace } from "./goal-roadmap";
import { WeekOutcome } from "./goal-workspace";
import { useI18n } from "./locale-provider";
import { useOrbitSnapshot } from "./orbit-snapshot-provider";
import { ScheduleEditor } from "./schedule-editor";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "./ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Input } from "./ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "./ui/select";

type Filter = "active" | "attention" | "week" | "paused" | "done";
const filterLabels: Record<Filter, string> = {
	active: "진행 중",
	attention: "점검 필요",
	week: "이번 주",
	paused: "보류",
	done: "완료",
};
type Editor = {
	goal?: Goal;
	parent?: Goal;
	defaultGroupName?: string;
	defaultProject?: string;
};

export function GoalWorkspace() {
	const { t, errorText } = useI18n();
	const state = useGoals();
	const snapshot = useOrbitSnapshot();
	const [project, setProject] = useState("all");
	const [filter, setFilter] = useState<Filter>("active");
	const [selected, setSelected] = useState<string>();
	const [editor, setEditor] = useState<Editor | null>(null);
	const [deleting, setDeleting] = useState<Goal | null>(null);
	const [roadmap, setRoadmap] = useState(false);
	const [view, setView] = useState<"map" | "calendar" | "list">("list");
	const day = formatDayKey();
	const roots = state.goals.filter((goal) => !goal.parentId && !goal.roadmap);
	const groups = goalProjectGroups(state.goals, snapshot.folders.project);
	const selectedGroup = groups.find((group) => group.key === project);
	const active = roots.filter((goal) => goal.status === "active");
	const attention = active.filter(
		(goal) => goalAttention(goal, state.goals, day).length,
	);
	const currentWeek = goalWeekStart(day);
	function matches(goal: Goal, mode: Filter = filter) {
		if (mode === "attention")
			return attention.some((item) => item.id === goal.id);
		if (mode === "week")
			return (
				goal.status === "active" &&
				goal.week?.start === currentWeek &&
				Boolean(goal.week.outcome.trim())
			);
		return goal.status === mode;
	}
	function create(group?: GoalProjectGroup) {
		setEditor({
			defaultGroupName: group?.name || undefined,
			defaultProject:
				group?.folders.length === 1 ? group.folders[0] : undefined,
		});
	}
	if (roadmap)
		return (
			<div className="h-full overflow-y-auto">
				<Button
					className="m-4"
					variant="ghost"
					onClick={() => setRoadmap(false)}
				>
					{t("목표로 돌아가기")}
				</Button>
				<RoadmapWorkspace />
			</div>
		);
	const visibleGroups = groups
		.filter((group) => project === "all" || group.key === project)
		.filter(
			(group) =>
				filter === "active" || group.goals.some((goal) => matches(goal)),
		);
	const scopedGoals = selectedGroup?.goals ?? roots;
	const boardGroups = visibleGroups.map((group) => ({
		...group,
		goals: group.goals.filter((goal) => matches(goal)),
	}));
	const detail = state.goals.find((goal) => goal.id === selected);
	const completedSteps = state.goals.filter(
		(goal) =>
			goal.status === "done" &&
			scopedGoals.some((root) => goal.parentId === root.id),
	).length;
	return (
		<div className="h-full overflow-y-auto bg-background">
			<div className="mx-auto max-w-[1440px] px-4 py-5 sm:px-7 lg:px-9">
				<header className="mb-5 flex items-center justify-between gap-3">
					<div className="flex flex-wrap items-center gap-x-5 gap-y-2">
						<h2 className="text-xl font-semibold tracking-tight">
							{t("목표")}
						</h2>
						{!state.loading &&
						(completedSteps > 0 ||
							scopedGoals.some((goal) => goal.status === "done")) ? (
							<span className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
								<Check className="size-3.5" />
								{t("단계 {0}개 · 목표 {1}개 완료", [
									completedSteps,
									scopedGoals.filter((goal) => goal.status === "done").length,
								])}
							</span>
						) : null}
					</div>
					<div className="flex items-center gap-2">
						{state.goals.some((goal) => goal.roadmap) ? (
							<Button
								variant="ghost"
								size="sm"
								onClick={() => setRoadmap(true)}
							>
								{t("장기 계획")}
							</Button>
						) : null}
						<Button
							size="sm"
							disabled={state.loading || state.busy}
							onClick={() => create(selectedGroup)}
						>
							<Plus />
							{t("목표 추가")}
						</Button>
					</div>
				</header>
				{state.error ? (
					<div
						role="alert"
						className="mb-4 flex items-center gap-3 text-sm text-destructive"
					>
						{errorText(state.error)}
						<Button
							variant="outline"
							size="sm"
							onClick={() => void state.reload()}
						>
							{t("다시 시도")}
						</Button>
					</div>
				) : null}
				<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
					<div className="flex flex-wrap items-center gap-3">
						<div className="flex gap-0.5 rounded-lg bg-muted/60 p-1">
							{(
								[
									{ key: "map", label: "진행 지도", icon: Route },
									{ key: "calendar", label: "달력", icon: CalendarDays },
									{ key: "list", label: "목록", icon: List },
								] as const
							).map(({ key, label, icon: Icon }) => (
								<button
									type="button"
									key={key}
									aria-pressed={view === key}
									onClick={() => {
										setView(key);
										setSelected(undefined);
									}}
									className={cn(
										"flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs",
										view === key
											? "bg-background font-medium shadow-sm"
											: "text-muted-foreground hover:text-foreground",
									)}
								>
									<Icon className="size-3.5" />
									{t(label)}
								</button>
							))}
						</div>
						<Select
							value={project}
							onValueChange={(value) => {
								setProject(value);
								setSelected(undefined);
							}}
						>
							<SelectTrigger
								size="sm"
								className="max-w-52"
								aria-label={t("프로젝트 필터")}
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">{t("모든 목표")}</SelectItem>
								{groups
									.filter((group) => group.goals.length)
									.map((group) => (
										<SelectItem key={group.key} value={group.key}>
											{group.name || t("프로젝트 없음")}
										</SelectItem>
									))}
							</SelectContent>
						</Select>
					</div>
					<div className="flex flex-wrap gap-1">
						{(Object.keys(filterLabels) as Filter[]).map((value) => (
							<button
								key={value}
								type="button"
								aria-pressed={filter === value}
								onClick={() => setFilter(value)}
								className={cn(
									"rounded-md px-2.5 py-1.5 text-xs",
									filter === value
										? "bg-muted font-medium"
										: "text-muted-foreground hover:bg-muted/50",
								)}
							>
								{t(filterLabels[value])}
								<span className="ml-1.5 tabular-nums text-muted-foreground">
									{state.loading
										? "—"
										: scopedGoals.filter((goal) => matches(goal, value)).length}
								</span>
							</button>
						))}
					</div>
				</div>
				{state.loading ? (
					<output className="block py-8 text-sm text-muted-foreground">
						{t("불러오는 중…")}
					</output>
				) : view === "map" ? (
					<GoalMap
						groups={boardGroups}
						goals={state.goals}
						busy={state.busy}
						onOpen={(goal) => setSelected(goal.id)}
						onAdd={create}
						onToggle={async (goal) => {
							const result = await state.save({
								...goalInput(goal),
								status: goal.status === "done" ? "active" : "done",
							});
							const saved = result?.find((item) => item.id === goal.id);
							if (saved && goal.status !== "done")
								toast.success(t("단계 완료"), {
									description: goal.title,
									action: {
										label: t("실행 취소"),
										onClick: () => {
											void state.save({
												...goalInput(saved),
												status: goal.status,
												focused: goal.focused,
											});
										},
									},
								});
						}}
						onCreateStep={async (goal, title, date) =>
							Boolean(
								await state.save({
									title,
									parentId: goal.id,
									horizon: "milestone",
									status: "active",
									targetDate: date || undefined,
									projectFolders: [],
									itemIds: [],
									description: "",
									importance: 3,
								}),
							)
						}
						onEdit={(goal) => setEditor({ goal })}
					/>
				) : view === "calendar" ? (
					<GoalCalendar
						groups={boardGroups}
						goals={state.goals}
						onOpen={(goal) => setSelected(goal.id)}
					/>
				) : (
					<div className="overflow-x-auto rounded-lg border">
						<div className="min-w-[780px]">
							<div
								className={cn(
									goalColumns,
									"border-b px-3 py-2 text-xs text-muted-foreground",
								)}
							>
								<span>{t("목표")}</span>
								<span>{t("기한")}</span>
								<span>{t("실제 성과")}</span>
								<span>{t("다음 단계")}</span>
								<span>{t("이번 주")}</span>
							</div>
							{scopedGoals
								.filter((goal) => matches(goal))
								.map((goal) => (
									<Fragment key={goal.id}>
										<GoalRow
											goal={goal}
											projectLabels={groups
												.filter((group) =>
													group.goals.some((item) => item.id === goal.id),
												)
												.map((group) => group.name)
												.filter(Boolean)}
											selected={selected === goal.id}
											onSelect={() =>
												setSelected(selected === goal.id ? undefined : goal.id)
											}
										/>
										{selected === goal.id ? (
											<GoalExecution
												goal={goal}
												onEdit={(goal) => setEditor({ goal })}
												onAdd={() => setEditor({ parent: goal })}
												onDelete={setDeleting}
											/>
										) : null}
									</Fragment>
								))}
							{!scopedGoals.some((goal) => matches(goal)) ? (
								<div className="px-3 py-6 text-sm text-muted-foreground">
									{t("목표 없음")}
								</div>
							) : null}
						</div>
					</div>
				)}
			</div>
			{view !== "list" && detail && !editor && !deleting ? (
				<Dialog
					open
					onOpenChange={(open) => {
						if (!open) setSelected(undefined);
					}}
				>
					<DialogContent className="max-w-4xl p-0" aria-describedby={undefined}>
						<DialogHeader className="flex flex-row items-center justify-between px-6 pt-5">
							<DialogTitle>{detail.title}</DialogTitle>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={t("닫기")}
								onClick={() => setSelected(undefined)}
							>
								<X />
							</Button>
						</DialogHeader>
						<GoalExecution
							goal={detail}
							onEdit={(goal) => setEditor({ goal })}
							onAdd={() => setEditor({ parent: detail })}
							onDelete={setDeleting}
						/>
					</DialogContent>
				</Dialog>
			) : null}
			{editor ? (
				<GoalEditor
					{...editor}
					onClose={() => setEditor(null)}
					onSaved={(id) => {
						setSelected(editor.parent?.id ?? editor.goal?.parentId ?? id);
						setFilter(editor.goal?.status ?? "active");
						setProject("all");
					}}
				/>
			) : null}
			{deleting ? (
				<DeleteGoal goal={deleting} onClose={() => setDeleting(null)} />
			) : null}
		</div>
	);
}

const goalColumns =
	"grid grid-cols-[minmax(220px,2fr)_92px_minmax(100px,1fr)_minmax(150px,1.3fr)_minmax(150px,1.3fr)] items-center gap-3";

function GoalRow({
	goal,
	projectLabels,
	selected,
	onSelect,
}: {
	goal: Goal;
	projectLabels: string[];
	selected: boolean;
	onSelect: () => void;
}) {
	const { t } = useI18n();
	const { goals } = useGoals();
	const steps = goalMilestones(goal, goals);
	const next =
		steps.find((step) => step.status === "active" && step.focused) ??
		steps.find((step) => step.status === "active");
	const day = formatDayKey();
	const issues = goalAttention(goal, goals, day);
	const week = goal.week?.start === goalWeekStart(day) ? goal.week.outcome : "";
	return (
		<button
			type="button"
			aria-expanded={selected}
			onClick={onSelect}
			className={cn(
				goalColumns,
				"w-full border-b border-border/60 px-3 py-3 text-left text-xs transition-colors last:border-0",
				selected ? "bg-primary/[0.045]" : "hover:bg-muted/30",
			)}
		>
			<span className="flex min-w-0 items-center gap-2">
				<ChevronDown
					className={cn(
						"size-3.5 shrink-0 text-muted-foreground transition-transform",
						!selected && "-rotate-90",
					)}
				/>
				<span className="min-w-0">
					<span
						className="block truncate text-sm font-medium"
						title={goal.title}
					>
						{goal.title}
					</span>
					{projectLabels.length ? (
						<span
							className="mt-1 block truncate text-[11px] text-muted-foreground"
							title={projectLabels.join(" · ")}
						>
							{projectLabels.join(" · ")}
						</span>
					) : null}
					<span className="mt-1 block text-[11px] text-muted-foreground">
						{t("실행 {0}/{1} 단계", [
							steps.filter((step) => step.status === "done").length,
							steps.length,
						])}
					</span>
				</span>
				{issues.length ? (
					<span
						className="shrink-0 text-amber-600 dark:text-amber-400"
						title={issues.map((issue) => t(issue)).join(" · ")}
					>
						<AlertCircle className="size-3.5" />
						<span className="sr-only">{t("점검 필요")}</span>
					</span>
				) : null}
			</span>
			<span
				className={cn(
					"tabular-nums",
					goal.status === "active" && goal.targetDate && goal.targetDate < day
						? "text-amber-600 dark:text-amber-400"
						: "text-muted-foreground",
				)}
			>
				{goal.targetDate || "—"}
			</span>
			<GoalMetricSummary goal={goal} />
			<span className="truncate" title={next?.title}>
				{next?.title || "—"}
			</span>
			<span className="truncate text-muted-foreground" title={week}>
				{week || "—"}
			</span>
		</button>
	);
}

function GoalExecution({
	goal,
	onEdit,
	onAdd,
	onDelete,
}: {
	goal: Goal;
	onEdit: (goal: Goal) => void;
	onAdd: () => void;
	onDelete: (goal: Goal) => void;
}) {
	const { t, errorText } = useI18n();
	const { goals, save, busy } = useGoals();
	const snapshot = useOrbitSnapshot();
	const [task, setTask] = useState<OrbitItem>();
	const steps = goalMilestones(goal, goals);
	const tasks = goalTasks(goal, goals, snapshot.items);
	return (
		<div className="border-b bg-muted/[0.12] px-4 py-5 sm:px-6">
			<div className="mb-5 flex flex-wrap items-center justify-end gap-3">
				<div className="flex items-center gap-1">
					<Button
						size="sm"
						variant="ghost"
						disabled={busy}
						onClick={() => onEdit(goal)}
					>
						<Pencil className="size-3.5" />
						{t("목표 수정")}
					</Button>
					<GoalMenu goal={goal} onEdit={onEdit} onDelete={onDelete} />
				</div>
			</div>
			{goal.metric || goal.metricHistory?.length ? (
				<section className="mb-5 rounded-lg border bg-background p-4">
					<div className="mb-3 flex items-center justify-between gap-3">
						<h5 className="text-sm font-medium">{t("실제 성과")}</h5>
						<Button
							size="sm"
							variant="ghost"
							disabled={busy}
							onClick={() => onEdit(goal)}
						>
							{t("성과 기록")}
						</Button>
					</div>
					<div className="grid gap-3 sm:grid-cols-2">
						<GoalMetricSummary goal={goal} />
						<GoalMetricHistory goal={goal} />
					</div>
				</section>
			) : null}
			{goal.successCriteria ? (
				<div className="mb-5 border-l-2 border-primary/25 pl-3">
					<p className="mb-1 text-xs text-muted-foreground">{t("달성 기준")}</p>
					<p className="whitespace-pre-wrap break-words text-sm leading-6">
						{goal.successCriteria}
					</p>
				</div>
			) : null}
			<div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
				<section className="min-w-0">
					<div className="mb-3 flex items-center justify-between gap-2">
						<h5 className="text-sm font-semibold">
							{t("실행 단계")}
							<span className="ml-2 text-xs font-normal text-muted-foreground">
								{steps.filter((step) => step.status === "done").length}/
								{steps.length}
							</span>
						</h5>
						<Button variant="ghost" size="sm" disabled={busy} onClick={onAdd}>
							<Plus className="size-3.5" />
							{t("단계 추가")}
						</Button>
					</div>
					<div className="divide-y">
						{steps.map((step) => (
							<div key={step.id} className="flex items-start gap-3 py-3">
								<Checkbox
									className="mt-1"
									disabled={busy}
									checked={step.status === "done"}
									aria-label={
										step.status === "done"
											? t("{0} 다시 열기", [step.title])
											: t("{0} 완료", [step.title])
									}
									onCheckedChange={() =>
										void save({
											...goalInput(step),
											status: step.status === "done" ? "active" : "done",
										})
									}
								/>
								<button
									type="button"
									onClick={() => onEdit(step)}
									className="min-w-0 flex-1 text-left"
								>
									<p
										className={cn(
											"break-words text-sm leading-6",
											step.status === "done" &&
												"text-muted-foreground line-through",
										)}
									>
										{step.title}
									</p>
									{step.successCriteria ? (
										<p className="mt-1 break-words text-xs leading-5 text-muted-foreground">
											{step.successCriteria}
										</p>
									) : null}
									<p
										className={cn(
											"mt-1 text-xs",
											step.status === "active" &&
												step.targetDate &&
												step.targetDate < formatDayKey()
												? "text-amber-600 dark:text-amber-400"
												: "text-muted-foreground",
										)}
									>
										{step.targetDate || t("기한 미정")}
										{step.status === "paused"
											? ` · ${t("보류")}`
											: step.focused
												? ` · ${t("현재 단계")}`
												: ""}
									</p>
								</button>
								<GoalMenu goal={step} onEdit={onEdit} onDelete={onDelete} />
							</div>
						))}
					</div>
					{!steps.length ? (
						<button
							type="button"
							disabled={busy}
							onClick={onAdd}
							className="w-full rounded-lg border border-dashed px-3 py-3 text-left text-sm text-muted-foreground"
						>
							{t("단계 추가")}
						</button>
					) : null}
				</section>
				<div className="min-w-0">
					<WeekOutcome
						key={`${goal.id}-${goal.week?.start}-${goal.week?.outcome}`}
						goal={goal}
						disabled={busy}
					/>
					<div className="mt-5">
						<div className="mb-2 flex items-center justify-between">
							<h5 className="text-sm font-medium">
								{t("연결된 할 일")}
								<span className="ml-2 text-xs text-muted-foreground">
									{tasks.filter((item) => item.status !== "done").length}
								</span>
							</h5>
							<Button
								variant="ghost"
								size="sm"
								disabled={busy}
								onClick={() => onEdit(goal)}
							>
								{t("연결 수정")}
							</Button>
						</div>
						{tasks.length ? (
							<ul className="divide-y">
								{tasks.slice(0, 8).map((item) => (
									<li key={item.id} className="flex items-start gap-2 py-2.5">
										<Checkbox
											checked={item.status === "done"}
											className="mt-0.5"
											aria-label={
												item.status === "done"
													? t("{0} 다시 열기", [item.title])
													: t("{0} 완료", [item.title])
											}
											onCheckedChange={async () => {
												try {
													await mutateOrbit({
														data: { action: "toggle-task", id: item.id },
													});
												} catch (error) {
													toast.error(
														errorText(
															error instanceof Error
																? error.message
																: String(error),
														),
													);
												}
											}}
										/>
										<button
											type="button"
											className="min-w-0 flex-1 text-left"
											onClick={() => setTask(item)}
										>
											<span
												className={cn(
													"block break-words text-xs leading-5",
													item.status === "done" &&
														"text-muted-foreground line-through",
												)}
											>
												{item.title}
											</span>
											{item.due ? (
												<span className="mt-0.5 block text-[11px] text-muted-foreground">
													{item.due.slice(0, 10)}
												</span>
											) : null}
										</button>
									</li>
								))}
							</ul>
						) : (
							<p className="py-3 text-xs text-muted-foreground">—</p>
						)}
						{tasks.length > 8 ? (
							<Link
								to="/tasks"
								className="mt-2 block text-xs text-muted-foreground"
							>
								{t("모든 할 일 보기")}
								<ArrowUpRight className="ml-1 inline size-3" />
							</Link>
						) : null}
					</div>
				</div>
			</div>
			{goal.description ? (
				<details className="mt-5 border-t pt-3">
					<summary className="cursor-pointer text-xs text-muted-foreground">
						{t("메모")}
					</summary>
					<p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6">
						{goal.description}
					</p>
				</details>
			) : null}
			{task ? (
				<ScheduleEditor
					open
					kind="task"
					item={snapshot.items.find((item) => item.id === task.id) ?? task}
					onOpenChange={(open) => {
						if (!open) setTask(undefined);
					}}
				/>
			) : null}
		</div>
	);
}

function GoalMenu({
	goal,
	onEdit,
	onDelete,
}: {
	goal: Goal;
	onEdit: (goal: Goal) => void;
	onDelete: (goal: Goal) => void;
}) {
	const { t } = useI18n();
	const { save, busy } = useGoals();
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					size="icon-sm"
					variant="ghost"
					disabled={busy}
					aria-label={t("{0} 메뉴", [goal.title])}
				>
					<Ellipsis className="size-4" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuItem onClick={() => onEdit(goal)}>
					<Pencil />
					{t("목표 수정")}
				</DropdownMenuItem>
				{goal.status === "active" ? (
					<DropdownMenuItem
						onClick={() =>
							void save({ ...goalInput(goal), focused: !goal.focused })
						}
					>
						<Flag />
						{goal.focused
							? t("집중 해제")
							: goal.parentId
								? t("현재 단계로 설정")
								: t("집중 목표로 설정")}
					</DropdownMenuItem>
				) : null}
				{(["active", "paused", "done"] as const)
					.filter((status) => status !== goal.status)
					.map((status) => (
						<DropdownMenuItem
							key={status}
							onClick={() => void save({ ...goalInput(goal), status })}
						>
							{status === "done" ? <Check /> : <Circle />}
							{t(filterLabels[status])}
						</DropdownMenuItem>
					))}
				<DropdownMenuSeparator />
				<DropdownMenuItem
					className="text-destructive"
					onClick={() => onDelete(goal)}
				>
					<Trash2 />
					{t("삭제")}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function DeleteGoal({ goal, onClose }: { goal: Goal; onClose: () => void }) {
	const { t } = useI18n();
	const { remove, busy } = useGoals();
	const [name, setName] = useState("");
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !busy) onClose();
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t("목표를 삭제할까요?")}</DialogTitle>
					<DialogDescription>
						{t(
							"“{0}”과 세부 목표가 삭제됩니다. 연결된 프로젝트와 할 일은 유지됩니다.",
							[goal.title],
						)}
					</DialogDescription>
				</DialogHeader>
				<label htmlFor="delete-goal-confirm" className="text-sm">
					{t("확인을 위해 목표 이름을 입력하세요.")}
				</label>
				<Input
					id="delete-goal-confirm"
					value={name}
					onChange={(event) => setName(event.target.value)}
					autoComplete="off"
				/>
				<div className="flex justify-end gap-2">
					<Button variant="ghost" disabled={busy} onClick={onClose}>
						{t("취소")}
					</Button>
					<Button
						variant="destructive"
						disabled={busy || name !== goal.title}
						onClick={async () => {
							if (await remove(goal)) onClose();
						}}
					>
						{t("삭제")}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
