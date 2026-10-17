import { Link } from "@tanstack/react-router";
import {
	ArrowLeft,
	ArrowUpRight,
	Check,
	ChevronRight,
	Ellipsis,
	Flag,
	Pencil,
	Plus,
	Target,
	Trash2,
} from "lucide-react";
import { useState } from "react";
import type { Goal } from "#/lib/orbit/assistant-schema";
import {
	focusedGoal,
	goalInput,
	goalPercent,
	goalWeekStart,
} from "#/lib/orbit/goals";
import { formatDayKey } from "#/lib/orbit/para";
import { cn } from "#/lib/utils";
import { GoalEditor } from "./goal-editor";
import { useGoals } from "./goal-provider";
import { useI18n } from "./locale-provider";
import { useOrbitSnapshot } from "./orbit-snapshot-provider";
import { Button } from "./ui/button";
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

const statusLabels = {
	active: "진행 중",
	paused: "보류",
	done: "완료",
} as const;

export function GoalWorkspace() {
	const { t, errorText } = useI18n();
	const state = useGoals();
	const [selectedId, setSelectedId] = useState<string>();
	const [mobileDetail, setMobileDetail] = useState(false);
	const [status, setStatus] = useState<Goal["status"]>("active");
	const [editor, setEditor] = useState<{ goal?: Goal; parent?: Goal } | null>(
		null,
	);
	const [deleting, setDeleting] = useState<Goal | null>(null);
	const goals = state.goals;
	const roots = goals
		.filter((g) => !g.parentId && g.status === status)
		.sort(
			(a, b) =>
				Number(Boolean(b.focused)) - Number(Boolean(a.focused)) ||
				b.createdAt.localeCompare(a.createdAt),
		);
	const selected = roots.find((g) => g.id === selectedId) ?? roots[0];
	function create() {
		setEditor({});
	}
	function edit(goal: Goal) {
		setEditor({ goal });
	}
	return (
		<div className="h-full overflow-y-auto bg-background">
			<div className="mx-auto max-w-6xl px-4 py-6 sm:px-7 lg:px-10 lg:py-9">
				<header className="mb-7 flex items-center justify-between gap-4">
					<div>
						<h2 className="text-2xl font-semibold tracking-tight">
							{t("Goals")}
						</h2>
						<p className="mt-1.5 text-sm text-muted-foreground">
							{t("이루고 싶은 결과에 집중하세요.")}
						</p>
					</div>
					<Button onClick={create} disabled={state.loading || state.busy}>
						<Plus className="size-4" />
						{t("새 목표")}
					</Button>
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
				{state.loading ? (
					<output
						className="block h-60 animate-pulse rounded-2xl bg-muted/40"
						aria-label={t("불러오는 중…")}
					/>
				) : !state.goals.length ? (
					<div className="flex min-h-[420px] flex-col items-center justify-center rounded-2xl border border-dashed px-6 text-center">
						<div className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-muted">
							<Target className="size-6 text-muted-foreground" />
						</div>
						<h3 className="text-lg font-medium">
							{t("지금 가장 이루고 싶은 것 하나")}
						</h3>
						<p className="mt-2 max-w-xs text-sm leading-6 text-muted-foreground">
							{t("목표를 정하고, 작은 단계로 나누어 시작하세요.")}
						</p>
						<div className="mt-6 flex gap-2">
							<Button onClick={create}>
								<Plus />
								{t("첫 목표 만들기")}
							</Button>
						</div>
					</div>
				) : (
					<div className="grid min-h-[480px] gap-6 md:grid-cols-[230px_minmax(0,1fr)] lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-9">
						<aside
							className={cn(
								"min-w-0 md:border-r md:pr-6",
								mobileDetail && "hidden md:block",
							)}
						>
							<div className="mb-4 flex gap-1 rounded-lg bg-muted/60 p-1">
								{(["active", "paused", "done"] as const).map((value) => (
									<button
										type="button"
										key={value}
										onClick={() => {
											setStatus(value);
											setSelectedId(undefined);
										}}
										aria-pressed={status === value}
										className={cn(
											"flex-1 rounded-md px-2 py-1.5 text-xs transition-colors",
											status === value
												? "bg-background font-medium shadow-sm"
												: "text-muted-foreground hover:text-foreground",
										)}
									>
										{t(statusLabels[value])}
									</button>
								))}
							</div>
							<div className="space-y-2">
								{roots.map((goal) => (
									<button
										key={goal.id}
										type="button"
										aria-pressed={selected?.id === goal.id}
										onClick={() => {
											setSelectedId(goal.id);
											setMobileDetail(true);
										}}
										className={cn(
											"w-full rounded-xl border px-3.5 py-3.5 text-left transition-colors",
											selected?.id === goal.id
												? "border-primary/15 bg-primary/[0.04]"
												: "border-transparent hover:bg-muted/50",
										)}
									>
										{goal.focused && goal.status === "active" ? (
											<span className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-primary">
												<Flag className="size-3" />
												{t("현재 집중")}
											</span>
										) : null}
										<span className="block break-words text-sm font-medium leading-6">
											{goal.title}
										</span>
										{goal.metric ? (
											<div className="mt-3">
												<GoalProgress goal={goal} />
												<span className="mt-1.5 block text-xs tabular-nums text-muted-foreground">
													{goal.metric.current === null
														? t("미측정")
														: goal.metric.current.toLocaleString()}{" "}
													/ {goal.metric.target.toLocaleString()}{" "}
													{goal.metric.unit}
												</span>
											</div>
										) : (
											<span className="mt-2 block text-xs text-muted-foreground">
												{t("세부 목표 {0} / {1}", [
													goals.filter(
														(g) =>
															g.parentId === goal.id && g.status === "done",
													).length,
													goals.filter((g) => g.parentId === goal.id).length,
												])}
											</span>
										)}
									</button>
								))}
								{roots.length === 0 ? (
									<p className="px-2 py-10 text-center text-sm text-muted-foreground">
										{t("목표가 없습니다.")}
									</p>
								) : null}
							</div>
						</aside>
						<div className={cn("min-w-0", !mobileDetail && "hidden md:block")}>
							<Button
								variant="ghost"
								size="sm"
								className="mb-3 -ml-2 md:hidden"
								onClick={() => setMobileDetail(false)}
							>
								<ArrowLeft />
								{t("목표 목록")}
							</Button>
							{selected ? (
								<GoalDetail
									key={selected.id}
									goal={selected}
									goals={goals}
									onEdit={edit}
									onAdd={() => setEditor({ parent: selected })}
									onDelete={setDeleting}
								/>
							) : (
								<div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
									{t("새로운 목표를 정해보세요.")}
								</div>
							)}
						</div>
					</div>
				)}
			</div>
			{editor ? (
				<GoalEditor
					{...editor}
					onClose={() => setEditor(null)}
					onSaved={(id) => {
						setSelectedId(id);
						setMobileDetail(true);
						const goal = state.goals.find((g) => g.id === id);
						setStatus(goal?.status ?? "active");
					}}
				/>
			) : null}
			{deleting ? (
				<Dialog
					open
					onOpenChange={(open) => {
						if (!open && !state.busy) setDeleting(null);
					}}
				>
					<DialogContent className="sm:max-w-sm">
						<DialogHeader>
							<DialogTitle>{t("목표를 삭제할까요?")}</DialogTitle>
							<DialogDescription>
								{t(
									"“{0}”과 세부 목표가 삭제됩니다. 연결된 프로젝트와 할 일은 유지됩니다.",
									[deleting.title],
								)}
							</DialogDescription>
						</DialogHeader>
						<div className="flex justify-end gap-2">
							<Button
								variant="ghost"
								disabled={state.busy}
								onClick={() => setDeleting(null)}
							>
								{t("취소")}
							</Button>
							<Button
								variant="destructive"
								disabled={state.busy}
								onClick={async () => {
									if (await state.remove(deleting)) setDeleting(null);
								}}
							>
								{t("삭제")}
							</Button>
						</div>
					</DialogContent>
				</Dialog>
			) : null}
		</div>
	);
}

