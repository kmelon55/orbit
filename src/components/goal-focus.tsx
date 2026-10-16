import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Flag, Plus, Target } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import type { Goal } from "#/lib/orbit/assistant-schema";
import { mutateOrbit } from "#/lib/orbit/functions";
import { focusedGoal, goalInput, goalWeekStart } from "#/lib/orbit/goals";
import { formatDayKey } from "#/lib/orbit/para";
import { cn } from "#/lib/utils";
import { useGoals } from "./goal-provider";
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
import { Input } from "./ui/input";

export function GoalFocus() {
	const { t, errorText } = useI18n();
	const { goals, loading, error, reload } = useGoals();
	const snapshot = useOrbitSnapshot();
	const goal = focusedGoal(goals);
	const [picking, setPicking] = useState(false);
	const [editing, setEditing] = useState<string | null>(null);
	const day = formatDayKey();
	const child =
		goal &&
		goals.find(
			(g) => g.parentId === goal.id && g.focused && g.status === "active",
		);
	const tasks =
		goal?.today?.date === day
			? goal.today.itemIds.flatMap((id) => {
					const item = snapshot.items.find(
						(item) =>
							item.id === id &&
							item.type === "task" &&
							item.space !== "archive" &&
							item.status !== "cancelled",
					);
					return item ? [item] : [];
				})
			: [];
	const editTask = snapshot.items.find((item) => item.id === editing);
	if (loading) return null;
	if (error)
		return (
			<button
				type="button"
				onClick={() => void reload()}
				className="mb-5 text-sm text-muted-foreground"
			>
				{t("목표를 불러오지 못했습니다. 다시 시도")}
			</button>
		);
	if (!goal)
		return (
			<Link
				to="/goals"
				className="mb-5 flex items-center gap-2 rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground transition-colors hover:bg-muted/50"
			>
				<Target className="size-4" />
				{t("집중할 목표 정하기")}
				<ArrowUpRight className="ml-auto size-4" />
			</Link>
		);
	return (
		<section className="mb-5 rounded-xl border border-primary/15 bg-background p-4 sm:mb-6 sm:p-5">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-primary">
						<Flag className="size-3" />
						{t("현재 집중")}
					</p>
					<Link
						to="/goals"
						className="break-words text-base font-semibold hover:underline"
					>
						{goal.title}
					</Link>
					{child ? (
						<p className="mt-1 text-xs text-muted-foreground">{child.title}</p>
					) : null}
				</div>
				<Link
					to="/goals"
					aria-label={t("목표 보기")}
					className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
				>
					<ArrowUpRight className="size-4" />
				</Link>
			</div>
			{goal.week?.start === goalWeekStart(day) && goal.week.outcome ? (
				<p className="mt-3 break-words text-sm">
					<span className="mr-2 text-muted-foreground">{t("이번 주")}</span>
					{goal.week.outcome}
				</p>
			) : null}
			<div className="mt-4 border-t border-border/60 pt-3">
				<div className="flex items-center justify-between">
					<span className="text-xs font-medium text-muted-foreground">
						{t("오늘의 핵심")}{" "}
						{tasks.length > 0
							? `· ${tasks.filter((item) => item.status === "done").length}/${tasks.length}`
							: ""}
					</span>
					<Button variant="ghost" size="sm" onClick={() => setPicking(true)}>
						{tasks.length ? (
							t("변경")
						) : (
							<>
								<Plus className="size-3" />
								{t("할 일 선택")}
							</>
						)}
					</Button>
				</div>
				{tasks.length > 0 ? (
					<div className="mt-1 space-y-1">
						{tasks.map((task) => (
							<div key={task.id} className="flex items-center gap-2.5 py-1.5">
								<Checkbox
									checked={task.status === "done"}
									aria-label={
										task.status === "done"
											? t("{0} 다시 열기", [task.title])
											: t("{0} 완료", [task.title])
									}
									onCheckedChange={async () => {
										try {
											await mutateOrbit({
												data: { action: "toggle-task", id: task.id },
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
									onClick={() => setEditing(task.id)}
									className={cn(
										"min-w-0 text-left text-sm",
										task.status === "done" &&
											"text-muted-foreground line-through",
									)}
								>
									{task.title}
								</button>
							</div>
						))}
					</div>
				) : (
					<p className="mt-1 text-sm text-muted-foreground">
						{t("오늘 먼저 할 일 하나를 골라보세요.")}
					</p>
				)}
			</div>
			{picking ? (
				<GoalTaskPicker goal={goal} onClose={() => setPicking(false)} />
			) : null}
			{editTask ? (
				<ScheduleEditor
					open
					kind="task"
					item={editTask}
					onOpenChange={(open) => {
						if (!open) setEditing(null);
					}}
				/>
			) : null}
		</section>
	);
}

export function GoalTaskPicker({
	goal,
	onClose,
}: {
	goal: Goal;
	onClose: () => void;
}) {
	const { t } = useI18n();
	const { save, busy, goals } = useGoals();
	const snapshot = useOrbitSnapshot();
	const day = formatDayKey();
	const fieldId = useId();
	const available = snapshot.items.filter(
		(item) =>
			item.type === "task" &&
			item.space !== "archive" &&
			item.status !== "cancelled",
	);
	const [ids, setIds] = useState(() =>
		goal.today?.date === day
			? goal.today.itemIds.filter((id) =>
					available.some((item) => item.id === id),
				)
			: [],
	);
	const [query, setQuery] = useState("");
	const related = [goal, ...goals.filter((g) => g.parentId === goal.id)];
	function linked(item: (typeof available)[number]) {
		return related.some(
			(g) =>
				g.itemIds.includes(item.id) ||
				g.projectFolders.some(
					(folder) =>
						item.project === folder ||
						(item.space === "project" &&
							(item.folder === folder ||
								item.folder?.startsWith(`${folder}/`))),
				),
		);
	}
	const tasks = available
		.filter(
			(item) =>
				(item.status !== "done" || ids.includes(item.id)) &&
				item.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
		)
		.sort((a, b) => Number(linked(b)) - Number(linked(a)));
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !busy) onClose();
			}}
		>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>{t("오늘의 핵심")}</DialogTitle>
					<DialogDescription>
						{t("먼저 할 일 하나, 많아도 세 개만 선택하세요.")}
					</DialogDescription>
				</DialogHeader>
				<Input
					aria-label={t("할 일 검색")}
					placeholder={t("할 일 검색")}
					value={query}
					onChange={(e) => setQuery(e.target.value)}
				/>
				<div className="max-h-[45dvh] space-y-1 overflow-y-auto">
					{tasks.slice(0, 100).map((item) => (
						<label
							key={item.id}
							htmlFor={`${fieldId}-${item.id}`}
							className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2.5 hover:bg-muted/60"
						>
							<Checkbox
								className="mt-0.5"
								id={`${fieldId}-${item.id}`}
								checked={ids.includes(item.id)}
								disabled={busy || (!ids.includes(item.id) && ids.length >= 3)}
								onCheckedChange={(checked) =>
									setIds((values) =>
										checked
											? [...values, item.id]
											: values.filter((id) => id !== item.id),
									)
								}
							/>
							<span className="min-w-0 text-sm">
								{item.title}
								{linked(item) ? (
									<span className="mt-1 block text-xs text-muted-foreground">
										{t("목표에 연결됨")}
									</span>
								) : null}
							</span>
						</label>
					))}
					{tasks.length === 0 ? (
						<p className="py-8 text-center text-sm text-muted-foreground">
							{t("선택할 할 일이 없습니다.")}
						</p>
					) : null}
				</div>
				<div className="flex items-center justify-between">
					<span className="text-xs tabular-nums text-muted-foreground">
						{ids.length} / 3
					</span>
					<Button
						disabled={busy}
						onClick={async () => {
							if (
								await save({
									...goalInput(goal),
									today: { date: day, itemIds: ids },
								})
							)
								onClose();
						}}
					>
						{t("저장")}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
