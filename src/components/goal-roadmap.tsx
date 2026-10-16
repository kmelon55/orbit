import { Link, useBlocker } from "@tanstack/react-router";
import {
	ArrowDown,
	ArrowLeft,
	ArrowRight,
	Check,
	Compass,
	Flag,
	Plus,
	Save,
	Target,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { Goal } from "#/lib/orbit/assistant-schema";
import { goalInput, goalWeekStart } from "#/lib/orbit/goals";
import { formatDayKey } from "#/lib/orbit/para";
import { cn } from "#/lib/utils";
import { GoalTaskPicker } from "./goal-focus";
import { useGoals } from "./goal-provider";
import { GoalWorkspace as ExistingGoals } from "./goal-workspace";
import { useI18n } from "./locale-provider";
import { useOrbitSnapshot } from "./orbit-snapshot-provider";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

type Roadmap = NonNullable<Goal["roadmap"]>;
type Step = keyof Roadmap["steps"];
type Stage = "mission" | Step | "week";
const stages: Stage[] = [
	"mission",
	"decade",
	"middle",
	"year",
	"half",
	"month",
	"week",
];
const labels: Record<Stage, string> = {
	mission: "나의 사명",
	decade: "10년 뒤",
	middle: "5년 뒤",
	year: "1년 뒤",
	half: "6개월 뒤",
	month: "한 달 뒤",
	week: "이번 주",
};
const questions: Record<Stage, string> = {
	mission: "나는 진정으로 어떤 삶을 원하는가?",
	decade: "그 삶을 살고 있는 나는 어떤 모습일까?",
	middle: "10년 뒤의 모습을 위해 무엇이 갖춰져야 할까?",
	year: "그 기반을 만들기 위해 1년 안에 무엇이 달라져야 할까?",
	half: "올바른 방향으로 가고 있다는 걸 무엇으로 확인할까?",
	month: "지금 가장 먼저 만들어야 할 변화는 무엇일까?",
	week: "그 변화를 위해 이번 주에 무엇을 끝낼까?",
};

export function GoalWorkspace() {
	const state = useGoals();
	const { t, errorText } = useI18n();
	const [existing, setExisting] = useState(false);
	const [selected, setSelected] = useState<string>();
	const [creating, setCreating] = useState(false);
	const paths = state.goals.filter(
		(goal) => !goal.parentId && goal.roadmap && goal.status === "active",
	);
	const goal = creating
		? undefined
		: (paths.find((goal) => goal.id === selected) ??
			paths.find((goal) => goal.focused) ??
			paths[0]);
	useEffect(() => {
		if (!creating && !selected && goal) setSelected(goal.id);
	}, [creating, selected, goal]);
	if (existing)
		return (
			<div className="h-full overflow-y-auto">
				<div className="mx-auto max-w-6xl px-4 pt-5 sm:px-7">
					<Button variant="ghost" onClick={() => setExisting(false)}>
						<ArrowLeft />
						{t("나의 방향으로 돌아가기")}
					</Button>
				</div>
				<ExistingGoals />
			</div>
		);
	if (state.loading)
		return (
			<output className="mx-auto block max-w-6xl p-8">
				{t("불러오는 중…")}
			</output>
		);
	if (state.error)
		return (
			<div className="p-8" role="alert">
				{errorText(state.error)}
				<Button onClick={() => void state.reload()}>{t("다시 시도")}</Button>
			</div>
		);
	return (
		<RoadmapEditor
			key={goal?.id ?? "new"}
			goal={goal}
			paths={paths}
			onExisting={() => setExisting(true)}
			onSelect={(id) => {
				setCreating(false);
				setSelected(id);
			}}
			onNew={() => setCreating(true)}
			onCreated={(id) => {
				setCreating(false);
				setSelected(id);
			}}
		/>
	);
}

function RoadmapEditor({
	goal,
	paths,
	onExisting,
	onSelect,
	onNew,
	onCreated,
}: {
	goal?: Goal;
	paths: Goal[];
	onExisting: () => void;
	onSelect: (id: string) => void;
	onNew: () => void;
	onCreated: (id: string) => void;
}) {
	const { t } = useI18n();
	const { save, busy, goals } = useGoals();
	const snapshot = useOrbitSnapshot();
	const [base, setBase] = useState(goal);
	const [title, setTitle] = useState(goal?.title ?? "");
	const [description, setDescription] = useState(goal?.description ?? "");
	const [roadmap, setRoadmap] = useState<Roadmap>(
		() =>
			goal?.roadmap ?? {
				anchorDate: formatDayKey(),
				middleYears: 5,
				steps: {},
			},
	);
	const [week, setWeek] = useState(goal?.week);
	const [stage, setStage] = useState<Stage>("mission");
	const [dirty, setDirty] = useState(false);
	const [picking, setPicking] = useState(false);
	const [saved, setSaved] = useState(false);
	useEffect(() => {
		if (dirty || !goal || goal.revision === base?.revision) return;
		setBase(goal);
		setTitle(goal.title);
		setDescription(goal.description);
		if (goal.roadmap) setRoadmap(goal.roadmap);
		setWeek(goal.week);
	}, [goal, base?.revision, dirty]);
	const weekStart = goalWeekStart(formatDayKey());
	useBlocker({
		shouldBlockFn: () =>
			dirty && !window.confirm(t("저장하지 않은 변경을 버리고 이동할까요?")),
		enableBeforeUnload: dirty,
	});
	const index = stages.indexOf(stage);
	const upper = stages
		.slice(0, index)
		.reverse()
		.find((key) => outcome(key).trim());
	const todayTasks =
		goal?.today?.date === formatDayKey()
			? snapshot.items.filter(
					(item) =>
						goal.today?.itemIds.includes(item.id) &&
						item.type === "task" &&
						item.space !== "archive" &&
						item.status !== "cancelled",
				)
			: [];
	function label(key: Stage) {
		return t(
			key === "middle" && roadmap.middleYears === 6 ? "6년 뒤" : labels[key],
		);
	}
	function outcome(key: Stage) {
		return key === "mission"
			? title
			: key === "week"
				? week?.start === weekStart
					? week.outcome
					: ""
				: (roadmap.steps[key]?.outcome ?? "");
	}
	function change() {
		setDirty(true);
		setSaved(false);
	}
	function navigate(action: () => void) {
		if (!dirty || window.confirm(t("저장하지 않은 변경을 버리고 이동할까요?")))
			action();
	}
	async function persist() {
		const next = await save({
			...(base
				? goalInput(base)
				: { horizon: "long_term" as const, focused: true }),
			title: title.trim(),
			description,
			roadmap,
			week,
		});
		if (!next) return;
		const record = base
			? next.find((item) => item.id === base.id)
			: next.find(
					(item) =>
						item.roadmap && !goals.some((previous) => previous.id === item.id),
				);
		if (record) {
			setBase(record);
			setDirty(false);
			setSaved(true);
			if (!base) onCreated(record.id);
		}
	}
	return (
		<div className="h-full overflow-y-auto bg-background">
			<div className="mx-auto max-w-6xl px-5 py-7 sm:px-8 lg:px-12 lg:py-10">
				<header className="mb-8 flex flex-wrap items-center justify-between gap-4">
					<div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
						<Compass className="size-4" />
						{t("나의 방향")}
					</div>
					<div className="flex items-center gap-2">
						<Button
							variant="ghost"
							size="sm"
							onClick={() => navigate(onExisting)}
						>
							{t("기존 목표")}
						</Button>
						{paths.length > 0 ? (
							<>
								<select
									aria-label={t("삶의 방향 선택")}
									value={goal?.id ?? ""}
									className="max-w-36 rounded-md border bg-background p-2 text-xs"
									onChange={(event) =>
										navigate(() => onSelect(event.target.value))
									}
								>
									<option value="" disabled>
										{t("새로운 방향")}
									</option>
									{paths.map((path) => (
										<option key={path.id} value={path.id}>
											{path.title}
										</option>
									))}
								</select>
								<Button
									variant="ghost"
									size="icon-sm"
									aria-label={t("새로운 방향")}
									onClick={() => navigate(onNew)}
								>
									<Plus />
								</Button>
							</>
						) : null}
					</div>
				</header>
				<div className="mb-8 flex flex-wrap items-end justify-between gap-5">
					<div>
						<h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
							{t("원하는 삶에서, 오늘까지.")}
						</h2>
						<p className="mt-3 text-sm text-muted-foreground">
							{t("먼 미래부터 거슬러 내려와, 지금 할 일을 정해보세요.")}
						</p>
					</div>
					<div className="flex items-center gap-3">
						{goal ? (
							<Button
								variant="ghost"
								size="sm"
								disabled={busy || dirty}
								aria-pressed={Boolean(goal.focused)}
								onClick={() =>
									void save({ ...goalInput(goal), focused: !goal.focused })
								}
							>
								<Flag className="size-3.5" />
								{goal.focused ? t("현재 집중") : t("집중 목표로 설정")}
							</Button>
						) : null}
						<output className="text-xs text-muted-foreground">
							{busy
								? t("저장 중…")
								: dirty
									? t("저장하지 않은 변경")
									: saved
										? t("저장됨")
										: ""}
						</output>
						<Button
							disabled={busy || !title.trim() || !dirty}
							onClick={() => void persist()}
						>
							<Save className="size-4" />
							{t("저장")}
						</Button>
					</div>
				</div>
				<button
					type="button"
					onClick={() => setStage("mission")}
					className={cn(
						"mb-8 flex w-full items-start gap-4 rounded-2xl border bg-primary/[0.035] p-6 text-left transition-colors hover:bg-primary/[0.06] sm:p-7",
						stage === "mission" ? "border-primary/30" : "border-border",
					)}
				>
					<div className="flex size-10 shrink-0 items-center justify-center rounded-full border border-primary/20 text-primary">
						<Compass className="size-5" />
					</div>
					<div className="min-w-0 flex-1">
						<p className="mb-2 text-xs font-medium text-primary">
							{t("나의 사명 · 모든 계획의 출발점")}
						</p>
						<p
							className={cn(
								"whitespace-pre-wrap break-words text-xl font-medium leading-relaxed",
								!title && "text-muted-foreground",
							)}
						>
							{title || t("내가 진정으로 원하는 삶을 적어보세요.")}
						</p>
					</div>
					<ArrowRight className="mt-3 size-4 shrink-0 text-muted-foreground" />
				</button>
				<div className="grid gap-7 md:grid-cols-[220px_minmax(0,1fr)] lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-10">
					<nav aria-label={t("미래에서 오늘까지")} className="min-w-0">
						<div className="mb-4 flex items-center gap-2 px-2 text-xs text-muted-foreground">
							<ArrowDown className="size-3.5" />
							{t("미래에서 오늘까지")}
						</div>
						<ol className="relative grid grid-cols-2 gap-1 md:block md:space-y-1">
							{stages.slice(1).map((key, i) => (
								<li key={key} className="relative min-w-0">
									<button
										type="button"
										aria-current={stage === key ? "step" : undefined}
										onClick={() => setStage(key)}
										className={cn(
											"relative flex w-full items-start gap-3 rounded-xl px-3 py-4 text-left transition-colors",
											stage === key ? "bg-primary/[0.07]" : "hover:bg-muted/50",
										)}
									>
										<span
											className={cn(
												"relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border bg-background text-[11px]",
												stage === key
													? "border-primary bg-primary text-primary-foreground"
													: "border-border text-muted-foreground",
											)}
										>
											{String(i + 1).padStart(2, "0")}
										</span>
										<span className="min-w-0 flex-1">
											<span
												className={cn(
													"block text-sm font-medium",
													stage === key && "text-primary",
												)}
											>
												{label(key)}
											</span>
											<span className="mt-1.5 line-clamp-2 break-words text-xs leading-5 text-muted-foreground">
												{outcome(key) || t("아직 정하지 않았어요")}
											</span>
										</span>
									</button>
									{i < 5 ? (
										<span
											aria-hidden="true"
											className="absolute left-[25px] top-[46px] hidden h-[calc(100%-34px)] w-px bg-border md:block"
										/>
									) : null}
								</li>
							))}
						</ol>
					</nav>
					<section
						aria-label={label(stage)}
						className="min-w-0 rounded-2xl border p-5 sm:p-7"
					>
						<div className="mb-6 flex items-center justify-between gap-3">
							<span className="flex items-center gap-2 text-sm font-medium text-primary">
								<Flag className="size-4" />
								{label(stage)}
							</span>
							{stage === "middle" ? (
								<select
									aria-label={t("중간 시점")}
									value={roadmap.middleYears}
									disabled={busy}
									onChange={(event) => {
										setRoadmap({
											...roadmap,
											middleYears: Number(event.target.value) as 5 | 6,
										});
										change();
									}}
									className="rounded-md border bg-background p-1.5 text-xs"
								>
									<option value={5}>{t("5년 뒤")}</option>
									<option value={6}>{t("6년 뒤")}</option>
								</select>
							) : (
								<span className="text-xs text-muted-foreground">
									{stage === "mission"
										? t("삶의 방향")
										: stage === "week"
											? weekStart
											: t("기준일 · {0}", [roadmap.anchorDate])}
								</span>
							)}
						</div>
						{upper ? (
							<div className="mb-6 border-l-2 border-primary/25 pl-4">
								<p className="mb-1 text-xs text-muted-foreground">
									{t("이어지는 방향 · {0}", [label(upper)])}
								</p>
								<p className="whitespace-pre-wrap break-words text-sm leading-6">
									{outcome(upper)}
								</p>
							</div>
						) : null}
						<h3 className="mb-5 text-xl font-medium leading-relaxed tracking-tight">
							{t(questions[stage])}
						</h3>
						<label
							htmlFor="roadmap-outcome"
							className="mb-2 block text-xs font-medium text-muted-foreground"
						>
							{stage === "mission"
								? t("내가 원하는 삶")
								: t("이때 이루고 싶은 모습과 결과")}
						</label>
						<Textarea
							id="roadmap-outcome"
							disabled={busy}
							value={outcome(stage)}
							maxLength={stage === "mission" ? 160 : 1000}
							rows={4}
							placeholder={t("내 말로 적어보세요.")}
							className="min-h-32 resize-y border-border/70 bg-muted/15 text-base leading-7 shadow-none"
							onChange={(event) => {
								const value = event.target.value;
								if (stage === "mission") setTitle(value);
								else if (stage === "week")
									setWeek({ start: weekStart, outcome: value });
								else
									setRoadmap({
										...roadmap,
										steps: {
											...roadmap.steps,
											[stage]: {
												outcome: value,
												reason: roadmap.steps[stage]?.reason ?? "",
											},
										},
									});
								change();
							}}
						/>
						{stage !== "week" ? (
							<div className="mt-5">
								<label
									htmlFor="roadmap-reason"
									className="mb-2 block text-xs font-medium text-muted-foreground"
								>
									{stage === "mission"
										? t("이 삶이 나에게 중요한 이유")
										: t("이 결과가 더 큰 방향에 필요한 이유")}
								</label>
								<Textarea
									id="roadmap-reason"
									disabled={busy}
									rows={2}
									maxLength={stage === "mission" ? 12000 : 1000}
									value={
										stage === "mission"
											? description
											: (roadmap.steps[stage]?.reason ?? "")
									}
									placeholder={t(
										"이유를 적어두면, 다시 돌아볼 때 도움이 돼요.",
									)}
									className="resize-y border-border/70 bg-transparent shadow-none"
									onChange={(event) => {
										if (stage === "mission") setDescription(event.target.value);
										else
											setRoadmap({
												...roadmap,
												steps: {
													...roadmap.steps,
													[stage]: {
														outcome: roadmap.steps[stage]?.outcome ?? "",
														reason: event.target.value,
													},
												},
											});
										change();
									}}
								/>
							</div>
						) : week && week.start !== weekStart ? (
							<div className="mt-4 text-sm text-muted-foreground">
								<p className="mb-1 text-xs">
									{t("이전 주의 계획 · {0}", [week.start])}
								</p>
								<p className="whitespace-pre-wrap">{week.outcome}</p>
							</div>
						) : null}
						<div className="mt-7 flex items-center justify-between border-t pt-5">
							<Button
								variant="ghost"
								size="sm"
								disabled={index === 0}
								onClick={() => setStage(stages[index - 1])}
							>
								<ArrowLeft />
								{t("이전")}
							</Button>
							{index < stages.length - 1 ? (
								<Button
									variant="ghost"
									size="sm"
									onClick={() => setStage(stages[index + 1])}
								>
									{label(stages[index + 1])}
									<ArrowRight />
								</Button>
							) : (
								<span className="text-xs text-muted-foreground">
									{t("이제 오늘의 행동으로")}
								</span>
							)}
						</div>
					</section>
				</div>
				<section className="mt-8 flex flex-wrap items-center justify-between gap-5 rounded-2xl border p-5 sm:p-6">
					<div className="flex min-w-0 items-start gap-3">
						<Target className="mt-0.5 size-5 shrink-0 text-primary" />
						<div className="min-w-0">
							<h3 className="text-sm font-medium">{t("오늘, 한 걸음")}</h3>
							{todayTasks.length ? (
								<ul className="mt-2 space-y-2">
									{todayTasks.map((task) => (
										<li
											key={task.id}
											className="flex items-center gap-2 text-sm"
										>
											{task.status === "done" ? (
												<Check className="size-3.5" />
											) : (
												<span className="size-3 rounded-full border" />
											)}
											<span
												className={cn(
													"break-words",
													task.status === "done" &&
														"text-muted-foreground line-through",
												)}
											>
												{task.title}
											</span>
										</li>
									))}
								</ul>
							) : (
								<p className="mt-1 text-xs text-muted-foreground">
									{t("이번 주 결과를 향해 오늘 할 일을 연결하세요.")}
								</p>
							)}
						</div>
					</div>
					<div className="flex items-center gap-2">
						<Button
							variant="outline"
							size="sm"
							disabled={!goal || dirty || busy}
							onClick={() => setPicking(true)}
						>
							<Plus />
							{t("할 일 선택")}
						</Button>
						<Button variant="ghost" size="sm" asChild>
							<Link to="/">
								{t("오늘 보기")}
								<ArrowRight />
							</Link>
						</Button>
					</div>
				</section>
			</div>
			{picking && goal ? (
				<GoalTaskPicker goal={goal} onClose={() => setPicking(false)} />
			) : null}
		</div>
	);
}