export function GoalProgress({ goal }: { goal: Goal }) {
	const { t } = useI18n();
	const percent = goalPercent(goal);
	if (percent === null) return null;
	return (
		<div
			role="progressbar"
			aria-label={t("목표 성과")}
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={Math.round(percent)}
			className="h-1.5 overflow-hidden rounded-full bg-primary/10"
		>
			<div
				className="h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none"
				style={{ width: `${percent}%` }}
			/>
		</div>
	);
}

function GoalDetail({
	goal,
	goals,
	onEdit,
	onAdd,
	onDelete,
}: {
	goal: Goal;
	goals: Goal[];
	onEdit: (goal: Goal) => void;
	onAdd: () => void;
	onDelete: (goal: Goal) => void;
}) {
	const { t } = useI18n();
	const { save, busy } = useGoals();
	const snapshot = useOrbitSnapshot();
	const children = goals
		.filter((g) => g.parentId === goal.id)
		.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
	const activeFocus = focusedGoal(goals)?.id === goal.id;
	const linkedIds = new Set([goal, ...children].flatMap((g) => g.itemIds));
	const folders = new Set([goal, ...children].flatMap((g) => g.projectFolders));
	const linkedTasks = snapshot.items.filter(
		(item) =>
			item.type === "task" &&
			item.space !== "archive" &&
			item.status !== "cancelled" &&
			(linkedIds.has(item.id) ||
				[...folders].some(
					(folder) =>
						item.project === folder ||
						(item.space === "project" &&
							(item.folder === folder ||
								item.folder?.startsWith(`${folder}/`))),
				)),
	);
	return (
		<div className="space-y-7">
			<div>
				<div className="mb-3 flex items-center justify-between gap-2">
					<button
						type="button"
						disabled={busy || goal.status !== "active"}
						onClick={() =>
							void save({ ...goalInput(goal), focused: !activeFocus })
						}
						aria-pressed={activeFocus}
						className={cn(
							"inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors disabled:cursor-default",
							activeFocus
								? "border-primary/15 bg-primary/5 text-primary"
								: "border-border text-muted-foreground hover:text-foreground",
						)}
					>
						<Flag
							className="size-3"
							fill={activeFocus ? "currentColor" : "none"}
						/>
						{activeFocus ? t("현재 집중") : t("집중 목표로 설정")}
					</button>
					<div className="flex items-center gap-1">
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label={t("목표 수정")}
							disabled={busy}
							onClick={() => onEdit(goal)}
						>
							<Pencil className="size-3.5" />
						</Button>
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button
									variant="ghost"
									size="icon-sm"
									aria-label={t("목표 메뉴")}
									disabled={busy}
								>
									<Ellipsis />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								{(["active", "paused", "done"] as const)
									.filter((s) => s !== goal.status)
									.map((status) => (
										<DropdownMenuItem
											key={status}
											onClick={() => void save({ ...goalInput(goal), status })}
										>
											{t(statusLabels[status])}
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
					</div>
				</div>
				<h3 className="break-words text-2xl font-semibold leading-snug tracking-tight">
					{goal.title}
				</h3>
				{goal.successCriteria ? (
					<p className="mt-2 break-words text-sm leading-6 text-muted-foreground">
						{goal.successCriteria}
					</p>
				) : null}
				{goal.targetDate ? (
					<p className="mt-3 text-xs text-muted-foreground">
						{t("목표 기한")} · {goal.targetDate}
					</p>
				) : null}
			</div>
			{goal.metric ? (
				<div className="rounded-xl bg-muted/40 p-4 sm:p-5">
					<div className="mb-3 flex items-end justify-between gap-3">
						<div>
							<p className="mb-2 text-xs text-muted-foreground">
								{t("목표 성과")}
							</p>
							<span className="text-3xl font-semibold tabular-nums tracking-tight">
								{goal.metric.current === null
									? t("미측정")
									: goal.metric.current.toLocaleString()}
							</span>
							<span className="ml-2 text-sm text-muted-foreground">
								/ {goal.metric.target.toLocaleString()} {goal.metric.unit}
							</span>
						</div>
						<Button
							variant="ghost"
							size="sm"
							disabled={busy}
							onClick={() => onEdit(goal)}
						>
							{t("성과 갱신")}
						</Button>
					</div>
					<GoalProgress goal={goal} />
				</div>
			) : null}
			<section>
				<div className="mb-3 flex items-center justify-between">
					<h4 className="text-sm font-semibold">
						{t("세부 목표")}
						<span className="ml-2 font-normal tabular-nums text-muted-foreground">
							{children.filter((g) => g.status === "done").length}/
							{children.length}
						</span>
					</h4>
					<Button variant="ghost" size="sm" disabled={busy} onClick={onAdd}>
						<Plus className="size-3.5" />
						{t("추가")}
					</Button>
				</div>
				<div className="divide-y divide-border/60">
					{children.map((child) => (
						<div key={child.id} className="group flex items-start gap-3 py-3.5">
							<button
								type="button"
								className={cn(
									"mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors",
									child.status === "done"
										? "border-primary bg-primary text-primary-foreground"
										: "border-muted-foreground/40 hover:border-primary",
								)}
								disabled={busy}
								aria-label={
									child.status === "done"
										? t("{0} 다시 열기", [child.title])
										: t("{0} 완료", [child.title])
								}
								onClick={() =>
									void save({
										...goalInput(child),
										status: child.status === "done" ? "active" : "done",
									})
								}
							>
								{child.status === "done" ? <Check className="size-3" /> : null}
							</button>
							<button
								type="button"
								onClick={() => onEdit(child)}
								className="min-w-0 flex-1 text-left"
							>
								<span
									className={cn(
										"block break-words text-sm leading-6",
										child.status === "done" &&
											"text-muted-foreground line-through",
									)}
								>
									{child.title}
								</span>
								{child.focused && child.status === "active" ? (
									<span className="mt-1 block text-xs text-primary">
										{t("현재 집중")}
									</span>
								) : child.status === "paused" ? (
									<span className="mt-1 block text-xs text-muted-foreground">
										{t("보류")}
									</span>
								) : null}
							</button>
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label={t("{0} 메뉴", [child.title])}
										disabled={busy}
									>
										<Ellipsis className="size-4 text-muted-foreground" />
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end">
									{child.status === "active" ? (
										<DropdownMenuItem
											onClick={() =>
												void save({
													...goalInput(child),
													focused: !child.focused,
												})
											}
										>
											<Flag />
											{child.focused ? t("집중 해제") : t("현재 단계로 설정")}
										</DropdownMenuItem>
									) : null}
									<DropdownMenuItem onClick={() => onEdit(child)}>
										<Pencil />
										{t("목표 수정")}
									</DropdownMenuItem>
									<DropdownMenuItem
										className="text-destructive"
										onClick={() => onDelete(child)}
									>
										<Trash2 />
										{t("삭제")}
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						</div>
					))}
					{children.length === 0 ? (
						<button
							type="button"
							onClick={onAdd}
							disabled={busy}
							className="w-full rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground hover:bg-muted/30"
						>
							{t("첫 번째 단계를 추가하세요.")}
						</button>
					) : null}
				</div>
			</section>
			<WeekOutcome
				key={`${goal.id}-${goal.week?.start}-${goal.week?.outcome}`}
				goal={goal}
				disabled={busy}
			/>
			{goal.projectFolders.length > 0 || linkedTasks.length > 0 ? (
				<section className="border-t pt-5">
					<div className="mb-3 flex items-center justify-between">
						<h4 className="text-xs font-medium text-muted-foreground">
							{t("연결된 실행")}
						</h4>
						<Button
							variant="ghost"
							size="sm"
							onClick={() => onEdit(goal)}
							disabled={busy}
						>
							{t("연결 수정")}
						</Button>
					</div>
					<div className="flex flex-wrap gap-2">
						{goal.projectFolders.map((folder) => (
							<Link
								key={folder}
								to="/projects/$folder"
								params={{ folder }}
								className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs"
							>
								{snapshot.folders.project.find((f) => f.slug === folder)
									?.name ?? folder}
								<ArrowUpRight className="size-3" />
							</Link>
						))}
					</div>
					{linkedTasks.length > 0 ? (
						<Link
							to="/tasks"
							className="mt-3 inline-flex items-center gap-1 text-sm text-muted-foreground"
						>
							{t("할 일 {0} / {1} 완료", [
								linkedTasks.filter((task) => task.status === "done").length,
								linkedTasks.length,
							])}
							<ChevronRight className="size-3" />
						</Link>
					) : null}
				</section>
			) : null}
			{goal.description ? (
				<details className="border-t pt-4 text-sm">
					<summary className="cursor-pointer text-muted-foreground">
						{t("메모")}
					</summary>
					<p className="mt-3 whitespace-pre-wrap break-words leading-6">
						{goal.description}
					</p>
				</details>
			) : null}
		</div>
	);
}

export function WeekOutcome({
	goal,
	disabled,
}: {
	goal: Goal;
	disabled: boolean;
}) {
	const { t } = useI18n();
	const { save } = useGoals();
	const start = goalWeekStart(formatDayKey());
	const current = goal.week?.start === start;
	const [editing, setEditing] = useState(false);
	const [outcome, setOutcome] = useState(
		current ? (goal.week?.outcome ?? "") : "",
	);
	return (
		<section className="rounded-xl border border-border/80 p-4">
			<div className="flex items-center justify-between gap-2">
				<h4 className="flex items-center gap-2 text-sm font-medium">
					<Flag className="size-3.5 text-muted-foreground" />
					{t("이번 주 결과")}
				</h4>
				<Button
					variant="ghost"
					size="sm"
					disabled={disabled}
					onClick={() => setEditing(!editing)}
				>
					{editing
						? t("취소")
						: current && goal.week?.outcome
							? t("계획 수정")
							: t("정하기")}
				</Button>
			</div>
			{editing ? (
				<form
					className="mt-3 flex flex-col gap-2 sm:flex-row"
					onSubmit={async (event) => {
						event.preventDefault();
						if (
							await save({
								...goalInput(goal),
								week: { start, outcome: outcome.trim() },
							})
						)
							setEditing(false);
					}}
				>
					<Input
						autoFocus
						aria-label={t("이번 주 결과")}
						maxLength={1000}
						value={outcome}
						onChange={(e) => setOutcome(e.target.value)}
					/>
					<Button type="submit" disabled={disabled}>
						{t("저장")}
					</Button>
				</form>
			) : (
				<p
					className={cn(
						"mt-2 break-words text-sm leading-6",
						(!current || !goal.week?.outcome) && "text-muted-foreground",
					)}
				>
					{current && goal.week?.outcome ? goal.week.outcome : "—"}
				</p>
			)}
			{!current && goal.week?.outcome ? (
				<p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
					{t("이전 계획")} · {goal.week.start} · {goal.week.outcome}
				</p>
			) : null}
		</section>
	);
}
