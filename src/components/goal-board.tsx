import {
	ArrowRight,
	Check,
	ChevronLeft,
	ChevronRight,
	Flag,
	Pause,
	Plus,
	Trophy,
	X,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { Goal } from "#/lib/orbit/assistant-schema";
import {
	goalCalendarDays,
	goalCalendarEntries,
	shiftGoalMonth,
} from "#/lib/orbit/goal-calendar";
import {
	type GoalProjectGroup,
	goalMapProgress,
} from "#/lib/orbit/goal-portfolio";
import { goalWeekStart } from "#/lib/orbit/goals";
import { formatDayKey } from "#/lib/orbit/para";
import { cn } from "#/lib/utils";
import { GoalMetricSummary } from "./goal-metric";
import { useI18n } from "./locale-provider";
import { Button } from "./ui/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "./ui/collapsible";
import { Input } from "./ui/input";

const colors = ["#8b8ef8", "#38bca2", "#e5a654", "#dd82b2", "#63a9e6"];
const lightColors = ["#6562c7", "#147d68", "#986117", "#b0447b", "#2875af"];
export function projectColor(key: string, light = false) {
	let hash = 0;
	for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
	return (light ? lightColors : colors)[hash % colors.length];
}
const focusStyle =
	"outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
export type BoardProps = {
	groups: GoalProjectGroup[];
	goals: Goal[];
	busy: boolean;
	onOpen: (goal: Goal) => void;
	onCreateStep: (goal: Goal, title: string, date: string) => Promise<boolean>;
	onEdit: (goal: Goal) => void;
	onToggle: (goal: Goal) => void;
};

export function GoalLane({
	goal,
	steps,
	color,
	busy,
	onOpen,
	onEdit,
	onToggle,
	onCreateStep,
	endpointLabel,
}: BoardProps & {
	goal: Goal;
	steps: Goal[];
	color: string;
	endpointLabel?: string;
}) {
	const { t } = useI18n();
	const [adding, setAdding] = useState(false);
	const addButton = useRef<HTMLButtonElement>(null);
	const { completed: done, nextMilestoneId } = goalMapProgress(goal, steps);
	const next = steps.find((step) => step.id === nextMilestoneId);
	const today = formatDayKey();
	const week =
		goal.week?.start === goalWeekStart(today) ? goal.week.outcome : "";
	function closeComposer() {
		setAdding(false);
		addButton.current?.focus();
	}
	return (
		<Collapsible open={adding} onOpenChange={setAdding} asChild>
			<article className="border-t border-border/60">
				<div className="grid gap-5 px-5 py-5 lg:grid-cols-[210px_minmax(0,1fr)]">
					<div className="min-w-0">
						<button
							type="button"
							onClick={() => onOpen(goal)}
							className={cn(
								"group flex w-full items-start gap-3 rounded-md text-left",
								focusStyle,
							)}
						>
							<ProgressRing
								done={done}
								total={steps.length}
								complete={goal.status === "done"}
								color={color}
							/>
							<div className="min-w-0 pt-1">
								<h4
									className="line-clamp-2 break-words text-sm font-semibold leading-5 group-hover:underline"
									title={goal.title}
								>
									{goal.title}
								</h4>
								<div className="mt-1.5 text-[11px] text-muted-foreground">
									{goal.status === "done"
										? t("목표 달성")
										: goal.status === "paused"
											? t("보류")
											: steps.length
												? t("{0}/{1} 단계 완료", [done, steps.length])
												: t("진행 중")}
								</div>
							</div>
						</button>
						{goal.metric ? (
							<button
								type="button"
								disabled={busy}
								onClick={() => onEdit(goal)}
								aria-label={t("현재 수치 수정")}
								className={cn(
									"mt-3 ml-[60px] rounded text-left text-base font-semibold tabular-nums hover:underline",
									focusStyle,
								)}
							>
								<span className="mb-1 block text-xs font-normal text-muted-foreground">
									{t("실제 성과")}
								</span>
								<GoalMetricSummary goal={goal} />
							</button>
						) : null}
					</div>
					<div className="min-w-0 overflow-x-auto px-1 pt-1 pb-2">
						<div className="flex min-w-full items-start">
							{steps.map((step, index) => (
								<StageNode
									key={step.id}
									step={step}
									index={index}
									current={next?.id === step.id}
									busy={busy}
									onEdit={onEdit}
									onToggle={onToggle}
								/>
							))}
							<div
								className={cn(
									"relative flex-1",
									steps.length ? "min-w-20" : "min-w-[160px]",
								)}
							>
								<div
									aria-hidden="true"
									className="absolute left-4 right-0 top-4 border-t border-dashed border-border"
								/>
								<CollapsibleTrigger asChild>
									<button
										ref={addButton}
										type="button"
										disabled={busy}
										className={cn(
											"group relative rounded-md text-left text-muted-foreground hover:text-foreground disabled:opacity-50",
											focusStyle,
										)}
									>
										<span
											className={cn(
												"mb-2.5 flex size-8 items-center justify-center rounded-full border border-dashed bg-card transition-colors group-hover:border-[var(--goal-color)] group-hover:text-[var(--goal-color)]",
												!steps.length &&
													"border-[var(--goal-color)]/50 text-[var(--goal-color)]",
											)}
										>
											<Plus
												className={cn(
													"size-4 motion-safe:transition-transform motion-safe:duration-200",
													adding && "rotate-45",
												)}
											/>
										</span>
										<span className="pr-3 text-xs">
											{t(steps.length ? "단계 추가" : "첫 단계")}
										</span>
									</button>
								</CollapsibleTrigger>
							</div>
							<button
								type="button"
								disabled={busy || goal.status === "paused"}
								aria-pressed={
									endpointLabel ? goal.status === "done" : undefined
								}
								aria-label={
									endpointLabel
										? t(goal.status === "done" ? "{0} 다시 열기" : "{0} 완료", [
												goal.title,
											])
										: undefined
								}
								onClick={() => (endpointLabel ? onToggle(goal) : onOpen(goal))}
								className={cn(
									"relative min-w-[100px] max-w-[150px] rounded-md text-left",
									focusStyle,
								)}
							>
								<span
									className={cn(
										"mb-2.5 flex size-8 items-center justify-center rounded-full border",
										goal.status === "done"
											? "border-amber-400/40 bg-amber-400/15 text-amber-500"
											: done > 0 && done === steps.length
												? "border-[var(--goal-color)]/50 bg-[var(--goal-color)]/10 text-[var(--goal-color)]"
												: "border-border bg-muted/50 text-muted-foreground",
									)}
								>
									<Trophy className="size-4" />
								</span>
								<span className="block text-xs font-medium">
									{goal.status === "done"
										? t("목표 달성")
										: (endpointLabel ?? t("최종 목표"))}
								</span>
								<span className="mt-1.5 block text-[11px] text-muted-foreground">
									{goal.targetDate || t("기한 미정")}
								</span>
								{goal.targetDate && goal.status === "active" ? (
									<Deadline date={goal.targetDate} today={today} />
								) : null}
							</button>
						</div>
					</div>
				</div>
				<CollapsibleContent className="orbit-goal-disclosure">
					<StageComposer
						busy={busy}
						onClose={closeComposer}
						onSave={async (title, date) => {
							const saved = await onCreateStep(goal, title, date);
							if (saved) closeComposer();
						}}
					/>
				</CollapsibleContent>
				{week ? (
					<button
						type="button"
						onClick={() => onOpen(goal)}
						className={cn(
							"flex w-full items-center gap-3 border-t border-border/50 bg-muted/15 px-5 py-2.5 text-left text-xs hover:bg-muted/30",
							focusStyle,
						)}
					>
						<span className="shrink-0 text-muted-foreground">
							{t("이번 주")}
						</span>
						<span className="truncate">{week}</span>
						<ArrowRight className="ml-auto size-3.5 shrink-0 text-muted-foreground" />
					</button>
				) : null}
			</article>
		</Collapsible>
	);
}

export function StageNode({
	step,
	index,
	current,
	busy,
	onEdit,
	onToggle,
}: {
	step: Goal;
	index: number;
	current: boolean;
	busy: boolean;
	onEdit: (goal: Goal) => void;
	onToggle: (goal: Goal) => void;
}) {
	const { t } = useI18n();
	const complete = step.status === "done";
	const paused = step.status === "paused";
	return (
		<div className="relative min-w-[136px] flex-1 pr-4">
			<div
				aria-hidden="true"
				className={cn(
					"absolute left-4 right-0 top-4 h-[2px] transition-colors",
					complete ? "bg-[var(--goal-color)]/60" : "bg-border",
				)}
			/>
			<button
				type="button"
				disabled={busy || paused}
				aria-pressed={complete}
				aria-label={
					complete
						? t("{0} 다시 열기", [step.title])
						: t("{0} 완료", [step.title])
				}
				title={
					complete
						? t("{0} 다시 열기", [step.title])
						: t("{0} 완료", [step.title])
				}
				onClick={() => onToggle(step)}
				className={cn(
					"group relative mb-2.5 flex size-8 items-center justify-center rounded-full border text-xs font-semibold transition-colors disabled:cursor-default",
					focusStyle,
					complete
						? "border-[var(--goal-color)] bg-[var(--goal-color)] text-background"
						: current
							? "border-[var(--goal-color)] bg-card text-[var(--goal-color)] ring-4 ring-[var(--goal-color)]/10"
							: "border-border bg-card text-muted-foreground hover:border-[var(--goal-color)]",
					busy && "opacity-60",
				)}
			>
				{complete ? (
					<Check
						key="complete"
						className="size-4 motion-safe:animate-in motion-safe:zoom-in motion-safe:duration-200"
					/>
				) : paused ? (
					<Pause className="size-3" />
				) : (
					<>
						<span className="group-hover:hidden group-focus-visible:hidden">
							{index + 1}
						</span>
						<Check className="hidden size-4 group-hover:block group-focus-visible:block" />
					</>
				)}
			</button>
			<button
				type="button"
				disabled={busy}
				onClick={() => onEdit(step)}
				className={cn("relative block w-full rounded text-left", focusStyle)}
				title={step.title}
			>
				<span
					className={cn(
						"line-clamp-2 max-w-[180px] break-words text-xs leading-5",
						complete || paused ? "text-muted-foreground" : "text-foreground",
						current && "font-semibold",
					)}
				>
					{step.title}
				</span>
				<span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
					{current ? (
						<span className="rounded bg-[var(--goal-color)]/10 px-1.5 py-0.5 font-medium text-[var(--goal-color)]">
							{t("다음 단계")}
						</span>
					) : paused ? (
						<span>{t("보류")}</span>
					) : null}
					{step.targetDate ? (
						<time
							dateTime={step.targetDate}
							className={cn(
								step.status === "active" &&
									step.targetDate < formatDayKey() &&
									"text-amber-600 dark:text-amber-400",
							)}
						>
							{step.targetDate.slice(5).replace("-", "/")}
						</time>
					) : null}
				</span>
			</button>
		</div>
	);
}

export function StageComposer({
	busy,
	onSave,
	onClose,
}: {
	busy: boolean;
	onSave: (title: string, date: string) => Promise<void>;
	onClose: () => void;
}) {
	const { t } = useI18n();
	const [title, setTitle] = useState("");
	const [date, setDate] = useState("");
	const pending = useRef(false);
	const id = useId();
	const titleInput = useRef<HTMLInputElement>(null);
	useEffect(() => {
		titleInput.current?.focus();
	}, []);
	return (
		<form
			onSubmit={async (event) => {
				event.preventDefault();
				if (!title.trim() || pending.current || busy) return;
				pending.current = true;
				try {
					await onSave(title.trim(), date);
				} finally {
					pending.current = false;
				}
			}}
			onKeyDown={(event) => {
				if (event.key === "Escape" && !pending.current && !busy) {
					event.preventDefault();
					onClose();
				}
			}}
			className="flex flex-wrap items-end gap-2 border-t border-border/60 bg-muted/15 px-5 py-3"
		>
			<label
				htmlFor={`${id}-title`}
				className="grid min-w-[180px] flex-1 gap-1.5 text-[11px] text-muted-foreground"
			>
				{t("단계 이름")}
				<Input
					id={`${id}-title`}
					ref={titleInput}
					value={title}
					maxLength={160}
					onChange={(event) => setTitle(event.target.value)}
					disabled={busy}
					required
				/>
			</label>
			<label
				htmlFor={`${id}-date`}
				className="grid gap-1.5 text-[11px] text-muted-foreground"
			>
				{t("기한")}
				<Input
					id={`${id}-date`}
					type="date"
					value={date}
					onChange={(event) => setDate(event.target.value)}
					disabled={busy}
					className="w-36"
				/>
			</label>
			<Button type="submit" size="sm" disabled={busy || !title.trim()}>
				{t("추가")}
			</Button>
			<Button
				type="button"
				size="icon-sm"
				variant="ghost"
				disabled={busy}
				aria-label={t("취소")}
				onClick={onClose}
			>
				<X className="size-4" />
			</Button>
		</form>
	);
}

function Deadline({ date, today }: { date: string; today: string }) {
	const { t } = useI18n();
	const days = Math.round(
		(Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
			86400000,
	);
	return (
		<span
			className={cn(
				"mt-1.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
				days < 0
					? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
					: days <= 7
						? "bg-[var(--goal-color)]/10 text-[var(--goal-color)]"
						: "bg-muted text-muted-foreground",
			)}
		>
			{days < 0
				? t("{0}일 지남", [-days])
				: days === 0
					? t("오늘")
					: t("{0}일 남음", [days])}
		</span>
	);
}

export function ProgressRing({
	done,
	total,
	complete,
	color,
}: {
	done: number;
	total: number;
	complete: boolean;
	color: string;
}) {
	const { t } = useI18n();
	const progress = total ? done / total : 0;
	return (
		<span
			role="img"
			aria-label={
				complete ? t("목표 달성") : t("{0}/{1} 단계 완료", [done, total])
			}
			className="relative flex size-12 shrink-0 items-center justify-center"
		>
			<svg
				viewBox="0 0 48 48"
				className="absolute inset-0 size-12 -rotate-90"
				aria-hidden="true"
			>
				<circle
					cx="24"
					cy="24"
					r="20"
					fill="none"
					stroke="currentColor"
					strokeWidth="3"
					className="text-muted"
				/>
				<circle
					cx="24"
					cy="24"
					r="20"
					fill="none"
					stroke={color}
					strokeWidth="3"
					strokeLinecap="round"
					pathLength="100"
					strokeDasharray={`${(complete ? 1 : progress) * 100} 100`}
					opacity={complete || done ? 1 : 0}
					className="motion-safe:transition-all motion-safe:duration-500"
				/>
			</svg>
			{complete ? (
				<Trophy className="size-4" style={{ color }} />
			) : total ? (
				<span className="text-xs font-semibold tabular-nums" style={{ color }}>
					{Math.round(progress * 100)}
					<span className="text-[8px]">%</span>
				</span>
			) : (
				<Flag className="size-4" style={{ color }} />
			)}
		</span>
	);
}

export function GoalCalendar({
	groups,
	goals,
	onOpen,
}: Pick<BoardProps, "groups" | "goals" | "onOpen">) {
	const { t, intlLocale } = useI18n();
	const today = formatDayKey();
	const [month, setMonth] = useState(today.slice(0, 7));
	const days = goalCalendarDays(month);
	const entries = goalCalendarEntries(
		groups.flatMap((group) => group.goals),
		goals,
	);
	const undated = entries.filter((entry) => !entry.goal.targetDate);
	const color = (root: Goal) =>
		projectColor(
			groups.find((group) => group.goals.some((goal) => goal.id === root.id))
				?.key ?? root.id,
		);
	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<h3 className="text-base font-semibold">
					{new Date(`${month}-01T12:00:00`).toLocaleDateString(intlLocale, {
						year: "numeric",
						month: "long",
					})}
				</h3>
				<div className="flex items-center gap-1">
					<Button
						size="icon-sm"
						variant="ghost"
						aria-label={t("이전 달")}
						onClick={() => setMonth(shiftGoalMonth(month, -1))}
					>
						<ChevronLeft />
					</Button>
					<Button
						size="sm"
						variant="ghost"
						onClick={() => setMonth(today.slice(0, 7))}
					>
						{t("오늘")}
					</Button>
					<Button
						size="icon-sm"
						variant="ghost"
						aria-label={t("다음 달")}
						onClick={() => setMonth(shiftGoalMonth(month, 1))}
					>
						<ChevronRight />
					</Button>
				</div>
			</div>
			<div className="overflow-x-auto rounded-xl border">
				<div className="min-w-[560px]">
					<div className="grid grid-cols-7 border-b bg-muted/20">
						{days.slice(0, 7).map((day) => (
							<div
								key={day}
								className="px-3 py-2 text-xs text-muted-foreground"
							>
								{new Date(`${day}T12:00:00`).toLocaleDateString(intlLocale, {
									weekday: "short",
								})}
							</div>
						))}
					</div>
					<div className="grid grid-cols-7">
						{days.map((day) => (
							<div
								key={day}
								className={cn(
									"min-h-28 border-b border-r border-border/60 p-2 [&:nth-child(7n)]:border-r-0",
									!day.startsWith(month) && "bg-muted/20 text-muted-foreground",
									day === today && "bg-primary/[0.04]",
								)}
							>
								<time
									dateTime={day}
									className={cn(
										"mb-2 flex size-6 items-center justify-center rounded-full text-xs tabular-nums",
										day === today &&
											"bg-primary font-semibold text-primary-foreground",
									)}
								>
									{Number(day.slice(8))}
								</time>
								<div className="space-y-1">
									{entries
										.filter((entry) => entry.goal.targetDate === day)
										.map(({ goal, root }) => (
											<button
												key={goal.id}
												type="button"
												onClick={() => onOpen(root)}
												title={`${root.projectName ?? root.brand ?? ""} · ${goal.title}`}
												className={cn(
													"flex w-full items-start gap-1.5 rounded border-l-2 bg-muted/70 px-1.5 py-1 text-left text-[11px] leading-4 hover:bg-muted",
													goal.status === "done" && "text-muted-foreground",
													goal.status === "paused" && "opacity-60",
												)}
												style={{ borderLeftColor: color(root) }}
											>
												{goal.status === "done" ? (
													<Check className="mt-0.5 size-3 shrink-0 text-emerald-500" />
												) : !goal.parentId ? (
													<Flag className="mt-0.5 size-3 shrink-0" />
												) : null}
												<span className="line-clamp-2 break-words">
													{goal.title}
												</span>
											</button>
										))}
								</div>
							</div>
						))}
					</div>
				</div>
			</div>
			{undated.length ? (
				<div className="flex flex-wrap items-center gap-2">
					<span className="mr-1 text-xs text-muted-foreground">
						{t("기한 미정")}
					</span>
					{undated.map(({ goal, root }) => (
						<button
							type="button"
							key={goal.id}
							onClick={() => onOpen(root)}
							className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs hover:bg-muted"
						>
							<span
								className="size-1.5 rounded-full"
								style={{ background: color(root) }}
							/>
							{goal.title}
						</button>
					))}
				</div>
			) : null}
		</div>
	);
}
