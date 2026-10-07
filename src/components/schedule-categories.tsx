import { CalendarDays, Check, ListTodo, Plus, Settings2 } from "lucide-react";
import { Popover } from "radix-ui";
import { type ReactNode, useId, useState } from "react";
import { toast } from "sonner";
import { FOLDER_COLOR_VALUES, folderColor } from "#/lib/orbit/folder-colors";
import { mutateOrbit } from "#/lib/orbit/functions";
import {
	DEFAULT_SCHEDULE_CATEGORIES,
	scheduleCategoryLabel,
} from "#/lib/orbit/schedule-categories";
import {
	type ScheduleCategory,
	scheduleCategorySettingsSchema,
} from "#/lib/orbit/schema";
import { ItemColorPicker } from "@/components/item-color-picker";
import { useI18n } from "@/components/locale-provider";
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
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

function useScheduleCategories() {
	const { locale } = useI18n();
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
	return categories.map((category) => ({
		...category,
		displayName: scheduleCategoryLabel(category, locale),
	}));
}

function useUncategorizedCategory(): ScheduleCategory & {
	displayName: string;
} {
	const { locale } = useI18n();
	const snapshot = useOrbitSnapshot();
	const name = snapshot.uncategorizedScheduleName ?? "미분류";
	return {
		id: "uncategorized",
		name,
		displayName: scheduleCategoryLabel({ id: "uncategorized", name }, locale),
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
	const { t } = useI18n();

	const categories = useScheduleCategories();
	const selected = categories.find((category) => category.id === value);
	const uncategorized = useUncategorizedCategory();
	const triggerId = useId();
	return (
		<div className="flex items-center gap-3 text-sm">
			<CalendarDays
				aria-hidden="true"
				className="size-4 shrink-0 text-muted-foreground"
			/>
			<label htmlFor={triggerId}>{t("캘린더")}</label>
			<Select
				value={value ?? "uncategorized"}
				onValueChange={(next) =>
					onChange(next === "uncategorized" ? undefined : next)
				}
			>
				<SelectTrigger
					id={triggerId}
					aria-label={t("캘린더")}
					className="h-9 min-w-0 flex-1 bg-background px-3"
				>
					<SelectValue className="min-w-0 flex-1 text-left">
						<span
							aria-hidden="true"
							className={cn(
								"size-3 shrink-0 rounded-full",
								folderColor(selected?.color ?? uncategorized.color).dot,
							)}
						/>
						<span className="truncate">
							{selected?.displayName ?? value ?? uncategorized.displayName}
						</span>
					</SelectValue>
				</SelectTrigger>
				<SelectContent
					position="popper"
					align="start"
					className="max-w-[calc(100vw-2rem)]"
				>
					<SelectGroup>
						<SelectItem
							value="uncategorized"
							textValue={uncategorized.displayName}
							className="py-2 [&>span:last-child]:min-w-0"
						>
							<span
								aria-hidden="true"
								className={cn(
									"size-3 shrink-0 rounded-full",
									folderColor(uncategorized.color).dot,
								)}
							/>
							<span className="truncate">{uncategorized.displayName}</span>
						</SelectItem>
						{categories.map((category) => (
							<SelectItem
								key={category.id}
								value={category.id}
								textValue={category.displayName}
								className="py-2 [&>span:last-child]:min-w-0"
							>
								<span
									aria-hidden="true"
									className={cn(
										"size-3 shrink-0 rounded-full",
										folderColor(category.color).dot,
									)}
								/>
								<span className="truncate">{category.displayName}</span>
							</SelectItem>
						))}
					</SelectGroup>
				</SelectContent>
			</Select>
		</div>
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
	const { t } = useI18n();

	const checkboxId = useId();
	return (
		<div className="flex items-center gap-1 rounded-lg hover:bg-muted/70">
			<label
				htmlFor={checkboxId}
				className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-2 py-1.5 text-sm"
			>
				<Checkbox
					id={checkboxId}
					aria-label={t("{0} 표시", [name])}
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
	const { t, locale } = useI18n();

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
			toast.error(t("색상을 저장하지 못했습니다."));
		} finally {
			setSaving(false);
		}
	}
	return (
		<CalendarDisplayRow
			name={scheduleCategoryLabel(category, locale)}
			visible={visible}
			onToggle={onToggle}
		>
			<ItemColorPicker
				type="event"
				value={category.color}
				compact
				label={t("{0} 색상 변경", [scheduleCategoryLabel(category, locale)])}
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
	const { t } = useI18n();

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
		<fieldset className="min-w-0" aria-label={t("달력 표시")}>
			<div className="mb-1 px-1 text-[11px] font-semibold text-muted-foreground">
				{t("표시할 항목")}
			</div>
			<div className="grid grid-cols-2 gap-1">
				{(["task", "event"] as const).map((kind) => {
					const name = kind === "event" ? t("일정") : t("할 일");
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
						{t("캘린더")}
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
	const { t } = useI18n();

	return (
		<Popover.Root>
			<Popover.Trigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					className="xl:hidden"
					aria-label={t("달력 표시와 색상")}
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
	const { t, errorText, locale } = useI18n();

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
			setError(t("캘린더 이름을 입력하세요."));
			return;
		}
		if (
			settingsCategories.some(
				(category) =>
					category.id !== editing.id && category.name === parsed.data.name,
			)
		) {
			setError(t("같은 이름의 캘린더가 있습니다."));
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
					: t("캘린더를 저장하지 못했습니다."),
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
					aria-label={t("캘린더 관리")}
				>
					<Settings2 />
				</Button>
			</DialogTrigger>
			<DialogContent className="max-w-sm">
				<DialogHeader>
					<DialogTitle>{t("캘린더")}</DialogTitle>
					<DialogDescription className="sr-only">
						{t("캘린더를 추가하거나 이름을 변경하세요.")}
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
								{scheduleCategoryLabel(category, locale)}
							</span>
							{category.id === "uncategorized" ? (
								<span className="shrink-0 text-xs text-muted-foreground">
									uncategorized
								</span>
							) : null}
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
					<Plus /> {t("캘린더 추가")}
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
							aria-label={t("캘린더 이름")}
							placeholder={t("캘린더 이름")}
							value={editing.name}
							maxLength={80}
							disabled={saving}
							onChange={(event) => {
								setEditing({ ...editing, name: event.target.value });
								setError(null);
							}}
						/>
						<div className="flex items-center justify-between gap-3">
							<ItemColorPicker
								type="event"
								value={editing.color}
								label={t("{0} 색상 선택", [editing.name || t("캘린더")])}
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
								{saving ? t("저장 중") : t("저장")}
							</Button>
						</div>
					</form>
				) : null}
				{error ? (
					<p role="alert" className="text-sm text-destructive">
						{errorText(error)}
					</p>
				) : null}
			</DialogContent>
		</Dialog>
	);
}
