import { CalendarDays, Check, ListTodo, Plus, Settings2 } from "lucide-react";
import { Popover } from "radix-ui";
import { type ReactNode, useId, useState } from "react";
import { toast } from "sonner";
import { FOLDER_COLOR_VALUES, folderColor } from "#/lib/orbit/folder-colors";
import { mutateOrbit } from "#/lib/orbit/functions";
import { DEFAULT_SCHEDULE_CATEGORIES } from "#/lib/orbit/schedule-categories";
import {
	type ScheduleCategory,
	scheduleCategorySettingsSchema,
} from "#/lib/orbit/schema";
import { ItemColorPicker } from "@/components/item-color-picker";
import { useOrbitSnapshot } from "@/components/orbit-snapshot-provider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function useScheduleCategories() {
	const snapshot = useOrbitSnapshot();
	const categories = [
		...(snapshot.scheduleCategories ?? DEFAULT_SCHEDULE_CATEGORIES),
	];
	const known = new Set(categories.map((category) => category.id));
	for (const item of snapshot.items) {
		if (
			(item.type === "event" || item.type === "task") &&
			item.category &&
			!known.has(item.category)
		) {
			categories.push({
				id: item.category,
				name: item.category,
				color: "slate",
			});
			known.add(item.category);
		}
	}
	return categories;
}

function useUncategorizedCategory(): ScheduleCategory {
	const snapshot = useOrbitSnapshot();
	return {
		id: "uncategorized",
		name: "미분류",
		color: snapshot.uncategorizedScheduleColor ?? "slate",
	};
}

export function ScheduleCategoryStyles() {
	const categories = useScheduleCategories();
	const uncategorized = useUncategorizedCategory();
	return (
		<style>
			{[...categories, uncategorized]
				.map(({ id, color }) => {
					const value = FOLDER_COLOR_VALUES[color];
					return `.orbit-category-${id}-dot { background-color: ${value}; }
.orbit-category-${id}-icon { color: ${value}; }
.orbit-event-surface.orbit-category-${id}-surface, .orbit-task-surface.orbit-category-${id}-surface { --schedule-color: ${value}; }`;
				})
				.join("\n")}
		</style>
	);
}

export function ScheduleCategorySelect({
	value,
	onChange,
}: {
	value?: string;
	onChange: (value: string | undefined) => void;
}) {
	const categories = useScheduleCategories();
	const selected = categories.find((category) => category.id === value);
	return (
		<label className="flex items-center gap-3 text-sm">
			<span
				className={cn(
					"size-3 shrink-0 rounded-full",
					selected ? folderColor(selected.color).dot : folderColor("slate").dot,
				)}
			/>
			<span>캘린더</span>
			<select
				aria-label="캘린더"
				value={value ?? ""}
				onChange={(event) => onChange(event.target.value || undefined)}
				className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				<option value="">미분류</option>
				{categories.map((category) => (
					<option key={category.id} value={category.id}>
						{category.name}
					</option>
				))}
			</select>
		</label>
	);
}

export type CalendarDisplayOptions = {
	visibility: { event: boolean; task: boolean };
	onChangeVisibility: (kind: "event" | "task") => void;
	hidden: string[];
	onChangeHidden: (hidden: string[]) => void;
};

function CalendarDisplayRow({
	name,
	visible,
	onToggle,
	icon,
	children,
}: {
	name: string;
	visible: boolean;
	onToggle: () => void;
	icon?: ReactNode;
	children?: ReactNode;
}) {
	const checkboxId = useId();
	return (
		<div className="flex items-center gap-1 rounded-lg hover:bg-muted/70">
			<label
				htmlFor={checkboxId}
				className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-2 py-1.5 text-sm"
			>
				<Checkbox
					id={checkboxId}
					aria-label={`${name} 표시`}
					checked={visible}
					onCheckedChange={onToggle}
					className="rounded-[5px]"
				/>
				{icon}
				<span className="min-w-0 truncate">{name}</span>
			</label>
			{children}
		</div>
	);
}

function CategoryDisplayRow({
	category,
	visible,
	onToggle,
}: {
	category: ScheduleCategory;
	visible: boolean;
	onToggle: () => void;
}) {
	const [saving, setSaving] = useState(false);
	async function changeColor(color: ScheduleCategory["color"] | undefined) {
		if (saving) return;
		setSaving(true);
		try {
			await mutateOrbit({
				data: {
					action: "save-schedule-category",
					input: {
						...category,
						color:
							color ?? (category.id === "uncategorized" ? "slate" : "blue"),
					},
				},
			});
		} catch {
			toast.error("색상을 저장하지 못했습니다.");
		} finally {
			setSaving(false);
		}
	}
	return (
		<CalendarDisplayRow
			name={category.name}
			visible={visible}
			onToggle={onToggle}
		>
			<ItemColorPicker
				type="event"
				value={category.color}
				compact
				label={`${category.name} 색상 변경`}
				disabled={saving}
				onChange={(color) => void changeColor(color)}
			/>
		</CalendarDisplayRow>
	);
}

