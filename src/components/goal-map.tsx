import { ChevronDown, Flag, Plus } from "lucide-react";
import { type CSSProperties, useId, useRef, useState } from "react";
import type { Goal } from "#/lib/orbit/assistant-schema";
import {
	type GoalContribution,
	type GoalProjectGroup,
	goalContributions,
	goalMapProgress,
	goalMapRoots,
	goalMilestones,
} from "#/lib/orbit/goal-portfolio";
import { cn } from "#/lib/utils";
import {
	type BoardProps,
	GoalLane,
	ProgressRing,
	projectColor,
	StageComposer,
	StageNode,
} from "./goal-board";
import { GoalMetricSummary } from "./goal-metric";
import { useI18n } from "./locale-provider";
import { Button } from "./ui/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "./ui/collapsible";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "./ui/dropdown-menu";

type MapProps = BoardProps & {
	projectGroups: GoalProjectGroup[];
	onAddContribution: (goal: Goal, project?: GoalProjectGroup) => void;
};
const focusStyle =
	"outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function GoalMap(props: MapProps) {
	const { t } = useI18n();
	const roots = goalMapRoots(props.groups);
	return (
		<div className="space-y-5">
			{roots.map((goal) => (
				<GoalCard key={goal.id} {...props} goal={goal} />
			))}
			{!roots.length ? (
				<p className="py-8 text-center text-sm text-muted-foreground">
					{t("목표 없음")}
				</p>
			) : null}
		</div>
	);
}

function GoalCard(props: MapProps & { goal: Goal }) {
	const { t } = useI18n();
	const {
		goal,
		goals,
		projectGroups,
		busy,
		onOpen,
		onEdit,
		onAddContribution,
	} = props;
	const [open, setOpen] = useState(true);
	const contentId = useId();
	const progress = goalMapProgress(goal, goals);
	const contributions = goalContributions(goal, goals, projectGroups);
	return (
		<section
			data-goal-id={goal.id}
			className="overflow-hidden rounded-xl border bg-card shadow-xs [--goal-color:var(--goal-color-light)] dark:[--goal-color:var(--goal-color-dark)]"
			style={
				{
					"--goal-color-light": projectColor(goal.id, true),
					"--goal-color-dark": projectColor(goal.id),
				} as CSSProperties
			}
		>
			<header className="flex flex-wrap items-center gap-4 px-5 py-5">
				<button
					type="button"
					aria-label={t("{0} 펼치기 또는 접기", [goal.title])}
					aria-controls={contentId}
					aria-expanded={open}
					onClick={() => setOpen((previous) => !previous)}
					className={cn("rounded", focusStyle)}
				>
					<ChevronDown
						className={cn(
							"size-4 text-muted-foreground motion-safe:transition-transform",
							!open && "-rotate-90",
						)}
					/>
				</button>
				<ProgressRing
					done={progress.completed}
					total={progress.total}
					complete={goal.status === "done"}
					color="var(--goal-color)"
				/>
				<button
					type="button"
					onClick={() => onOpen(goal)}
					className={cn(
						"min-w-0 flex-1 basis-48 rounded text-left",
						focusStyle,
					)}
				>
					<h3 className="break-words text-base font-semibold leading-6 hover:underline">
						{goal.title}
					</h3>
					<span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
						{goal.targetDate ? (
							<time dateTime={goal.targetDate}>{goal.targetDate}</time>
						) : (
							<span>{t("기한 미정")}</span>
						)}
						<span>
							{t("{0}/{1} 결과 완료", [progress.completed, progress.total])}
						</span>
						{goal.status === "done" ? (
							<span className="text-emerald-600 dark:text-emerald-400">
								{t("목표 달성")}
							</span>
						) : null}
					</span>
				</button>
				{goal.metric ? (
					<button
						type="button"
						disabled={busy}
						onClick={() => onEdit(goal)}
						aria-label={t("현재 수치 수정")}
						className={cn("rounded text-left text-sm", focusStyle)}
					>
						<span className="mb-1 block text-[11px] text-muted-foreground">
							{t("실제 성과")}
						</span>
						<GoalMetricSummary goal={goal} />
					</button>
				) : null}
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button variant="outline" size="sm" disabled={busy}>
							<Plus className="size-3.5" />
							{t("프로젝트 목표 추가")}
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						{projectGroups
							.filter((project) => project.name)
							.map((project) => (
								<DropdownMenuItem
									key={project.key}
									onClick={() => onAddContribution(goal, project)}
								>
									{project.name}
								</DropdownMenuItem>
							))}
						<DropdownMenuItem onClick={() => onAddContribution(goal)}>
							{t("다른 프로젝트")}
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</header>
			{goal.successCriteria ? (
				<p className="px-5 pb-4 pl-[100px] text-xs leading-5 text-muted-foreground">
					{goal.successCriteria}
				</p>
			) : null}
			<div
				id={contentId}
				data-state={open ? "open" : "closed"}
				inert={!open}
				aria-hidden={!open}
				className="orbit-goal-group"
			>
				<div className="min-h-0 overflow-hidden">
					{contributions.map((lane) => (
						<Contribution key={lane.key} {...props} lane={lane} />
					))}
					{contributions.every((lane) => lane.projects.length) ? (
						<SharedPath {...props} steps={[]} projects={[]} />
					) : null}
				</div>
			</div>
		</section>
	);
}

