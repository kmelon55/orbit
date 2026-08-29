import { ArrowUp, CalendarDays, FileText, ListTodo } from "lucide-react";
import { type FormEvent, useState } from "react";
import { mutateOrbit } from "#/lib/orbit/functions";
import { formatDayKey, ITEM_TYPE_LABEL } from "#/lib/orbit/para";
import type { OrbitItemType } from "#/lib/orbit/schema";
import { DatePicker, TimePicker } from "@/components/schedule-controls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

const KINDS: { type: OrbitItemType; icon: typeof FileText }[] = [
	{ type: "note", icon: FileText },
	{ type: "task", icon: ListTodo },
	{ type: "event", icon: CalendarDays },
];

export function QuickCapture({
	onSaved,
	placeholder = "생각나는 것을 일단 적어두세요",
}: {
	onSaved?: () => void;
	placeholder?: string;
}) {
	const [capture, setCapture] = useState("");
	const [kind, setKind] = useState<OrbitItemType>("note");
	const [date, setDate] = useState(() => formatDayKey());
	const [startTime, setStartTime] = useState("09:00");
	const [endTime, setEndTime] = useState("10:00");
	const [isSaving, setIsSaving] = useState(false);
	const [message, setMessage] = useState<string | null>(null);

	async function handleCapture(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const title = capture.trim();
		if (!title || isSaving) return;
		setIsSaving(true);
		setMessage(null);
		try {
			const schedule =
				kind === "task"
					? { due: date }
					: kind === "event"
						? {
								start: `${date}T${startTime}:00`,
								end: `${date}T${endTime}:00`,
							}
						: {};
			await mutateOrbit({
				data:
					kind === "event"
						? {
								action: "create-item",
								input: {
									title,
									type: kind,
									body: "",
									space: "event",
									...schedule,
								},
							}
						: {
								action: "capture",
								input: { title, type: kind, body: "", ...schedule },
							},
			});
			setCapture("");
			setMessage(
				kind === "event" ? "캘린더에 추가했습니다." : "Inbox에 넣었습니다.",
			);
			onSaved?.();
		} catch {
			setMessage("저장하지 못했습니다. 데이터 폴더 권한을 확인해 주세요.");
		} finally {
			setIsSaving(false);
		}
	}

	return (
		<form onSubmit={handleCapture} className="orbit-card p-3">
			<div className="flex items-center gap-2">
				<Input
					value={capture}
					onChange={(event) => setCapture(event.target.value)}
					placeholder={placeholder}
					aria-label="빠른 기록"
					className="h-11 border-0 bg-transparent text-base shadow-none focus-visible:ring-0"
				/>
				<Button
					type="submit"
					size="icon"
					disabled={!capture.trim() || isSaving}
				>
					<ArrowUp />
					<span className="sr-only">Inbox에 넣기</span>
				</Button>
			</div>
			<Separator className="my-2" />
			{kind === "task" || kind === "event" ? (
				<div className="flex flex-wrap items-center gap-2 px-1 pb-2">
					<DatePicker
						value={date}
						onChange={setDate}
						label={kind === "task" ? "마감 날짜" : "일정 날짜"}
						className="h-8 w-auto max-w-44 px-2.5 text-xs"
					/>
					{kind === "event" ? (
						<>
							<TimePicker
								value={startTime}
								onChange={setStartTime}
								label="시작 시간"
								className="h-8 w-24 px-2.5 text-xs"
							/>
							<span className="text-xs text-muted-foreground">–</span>
							<TimePicker
								value={endTime}
								onChange={setEndTime}
								label="종료 시간"
								className="h-8 w-24 px-2.5 text-xs"
							/>
						</>
					) : (
						<span className="text-xs text-muted-foreground">마감 날짜</span>
					)}
				</div>
			) : null}
			<div className="flex flex-wrap items-center justify-between gap-2 px-1">
				<div className="flex flex-wrap gap-1">
					{KINDS.map(({ type, icon: Icon }) => (
						<Button
							key={type}
							type="button"
							size="sm"
							variant={kind === type ? "secondary" : "ghost"}
							onClick={() => {
								setKind(type);
								setMessage(null);
							}}
						>
							<Icon /> {ITEM_TYPE_LABEL[type]}
						</Button>
					))}
				</div>
				{message && (
					<output className="text-xs text-muted-foreground">{message}</output>
				)}
			</div>
		</form>
	);
}