export function ScheduleDisplayOptions({
	visibility,
	onChangeVisibility,
	hidden,
	onChangeHidden,
}: CalendarDisplayOptions) {
	const categories = useScheduleCategories();
	const uncategorized = useUncategorizedCategory();
	function toggleCategory(id: string) {
		onChangeHidden(
			hidden.includes(id)
				? hidden.filter((entry) => entry !== id)
				: [...hidden, id],
		);
	}
	return (
		<fieldset className="min-w-0" aria-label="달력 표시">
			<div className="mb-1 px-1 text-[11px] font-semibold text-muted-foreground">
				표시할 항목
			</div>
			<div className="grid grid-cols-2 gap-1">
				{(["task", "event"] as const).map((kind) => {
					const name = kind === "event" ? "일정" : "할 일";
					const Icon = kind === "event" ? CalendarDays : ListTodo;
					return (
						<CalendarDisplayRow
							key={kind}
							name={name}
							visible={visibility[kind]}
							onToggle={() => onChangeVisibility(kind)}
							icon={
								<Icon className="size-3.5 shrink-0 text-muted-foreground" />
							}
						/>
					);
				})}
			</div>
			<div className="mt-3 border-t pt-2">
				<div className="mb-1 flex items-center justify-between gap-2 px-1">
					<span className="text-[11px] font-semibold text-muted-foreground">
						캘린더
					</span>
					<ScheduleCategoryManager />
				</div>
				<div className="max-h-64 space-y-0.5 overflow-y-auto">
					{categories.map((category) => (
						<CategoryDisplayRow
							key={category.id}
							category={category}
							visible={!hidden.includes(category.id)}
							onToggle={() => toggleCategory(category.id)}
						/>
					))}
					<CategoryDisplayRow
						category={uncategorized}
						visible={!hidden.includes("uncategorized")}
						onToggle={() => toggleCategory("uncategorized")}
					/>
				</div>
			</div>
		</fieldset>
	);
}

export function ScheduleDisplayMenu(props: CalendarDisplayOptions) {
	return (
		<Popover.Root>
			<Popover.Trigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					className="xl:hidden"
					aria-label="달력 표시와 색상"
				>
					<Settings2 />
				</Button>
			</Popover.Trigger>
			<Popover.Portal>
				<Popover.Content
					align="end"
					sideOffset={6}
					className="z-50 w-60 rounded-xl border bg-popover p-3 text-popover-foreground shadow-lg outline-none"
				>
					<ScheduleDisplayOptions {...props} />
				</Popover.Content>
			</Popover.Portal>
		</Popover.Root>
	);
}

function ScheduleCategoryManager() {
	const categories = useScheduleCategories();
	const uncategorized = useUncategorizedCategory();
	const settingsCategories = [...categories, uncategorized];
	const [editing, setEditing] = useState<ScheduleCategory | null>(null);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const saved = settingsCategories.find(
		(category) => category.id === editing?.id,
	);
	const changed =
		editing &&
		(editing.name.trim() !== saved?.name || editing.color !== saved?.color);
	function edit(category: ScheduleCategory) {
		setEditing({ ...category });
		setError(null);
	}
	async function save() {
		if (!editing || saving) return;
		const parsed = scheduleCategorySettingsSchema.safeParse(editing);
		if (!parsed.success) {
			setError("캘린더 이름을 입력하세요.");
			return;
		}
		if (
			settingsCategories.some(
				(category) =>
					category.id !== editing.id && category.name === parsed.data.name,
			)
		) {
			setError("같은 이름의 캘린더가 있습니다.");
			return;
		}
		setSaving(true);
		setError(null);
		try {
			await mutateOrbit({
				data: { action: "save-schedule-category", input: parsed.data },
			});
			setEditing(parsed.data);
		} catch (error) {
			setError(
				error instanceof Error
					? error.message
					: "캘린더를 저장하지 못했습니다.",
			);
		} finally {
			setSaving(false);
		}
	}
	return (
		<Dialog
			onOpenChange={(open) => {
				if (open) {
					setEditing(null);
					setError(null);
				}
			}}
		>
			<DialogTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					aria-label="캘린더 관리"
				>
					<Settings2 />
				</Button>
			</DialogTrigger>
			<DialogContent className="max-w-sm">
				<DialogHeader>
					<DialogTitle>캘린더</DialogTitle>
					<DialogDescription className="sr-only">
						캘린더를 추가하거나 이름을 변경하세요.
					</DialogDescription>
				</DialogHeader>
				<div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
					{settingsCategories.map((category) => (
						<Button
							key={category.id}
							type="button"
							variant="ghost"
							className="justify-start"
							disabled={saving}
							onClick={() => edit(category)}
						>
							<span
								className={cn(
									"size-3 shrink-0 rounded-full",
									folderColor(category.color).dot,
								)}
							/>
							<span className="min-w-0 flex-1 truncate text-left">
								{category.name}
							</span>
							{editing?.id === category.id ? <Check /> : null}
						</Button>
					))}
				</div>
				<Button
					type="button"
					variant="outline"
					disabled={saving || categories.length >= 50}
					onClick={() =>
						edit({ id: crypto.randomUUID(), name: "", color: "violet" })
					}
				>
					<Plus /> 캘린더 추가
				</Button>
				{editing ? (
					<form
						className="grid gap-3 border-t pt-4"
						onSubmit={(event) => {
							event.preventDefault();
							void save();
						}}
					>
						<Input
							aria-label="캘린더 이름"
							placeholder="캘린더 이름"
							value={editing.name}
							maxLength={80}
							disabled={saving || editing.id === "uncategorized"}
							onChange={(event) => {
								setEditing({ ...editing, name: event.target.value });
								setError(null);
							}}
						/>
						<div className="flex items-center justify-between gap-3">
							<ItemColorPicker
								type="event"
								value={editing.color}
								label={`${editing.name || "캘린더"} 색상 선택`}
								disabled={saving}
								onChange={(color) => {
									setEditing({
										...editing,
										color:
											color ??
											(editing.id === "uncategorized" ? "slate" : "blue"),
									});
									setError(null);
								}}
							/>
							<Button
								type="submit"
								disabled={saving || !editing.name.trim() || !changed}
							>
								{saving ? "저장 중" : "저장"}
							</Button>
						</div>
					</form>
				) : null}
				{error ? (
					<p role="alert" className="text-sm text-destructive">
						{error}
					</p>
				) : null}
			</DialogContent>
		</Dialog>
	);
}