function Contribution(
	props: MapProps & {
		goal: Goal;
		lane: GoalContribution;
	},
) {
	const { t } = useI18n();
	const { goal, goals, lane, busy, onAddContribution } = props;
	const outcomes = lane.goals.filter(
		(child) =>
			child.projectName ||
			child.brand ||
			child.projectFolders.length ||
			goals.some((step) => step.parentId === child.id),
	);
	const outcomeIds = new Set(outcomes.map((child) => child.id));
	const steps = lane.goals.filter((child) => !outcomeIds.has(child.id));
	if (!lane.projects.length && !outcomes.length)
		return <SharedPath {...props} steps={steps} projects={[]} />;
	return (
		<div
			data-project-lane={lane.key}
			className="border-t border-border/60 [--goal-color:var(--goal-color-light)] dark:[--goal-color:var(--goal-color-dark)]"
			style={
				{
					"--goal-color-light": projectColor(lane.key, true),
					"--goal-color-dark": projectColor(lane.key),
				} as CSSProperties
			}
		>
			<div className="flex items-center justify-between gap-3 bg-muted/20 px-5 py-2.5">
				<div className="flex min-w-0 items-center gap-2 text-xs font-medium">
					<Flag className="size-3.5 shrink-0 text-muted-foreground" />
					<span className="truncate">
						{lane.projects.map((project) => project.name).join(" · ") ||
							t("공통 단계")}
					</span>
				</div>
				<Button
					variant="ghost"
					size="sm"
					disabled={busy}
					onClick={() =>
						onAddContribution(
							goal,
							lane.projects.length === 1 ? lane.projects[0] : undefined,
						)
					}
				>
					<Plus className="size-3" />
					{t("프로젝트 목표 추가")}
				</Button>
			</div>
			{outcomes.map((outcome) => (
				<GoalLane
					key={outcome.id}
					{...props}
					goal={outcome}
					steps={goalMilestones(outcome, goals).sort(
						(a, b) =>
							(a.targetDate ?? "9999").localeCompare(b.targetDate ?? "9999") ||
							a.createdAt.localeCompare(b.createdAt),
					)}
					color="var(--goal-color)"
					endpointLabel={t("프로젝트 목표")}
				/>
			))}
			{steps.length ? (
				<SharedPath {...props} steps={steps} projects={lane.projects} />
			) : null}
		</div>
	);
}

function SharedPath(
	props: MapProps & { goal: Goal; steps: Goal[]; projects: GoalProjectGroup[] },
) {
	const { t } = useI18n();
	const { goal, steps, projects, busy, onEdit, onToggle, onCreateStep } = props;
	const [adding, setAdding] = useState(false);
	const addButton = useRef<HTMLButtonElement>(null);
	const next =
		steps.find((step) => step.status === "active" && step.focused) ??
		steps.find((step) => step.status === "active");
	function close() {
		setAdding(false);
		addButton.current?.focus();
	}
	return (
		<Collapsible
			open={adding}
			onOpenChange={setAdding}
			className="border-t border-border/60"
		>
			<div className="grid gap-4 px-5 py-4 lg:grid-cols-[210px_minmax(0,1fr)]">
				<div className="flex items-start pt-2 text-xs text-muted-foreground">
					{projects.length ? t("실행 단계") : t("공통 단계")}
				</div>
				<div className="min-w-0 overflow-x-auto p-1 pb-2">
					<div className="flex min-w-full items-start">
						{[...steps]
							.sort(
								(a, b) =>
									(a.targetDate ?? "9999").localeCompare(
										b.targetDate ?? "9999",
									) || a.createdAt.localeCompare(b.createdAt),
							)
							.map((step, index) => (
								<StageNode
									key={step.id}
									step={step}
									index={index}
									current={step.id === next?.id}
									busy={busy}
									onEdit={onEdit}
									onToggle={onToggle}
								/>
							))}
						<CollapsibleTrigger asChild>
							<button
								ref={addButton}
								type="button"
								disabled={busy}
								className={cn(
									"min-w-24 flex-1 rounded text-left text-xs text-muted-foreground hover:text-foreground disabled:opacity-50",
									focusStyle,
								)}
							>
								<span className="mb-2.5 flex size-8 items-center justify-center rounded-full border border-dashed bg-card">
									<Plus
										className={cn(
											"size-4 motion-safe:transition-transform",
											adding && "rotate-45",
										)}
									/>
								</span>
								{t(steps.length ? "단계 추가" : "첫 단계")}
							</button>
						</CollapsibleTrigger>
					</div>
				</div>
			</div>
			<CollapsibleContent className="orbit-goal-disclosure">
				<StageComposer
					busy={busy}
					onClose={close}
					onSave={async (title, date) => {
						if (await onCreateStep(goal, title, date)) close();
					}}
				/>
			</CollapsibleContent>
		</Collapsible>
	);
}
