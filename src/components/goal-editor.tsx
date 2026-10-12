import { useId, useState } from "react";
import type { Goal } from "#/lib/orbit/assistant-schema";
import { type GoalInput, goalInput } from "#/lib/orbit/goals";
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
import { Textarea } from "./ui/textarea";

export function GoalEditor({
	goal,
	parent,
	onClose,
	onSaved,
}: {
	goal?: Goal;
	parent?: Goal;
	onClose: () => void;
	onSaved: (id: string) => void;
}) {
	const { t } = useI18n();
	const { save, busy, goals } = useGoals();
	const snapshot = useOrbitSnapshot();
	const fieldId = useId();
	const [title, setTitle] = useState(goal?.title ?? "");
	const [criteria, setCriteria] = useState(goal?.successCriteria ?? "");
	const [description, setDescription] = useState(goal?.description ?? "");
	const [date, setDate] = useState(goal?.targetDate ?? "");
	const [numeric, setNumeric] = useState(Boolean(goal?.metric));
	const [current, setCurrent] = useState(String(goal?.metric?.current ?? 0));
	const [target, setTarget] = useState(String(goal?.metric?.target ?? ""));
	const [unit, setUnit] = useState(goal?.metric?.unit ?? "");
	const [projects, setProjects] = useState(goal?.projectFolders ?? []);
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
					<DialogDescription>
						{parent?.title ?? t("어떤 결과를 만들고 싶나요?")}
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
										parentId: parent?.id,
										horizon: parent ? "milestone" : "quarter",
										focused:
											!parent &&
											!goals.some(
												(g) =>
													g.focused && !g.parentId && g.status === "active",
											),
									}),
							title: title.trim(),
							description,
							successCriteria: criteria.trim(),
							targetDate: date || undefined,
							metric: numeric
								? {
										current: Number(current),
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
						<label className="text-sm font-medium" htmlFor={`${fieldId}-title`}>
							{t("목표")}
						</label>
						<Input
							id={`${fieldId}-title`}
							autoFocus
							required
							maxLength={160}
							placeholder={t("예: 첫 유료 고객 10명 확보")}
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
							placeholder={t("어떻게 되면 달성한 건가요?")}
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
										min={0}
										step="any"
										required
										value={current}
										onChange={(e) => setCurrent(e.target.value)}
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
										placeholder={t("명, 회, 원")}
										value={unit}
										onChange={(e) => setUnit(e.target.value)}
									/>
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
