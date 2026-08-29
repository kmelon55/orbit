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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const TYPES: OrbitItemType[] = ["note", "task", "event", "link"];

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

const controlClass =
	"h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none transition-[border-color,box-shadow] duration-150 ease-[var(--interaction-ease)] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40";

export function FileItemForm({
	item,
	snapshot,
	onDone,
}: {
	item: OrbitItem;
	snapshot: OrbitSnapshot;
	onDone?: () => void;
}) {
	const [title, setTitle] = useState(item.title);
	const [body, setBody] = useState(item.body);
	const [type, setType] = useState<OrbitItemType>(item.type);
	const [space, setSpace] = useState<OrbitSpace>(
		item.space === "inbox" ? "project" : item.space,
	);
	const [folder, setFolder] = useState(item.folder ?? "");
	const [newFolder, setNewFolder] = useState("");
	const [due, setDue] = useState(item.due?.slice(0, 10) ?? "");
	const [dueTime, setDueTime] = useState(
		item.due?.match(/T(\d{2}:\d{2})/)?.[1] ?? "",
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
	const [url, setUrl] = useState(item.url ?? "");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const paraSpace =
		space === "project" || space === "area" || space === "resource";
	const folders = paraSpace ? snapshot.folders[space] : [];
	const resolvedFolder = newFolder.trim() || folder || undefined;

	async function handleSubmit() {
		if (!title.trim() || saving) return;
		if (type === "event" && endDate === startDate && endTime <= startTime) {
			setError("종료 시간은 시작 시간보다 뒤여야 합니다.");
			return;
		}
		setSaving(true);
		setError(null);
		try {
			const start =
				type === "event" && startDate
					? `${startDate}T${startTime || "09:00"}:00`
					: undefined;
			const end =
				type === "event" && endDate
					? `${endDate}T${endTime || "10:00"}:00`
					: undefined;
			await mutateOrbit({
				data: {
					action: "file-item",
					id: item.id,
					input: {
						title: title.trim(),
						body,
						type,
						space: type === "event" && space !== "archive" ? "event" : space,
						folder: paraSpace ? resolvedFolder : undefined,
						due:
							type === "task" && due
								? dueTime
									? `${due}T${dueTime}:00`
									: due
								: undefined,
						start,
						end,
						url: type === "link" && url ? url : undefined,
					},
				},
			});
			onDone?.();
		} catch {
			setError("옮기지 못했습니다. 폴더 이름과 권한을 확인해 주세요.");
		} finally {
			setSaving(false);
		}
	}

	return (
		<div className="grid gap-5">
			<Field label="제목">
				<Input
					value={title}
					onChange={(event) => setTitle(event.target.value)}
					className="h-9"
				/>
			</Field>

			<div className="grid gap-1.5">
				<span className="text-xs font-medium text-foreground/75">종류</span>
				<div className="flex flex-wrap gap-1">
					{TYPES.map((value) => (
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
							{ITEM_TYPE_LABEL[value]}
						</Button>
					))}
				</div>
			</div>

			<div className="grid gap-1.5">
				<span className="text-xs font-medium text-foreground/75">
					어디로 옮길까요?
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
							<p className="text-sm font-medium">{destination.label}</p>
							<p className="mt-0.5 text-xs leading-5 text-muted-foreground">
								{destination.hint}
							</p>
						</button>
					))}
				</div>
			</div>

			{paraSpace && (
				<div className="grid gap-3 sm:grid-cols-2">
					<Field label="폴더">
						<select
							value={folder}
							onChange={(event) => setFolder(event.target.value)}
							className={controlClass}
						>
							<option value="">루트 (폴더 없음)</option>
							{folders.map((entry) => (
								<option key={entry.slug} value={entry.slug}>
									{entry.slug}
								</option>
							))}
						</select>
					</Field>
					<Field label="새 폴더">
						<Input
							value={newFolder}
							onChange={(event) => setNewFolder(event.target.value)}
							placeholder="없으면 위에서 선택"
							className="h-9"
						/>
					</Field>
				</div>
			)}

			{type === "task" && (
				<div className="grid gap-3 sm:grid-cols-2">
					<Field label="마감 날짜">
						<Input
							type="date"
							value={due}
							onChange={(event) => setDue(event.target.value)}
							className="h-9"
						/>
					</Field>
					<Field label="시간 (선택)">
						<Input
							type="time"
							value={dueTime}
							onChange={(event) => setDueTime(event.target.value)}
							className="h-9"
						/>
					</Field>
				</div>
			)}

			{type === "event" && (
				<div className="grid gap-3 sm:grid-cols-2">
					<Field label="시작 날짜">
						<Input
							type="date"
							value={startDate}
							onChange={(event) => {
								setStartDate(event.target.value);
								if (endDate < event.target.value)
									setEndDate(event.target.value);
							}}
							className="h-9"
						/>
					</Field>
					<Field label="시작 시간">
						<Input
							type="time"
							value={startTime}
							onChange={(event) => setStartTime(event.target.value)}
							className="h-9"
						/>
					</Field>
					<Field label="종료 날짜">
						<Input
							type="date"
							value={endDate}
							min={startDate}
							onChange={(event) => setEndDate(event.target.value)}
							className="h-9"
						/>
					</Field>
					<Field label="종료 시간">
						<Input
							type="time"
							value={endTime}
							onChange={(event) => setEndTime(event.target.value)}
							className="h-9"
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

			<Field label="내용">
				<Textarea
					value={body}
					onChange={(event) => setBody(event.target.value)}
					placeholder="필요한 만큼만 적어두세요"
					className="min-h-28"
				/>
			</Field>

			{error && <p className="text-sm text-destructive">{error}</p>}

			<Button
				type="button"
				onClick={() => void handleSubmit()}
				disabled={!title.trim() || saving}
			>
				{saving ? "옮기는 중" : "여기로 분류"}
			</Button>
		</div>
	);
}
