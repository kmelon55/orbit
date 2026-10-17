import { useId, useState } from "react";
import type { Goal } from "#/lib/orbit/assistant-schema";
import {
	type GoalInput,
	goalDepth,
	goalDescendants,
	goalInput,
	goalWeekStart,
} from "#/lib/orbit/goals";
import { formatDayKey } from "#/lib/orbit/para";
import { useGoals } from "./goal-provider";
import { useI18n } from "./locale-provider";
import { useOrbitSnapshot } from "./orbit-snapshot-provider";
import { DatePicker } from "./schedule-controls";
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "./ui/select";
import { Textarea } from "./ui/textarea";

export function GoalEditor({
	goal,
	parent,
	defaultGroupName,
	defaultProject,
	onClose,
	onSaved,
}: {
	goal?: Goal;
	parent?: Goal;
	defaultGroupName?: string;
	defaultProject?: string;
	onClose: () => void;
	onSaved: (id: string) => void;
}) {
	const { t } = useI18n();
	const { save, busy, goals } = useGoals();
	const snapshot = useOrbitSnapshot();
	const fieldId = useId();
	const [parentId, setParentId] = useState(goal?.parentId ?? parent?.id ?? "");
	const descendants = goal ? goalDescendants(goal, goals) : [];
	const excluded = new Set([goal?.id, ...descendants.map((item) => item.id)]);
	const subtreeHeight = goal
		? Math.max(
				1,
				...descendants.map(
					(item) => goalDepth(item, goals) - goalDepth(goal, goals) + 1,
				),
			)
		: 1;
	const parents = goals.filter(
		(item) =>
			!item.roadmap &&
			!excluded.has(item.id) &&
			goalDepth(item, goals) + subtreeHeight <= 3,
	);
	const [title, setTitle] = useState(goal?.title ?? "");
	const [projectName, setProjectName] = useState(
		goal?.projectName ?? goal?.brand ?? defaultGroupName ?? "",
	);
	const [criteria, setCriteria] = useState(goal?.successCriteria ?? "");
	const [description, setDescription] = useState(goal?.description ?? "");
	const [date, setDate] = useState(goal?.targetDate ?? "");
	const [numeric, setNumeric] = useState(Boolean(goal?.metric));
	const [current, setCurrent] = useState(String(goal?.metric?.current ?? ""));
	const [target, setTarget] = useState(String(goal?.metric?.target ?? ""));
	const [unit, setUnit] = useState(goal?.metric?.unit ?? "");
	const [measuredAt, setMeasuredAt] = useState(goal?.metric?.measuredAt ?? "");
	const [measurementDateEdited, setMeasurementDateEdited] = useState(false);
	const [period, setPeriod] = useState<"point" | "week" | "month">(
		goal?.metric?.period ?? "point",
	);
	const [periodStart, setPeriodStart] = useState(
		goal?.metric?.periodStart ?? "",
	);
	const [projects, setProjects] = useState(
		goal?.projectFolders ?? (defaultProject ? [defaultProject] : []),
	);
	const [taskIds, setTaskIds] = useState(goal?.itemIds ?? []);
	const [query, setQuery] = useState("");
	const tasks = snapshot.items.filter(
		(item) =>
			item.type === "task" &&
			item.space !== "archive" &&
			item.status !== "cancelled" &&
			(taskIds.includes(item.id) || item.status !== "done") &&
			item.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
	);
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !busy) onClose();
			}}
		>
			<DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>
						{goal
							? t("목표 수정")
							: parent
								? t("세부 목표 추가")
								: t("새 목표")}
					</DialogTitle>
					<DialogDescription className={parent ? undefined : "sr-only"}>
						{parent?.title ?? t("목표")}
					</DialogDescription>
				</DialogHeader>
				<form
					className="space-y-5"
					onSubmit={async (event) => {
						event.preventDefault();
						const input: GoalInput = {
							...(goal
								? goalInput(goal)
								: {
										parentId: parentId || undefined,
										horizon: parentId ? "milestone" : "quarter",
										focused:
											!parentId &&
											!goals.some(
												(g) =>
													g.focused && !g.parentId && g.status === "active",
											),
									}),
							parentId: parentId || undefined,
							horizon: parentId
								? "milestone"
								: goal?.horizon === "long_term"
									? "long_term"
									: "quarter",
							title: title.trim(),
							projectName: projectName.trim() || undefined,
							brand: undefined,
							description,
							successCriteria: criteria.trim(),
							targetDate: date || undefined,
							metric: numeric
								? {
										current: current.trim() ? Number(current) : null,
										measuredAt: current.trim()
											? measuredAt || undefined
											: undefined,
										period: period === "point" ? undefined : period,
										periodStart:
											period === "point" ? undefined : periodStart || undefined,
										target: Number(target),
										unit: unit.trim(),
									}
								: undefined,
							projectFolders: projects,
							itemIds: taskIds,
						};
						const next = await save(input);
						if (!next) return;
						const saved = goal
							? next.find((g) => g.id === goal.id)
							: next.find((g) => !goals.some((old) => old.id === g.id));
						if (saved) onSaved(saved.parentId ?? saved.id);
						onClose();
					}}
				>
					<div className="space-y-2">
						<label
							className="text-sm font-medium"
							htmlFor={`${fieldId}-parent`}
						>
							{t("상위 목표")}
						</label>
						<Select
							value={parentId || "none"}
							onValueChange={(value) =>
								setParentId(value === "none" ? "" : value)
							}
						>
							<SelectTrigger id={`${fieldId}-parent`}>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="none">{t("독립 목표")}</SelectItem>
								{parents.map((item) => (
									<SelectItem key={item.id} value={item.id}>
										{item.parentId ? "↳ " : ""}
										{item.title}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<div className="space-y-2">
						<label
							className="text-sm font-medium"
							htmlFor={`${fieldId}-project-name`}
						>
							{t("프로젝트")}
						</label>
						<Input
							id={`${fieldId}-project-name`}
							list={`${fieldId}-project-names`}
							maxLength={120}
							value={projectName}
							onChange={(event) => setProjectName(event.target.value)}
						/>
						<datalist id={`${fieldId}-project-names`}>
							{[
								...new Set([
									...goals.flatMap((g) => {
										const name = g.projectName ?? g.brand;
										return name ? [name] : [];
									}),
									...snapshot.folders.project
										.filter((f) => !f.parent)
										.map((f) => f.name),
								]),
							].map((name) => (
								<option key={name} value={name} />
							))}
						</datalist>
					</div>
					<div className="space-y-2">
						<label className="text-sm font-medium" htmlFor={`${fieldId}-title`}>
							{t("목표")}
						</label>
						<Input
							id={`${fieldId}-title`}
							autoFocus
							required
							maxLength={160}
							value={title}
							onChange={(e) => setTitle(e.target.value)}
						/>
					</div>
					<div className="space-y-2">
						<label
							className="text-sm font-medium"
							htmlFor={`${fieldId}-criteria`}
						>
							{t("달성 기준")}
						</label>
						<Textarea
							id={`${fieldId}-criteria`}
							maxLength={1000}
							rows={2}
							value={criteria}
							onChange={(e) => setCriteria(e.target.value)}
						/>
					</div>
					<div className="flex items-center justify-between gap-3">
						<span className="text-sm font-medium">{t("목표 기한")}</span>
						<DatePicker
							label={t("목표 기한")}
							allowClear
							value={date}
							onChange={setDate}
							placeholder={t("기한 없음")}
						/>
					</div>
					<div className="space-y-3 rounded-xl border p-3">
						<label
							htmlFor={`${fieldId}-numeric`}
							className="flex items-center gap-2 text-sm"
						>
							<Checkbox
								id={`${fieldId}-numeric`}
								checked={numeric}
								onCheckedChange={(value) => setNumeric(value === true)}
							/>
							{t("숫자로 성과 기록")}
						</label>
						{numeric ? (
							<div className="space-y-3">
								<div className="grid grid-cols-3 gap-2">
									<div className="space-y-1.5">
										<label
											className="text-sm font-medium"
											htmlFor={`${fieldId}-current`}
										>
											{t("현재")}
										</label>
										<Input
											id={`${fieldId}-current`}
											type="number"
											step="any"
											placeholder={t("미측정")}
											value={current}
											onChange={(e) => {
												setCurrent(e.target.value);
												if (!measurementDateEdited)
													setMeasuredAt(e.target.value ? formatDayKey() : "");
											}}
										/>
									</div>
									<div className="space-y-1.5">
										<label
											className="text-sm font-medium"
											htmlFor={`${fieldId}-target`}
										>
											{t("목표값")}
										</label>
										<Input
											id={`${fieldId}-target`}
											type="number"
											min={0.000001}
											step="any"
											required
											value={target}
											onChange={(e) => setTarget(e.target.value)}
										/>
									</div>
									<div className="space-y-1.5">
										<label
											className="text-sm font-medium"
											htmlFor={`${fieldId}-unit`}
										>
											{t("단위")}
										</label>
										<Input
											id={`${fieldId}-unit`}
											maxLength={30}
											value={unit}
											onChange={(e) => setUnit(e.target.value)}
										/>
									</div>
								</div>
								<div className="flex flex-wrap items-end gap-3">
									<div className="min-w-32 space-y-1.5">
										<label className="text-sm" htmlFor={`${fieldId}-period`}>
											{t("측정 단위")}
										</label>
										<Select
											value={period}
											onValueChange={(value) => {
												setPeriod(value as "point" | "week" | "month");
												const day = measuredAt || formatDayKey();
												setPeriodStart(
													value === "month"
														? `${day.slice(0, 7)}-01`
														: value === "week"
															? goalWeekStart(day)
															: "",
												);
											}}
										>
											<SelectTrigger id={`${fieldId}-period`}>
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="point">{t("시점 수치")}</SelectItem>
												<SelectItem value="week">{t("주간 실적")}</SelectItem>
												<SelectItem value="month">{t("월간 실적")}</SelectItem>
											</SelectContent>
										</Select>
									</div>
									{period !== "point" ? (
										<div className="space-y-1.5">
											<label
												className="text-sm"
												htmlFor={`${fieldId}-period-start`}
											>
												{t("실적 기간")}
											</label>
											<Input
												id={`${fieldId}-period-start`}
												type={period === "month" ? "month" : "date"}
												value={
													period === "month"
														? periodStart.slice(0, 7)
														: periodStart
												}
												onChange={(event) =>
													setPeriodStart(
														event.target.value
															? period === "month"
																? `${event.target.value}-01`
																: goalWeekStart(event.target.value)
															: "",
													)
												}
											/>
										</div>
									) : null}

									<div className="space-y-1.5">
										<label
											className="text-sm"
											htmlFor={`${fieldId}-measured-at`}
										>
											{t("측정일")}
										</label>
										<Input
											id={`${fieldId}-measured-at`}
											type="date"
											disabled={!current.trim()}
											value={measuredAt}
											onChange={(event) => {
												setMeasuredAt(event.target.value);
												setMeasurementDateEdited(true);
											}}
										/>
									</div>
								</div>
							</div>
						) : null}
					</div>
					<details className="rounded-xl border p-3">
						<summary className="cursor-pointer text-sm font-medium">
							{t("프로젝트·할 일 연결")}
							{projects.length + taskIds.length > 0
								? ` · ${projects.length + taskIds.length}`
								: ""}
						</summary>
						<div className="mt-3 space-y-3">
							{snapshot.folders.project.length > 0 ? (
								<div className="max-h-36 space-y-2 overflow-y-auto">
									{snapshot.folders.project.map((folder) => (
										<label
											key={folder.slug}
											htmlFor={`${fieldId}-project-${folder.slug}`}
											className="flex items-center gap-2 text-sm"
										>
											<Checkbox
												id={`${fieldId}-project-${folder.slug}`}
												checked={projects.includes(folder.slug)}
												onCheckedChange={(checked) =>
													setProjects((values) =>
														checked
															? [...values, folder.slug]
															: values.filter((v) => v !== folder.slug),
													)
												}
											/>
											{folder.name}
										</label>
									))}
								</div>
							) : null}
							<Input
								aria-label={t("할 일 검색")}
								placeholder={t("할 일 검색")}
								value={query}
								onChange={(e) => setQuery(e.target.value)}
							/>
							<div className="max-h-44 space-y-2 overflow-y-auto">
								{tasks.slice(0, 50).map((task) => (
									<label
										key={task.id}
										htmlFor={`${fieldId}-task-${task.id}`}
										className="flex items-center gap-2 text-sm"
									>
										<Checkbox
											id={`${fieldId}-task-${task.id}`}
											checked={taskIds.includes(task.id)}
											onCheckedChange={(checked) =>
												setTaskIds((values) =>
													checked
														? [...values, task.id]
														: values.filter((v) => v !== task.id),
												)
											}
										/>
										<span className="min-w-0 break-words">{task.title}</span>
									</label>
								))}
								{tasks.length === 0 ? (
									<p className="py-2 text-sm text-muted-foreground">
										{t("연결할 할 일이 없습니다.")}
									</p>
								) : null}
							</div>
						</div>
					</details>
					<details className="text-sm">
						<summary className="cursor-pointer text-muted-foreground">
							{t("메모")}
						</summary>
						<Textarea
							className="mt-2"
							aria-label={t("메모")}
							value={description}
							maxLength={12000}
							onChange={(e) => setDescription(e.target.value)}
						/>
					</details>
					<div className="flex justify-end gap-2">
						<Button
							type="button"
							variant="ghost"
							disabled={busy}
							onClick={onClose}
						>
							{t("취소")}
						</Button>
						<Button
							type="submit"
							disabled={
								busy || !title.trim() || (numeric && !(Number(target) > 0))
							}
						>
							{busy ? t("저장 중…") : t("저장")}
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}
