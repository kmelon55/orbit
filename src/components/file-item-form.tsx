import { type ReactNode, useState } from "react";
import { mutateOrbit } from "#/lib/orbit/functions";
import {
	ARCHIVE_SPACE,
	formatDayKey,
	ITEM_TYPE_LABEL,
	PARA_SPACES,
} from "#/lib/orbit/para";
import type {
	OrbitItem,
	OrbitItemType,
	OrbitSnapshot,
	OrbitSpace,
} from "#/lib/orbit/schema";
import { useI18n } from "@/components/locale-provider";
import { DatePicker, TimePicker } from "@/components/schedule-controls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const TYPES: OrbitItemType[] = ["note", "task", "event"];

const DESTINATIONS: {
	space: OrbitSpace;
	label: string;
	hint: string;
}[] = [
	...PARA_SPACES.map((space) => ({
		space: space.space,
		label: space.label,
		hint: space.description,
	})),
	{
		space: "event" as const,
		label: "Calendar",
		hint: "날짜가 있는 일정",
	},
	{
		space: ARCHIVE_SPACE.space,
		label: ARCHIVE_SPACE.label,
		hint: ARCHIVE_SPACE.description,
	},
];

function Field({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="grid gap-1.5">
			<p className="text-xs font-medium text-foreground/75">{label}</p>
			{children}
		</div>
	);
}

export function FileItemForm({
	item,
	snapshot,
	onDone,
}: {
	item: OrbitItem;
	snapshot: OrbitSnapshot;
	onDone?: () => void;
}) {
	const { t, errorText } = useI18n();

	const [title, setTitle] = useState(item.title);
	const [body, setBody] = useState(item.body);
	const color = item.color;
	const [type, setType] = useState<OrbitItemType>(item.type);
	const [space, setSpace] = useState<OrbitSpace>(
		item.space === "inbox" ? "project" : item.space,
	);
	const [folder, setFolder] = useState(item.folder ?? "");
	const [newFolder, setNewFolder] = useState("");
	const [due, setDue] = useState((item.start ?? item.due)?.slice(0, 10) ?? "");
	const [dueTime, setDueTime] = useState(
		(item.start ?? item.due)?.match(/T(\d{2}:\d{2})/)?.[1] ?? "",
	);
	const [startDate, setStartDate] = useState(
		item.start?.slice(0, 10) ?? formatDayKey(),
	);
	const [startTime, setStartTime] = useState(
		item.start?.match(/T(\d{2}:\d{2})/)?.[1] ?? "09:00",
	);
	const [endDate, setEndDate] = useState(
		item.end?.slice(0, 10) ?? item.start?.slice(0, 10) ?? formatDayKey(),
	);
	const [endTime, setEndTime] = useState(
		item.end?.match(/T(\d{2}:\d{2})/)?.[1] ?? "10:00",
	);
	const [taskEndDate, setTaskEndDate] = useState(item.end?.slice(0, 10) ?? "");
	const [taskEndTime, setTaskEndTime] = useState(
		item.end?.match(/T(\d{2}:\d{2})/)?.[1] ?? "10:00",
	);
	const [url, setUrl] = useState(item.url ?? "");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const folderSpace =
		space === "project" ||
		space === "area" ||
		space === "resource" ||
		space === "archive";
	const folders = folderSpace ? snapshot.folders[space] : [];
	const resolvedFolder = newFolder.trim() || folder || undefined;
	const visibleTypes =
		item.type === "link"
			? ([...TYPES, "link"] satisfies OrbitItemType[])
			: TYPES;

	async function handleSubmit() {
		if (!title.trim() || saving) return;
		if (
			(type === "event" &&
				(endDate < startDate ||
					(endDate === startDate && endTime <= startTime))) ||
			(type === "task" &&
				taskEndDate &&
				(!due ||
					taskEndDate < due ||
					(dueTime && taskEndDate === due && taskEndTime <= dueTime)))
		) {
			setError(t("종료는 시작보다 뒤여야 합니다."));
			return;
		}
		setSaving(true);
		setError(null);
		try {
			const taskDue = due
				? dueTime
					? `${due}T${dueTime}:00`
					: due
				: undefined;
			const start =
				type === "event" && startDate
					? `${startDate}T${startTime || "09:00"}:00`
					: type === "task" && taskEndDate
						? taskDue
						: undefined;
			const end =
				type === "event" && endDate
					? `${endDate}T${endTime || "10:00"}:00`
					: type === "task" && taskEndDate
						? dueTime
							? `${taskEndDate}T${taskEndTime}:00`
							: taskEndDate
						: undefined;

			await mutateOrbit({
				data: {
					action: "file-item",
					id: item.id,
					input: {
						title: title.trim(),
						body,
						type,
						color: color ?? null,
						space: type === "event" && space !== "archive" ? "event" : space,
						folder: folderSpace ? resolvedFolder : undefined,
						due: type === "task" ? (taskDue ?? null) : null,
						start: start ?? null,
						end: end ?? null,
						url: type === "link" && url ? url : undefined,
					},
				},
			});
			onDone?.();
		} catch {
			setError(t("옮기지 못했습니다. 폴더 이름과 권한을 확인해 주세요."));
		} finally {
			setSaving(false);
		}
	}

	return (
		<div className="grid gap-5">
			<Field label={t("제목")}>
				<Input
					value={title}
					onChange={(event) => setTitle(event.target.value)}
					className="h-9"
				/>
			</Field>

			<div className="grid gap-1.5">
				<span className="text-xs font-medium text-foreground/75">
					{t("종류")}
				</span>
				<div className="flex flex-wrap gap-1">
					{visibleTypes.map((value) => (
						<Button
							key={value}
							type="button"
							size="sm"
							variant={type === value ? "secondary" : "ghost"}
							onClick={() => {
								setType(value);
								if (value === "event") setSpace("event");
							}}
						>
							{t(ITEM_TYPE_LABEL[value])}
						</Button>
					))}
				</div>
			</div>

			<div className="grid gap-1.5">
				<span className="text-xs font-medium text-foreground/75">
					{t("어디로 옮길까요?")}
				</span>
				<div className="grid gap-1.5 sm:grid-cols-2">
					{DESTINATIONS.map((destination) => (
						<button
							key={destination.space}
							type="button"
							onClick={() => setSpace(destination.space)}
							className={cn(
								"rounded-lg border px-3 py-2.5 text-left transition-colors duration-150",
								space === destination.space
									? "border-foreground/20 bg-accent"
									: "hover:border-foreground/15 hover:bg-muted/70",
							)}
						>
							<p className="text-sm font-medium">{t(destination.label)}</p>
							<p className="mt-0.5 text-xs leading-5 text-muted-foreground">
								{t(destination.hint)}
							</p>
						</button>
					))}
				</div>
			</div>

			{folderSpace && (
				<div className="grid gap-3 sm:grid-cols-2">
					<Field label={t("폴더")}>
						<Select
							value={folder ? `folder:${folder}` : "root"}
							onValueChange={(value) =>
								setFolder(value === "root" ? "" : value.slice(7))
							}
						>
							<SelectTrigger
								aria-label={t("폴더")}
								className="h-9 w-full min-w-0 bg-background"
							>
								<SelectValue className="min-w-0 flex-1 text-left">
									<span className="truncate">
										{folder || t("루트 (폴더 없음)")}
									</span>
								</SelectValue>
							</SelectTrigger>
							<SelectContent
								position="popper"
								align="start"
								className="max-w-[calc(100vw-2rem)]"
							>
								<SelectGroup>
									<SelectItem value="root" className="py-2">
										{t("루트 (폴더 없음)")}
									</SelectItem>
									{folders.map((entry) => (
										<SelectItem
											key={entry.slug}
											value={`folder:${entry.slug}`}
											textValue={entry.slug}
											className="py-2 [&>span:last-child]:min-w-0"
										>
											<span className="truncate">{entry.slug}</span>
										</SelectItem>
									))}
								</SelectGroup>
							</SelectContent>
						</Select>
					</Field>
					<Field label={t("새 폴더")}>
						<Input
							value={newFolder}
							onChange={(event) => setNewFolder(event.target.value)}
							placeholder={t("없으면 위에서 선택")}
							className="h-9"
						/>
					</Field>
				</div>
			)}

			{type === "task" && (
				<div className="grid gap-3 sm:grid-cols-2">
					<Field label={t("시작 날짜")}>
						<DatePicker
							value={due}
							onChange={(value) => {
								setDue(value);
								if (!value) setTaskEndDate("");
								else if (taskEndDate && taskEndDate < value)
									setTaskEndDate(value);
							}}
							label={t("시작 날짜")}
							allowClear
							className="w-full"
						/>
					</Field>
					<Field label={t("시간 (선택)")}>
						<TimePicker
							value={dueTime}
							onChange={setDueTime}
							label={t("시작 시간")}
							placeholder={t("시간 없음")}
							allowEmpty
							className="w-full"
						/>
					</Field>
					<Field label={t("종료 날짜")}>
						<DatePicker
							value={taskEndDate}
							min={due}
							onChange={setTaskEndDate}
							label={t("종료 날짜")}
							allowClear
							disabled={!due}
							className="w-full"
						/>
					</Field>
					{dueTime ? (
						<Field label={t("종료 시간")}>
							<TimePicker
								value={taskEndTime}
								onChange={setTaskEndTime}
								label={t("종료 시간")}
								disabled={!taskEndDate}
								className="w-full"
							/>
						</Field>
					) : null}
				</div>
			)}

			{type === "event" && (
				<div className="grid gap-3 sm:grid-cols-2">
					<Field label={t("시작 날짜")}>
						<DatePicker
							value={startDate}
							onChange={(value) => {
								setStartDate(value);
								if (endDate < value) setEndDate(value);
							}}
							label={t("시작 날짜")}
							className="w-full"
						/>
					</Field>
					<Field label={t("시작 시간")}>
						<TimePicker
							value={startTime}
							onChange={setStartTime}
							label={t("시작 시간")}
							className="w-full"
						/>
					</Field>
					<Field label={t("종료 날짜")}>
						<DatePicker
							value={endDate}
							min={startDate}
							onChange={setEndDate}
							label={t("종료 날짜")}
							className="w-full"
						/>
					</Field>
					<Field label={t("종료 시간")}>
						<TimePicker
							value={endTime}
							onChange={setEndTime}
							label={t("종료 시간")}
							className="w-full"
						/>
					</Field>
				</div>
			)}

			{type === "link" && (
				<Field label="URL">
					<Input
						type="url"
						value={url}
						onChange={(event) => setUrl(event.target.value)}
						placeholder="https://"
						className="h-9"
					/>
				</Field>
			)}

			<Field label={t("내용")}>
				<Textarea
					value={body}
					onChange={(event) => setBody(event.target.value)}
					placeholder={t("필요한 만큼만 적어두세요")}
					className="min-h-28"
				/>
			</Field>

			{error && <p className="text-sm text-destructive">{errorText(error)}</p>}

			<Button
				type="button"
				onClick={() => void handleSubmit()}
				disabled={!title.trim() || saving}
			>
				{saving ? t("옮기는 중") : t("여기로 분류")}
			</Button>
		</div>
	);
}
