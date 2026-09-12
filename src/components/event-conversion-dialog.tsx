import { ArrowRight, CalendarDays, LoaderCircle } from "lucide-react";
import { useRef, useState } from "react";
import { formatDayKey } from "#/lib/orbit/para";
import type { OrbitItem } from "#/lib/orbit/schema";
import { DatePicker, TimePicker } from "@/components/schedule-controls";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { ITEM_KINDS } from "./item-type-menu";

export type EventConversion = { start: string; end: string };

// Mounted for each conversion so cancelled dates never leak into another item.
export function EventConversionDialog({
	item,
	onClose,
	onConvert,
}: {
	item: OrbitItem;
	onClose: () => void;
	onConvert: (schedule: EventConversion) => Promise<void>;
}) {
	const value = item.start ?? item.due;
	const initialDate = value?.slice(0, 10) ?? formatDayKey();
	const initialTime = value?.match(/T(\d{2}:\d{2})/)?.[1] ?? "09:00";
	const initialEnd = new Date(`${initialDate}T${initialTime}:00`);
	initialEnd.setHours(initialEnd.getHours() + 1);
	const [startDate, setStartDate] = useState(initialDate);
	const [endDate, setEndDate] = useState(
		item.end?.slice(0, 10) ?? formatDayKey(initialEnd),
	);
	const [startTime, setStartTime] = useState(initialTime);
	const [endTime, setEndTime] = useState(
		item.end?.match(/T(\d{2}:\d{2})/)?.[1] ??
			`${String(initialEnd.getHours()).padStart(2, "0")}:${String(initialEnd.getMinutes()).padStart(2, "0")}`,
	);
	const [allDay, setAllDay] = useState(!value?.includes("T"));
	const [saving, setSaving] = useState(false);
	const savingRef = useRef(false);
	const [error, setError] = useState<string>();
	const invalid =
		endDate < startDate ||
		(!allDay && endDate === startDate && endTime <= startTime);
	const source = ITEM_KINDS[item.type === "task" ? "task" : "note"];
	async function submit() {
		if (savingRef.current || invalid) return;
		savingRef.current = true;
		setSaving(true);
		setError(undefined);
		try {
			await onConvert({
				start: allDay ? startDate : `${startDate}T${startTime}:00`,
				end: allDay ? endDate : `${endDate}T${endTime}:00`,
			});
			onClose();
		} catch {
			setError("변경하지 못했습니다. 다시 시도해 주세요.");
		} finally {
			savingRef.current = false;
			setSaving(false);
		}
	}
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !savingRef.current) onClose();
			}}
		>
			<DialogContent className="gap-5 sm:max-w-md">
				<DialogHeader>
					<div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
						<source.icon className="size-3.5" />
						{source.label}
						<ArrowRight className="size-3" />
						<CalendarDays className="size-3.5" />
						일정
					</div>
					<DialogTitle>일정으로 바꾸기</DialogTitle>
					<DialogDescription className="break-words">
						{item.title}
					</DialogDescription>
				</DialogHeader>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						void submit();
					}}
					className="space-y-4"
				>
					<fieldset disabled={saving} className="min-w-0 space-y-3">
						<div className="flex items-center justify-between">
							<span className="text-sm font-medium">날짜와 시간</span>
							<label className="flex cursor-pointer items-center gap-2 text-sm">
								<input
									type="checkbox"
									checked={allDay}
									onChange={(event) => setAllDay(event.target.checked)}
									className="size-4 accent-foreground"
								/>
								종일
							</label>
						</div>
						<div className="space-y-2 rounded-xl bg-muted/40 p-3">
							<div className="grid grid-cols-[1.75rem_minmax(0,1fr)] items-center gap-2 sm:grid-cols-[1.75rem_minmax(0,1fr)_auto]">
								<span className="w-7 shrink-0 text-xs text-muted-foreground">
									시작
								</span>
								<DatePicker
									value={startDate}
									onChange={(value) => {
										setStartDate(value);
										if (endDate < value) setEndDate(value);
									}}
									label="시작 날짜"
									className="min-w-0 flex-1 bg-background"
								/>
								{!allDay && (
									<TimePicker
										value={startTime}
										onChange={setStartTime}
										label="시작 시간"
										className="col-start-2 bg-background sm:col-start-auto"
									/>
								)}
							</div>
							<div className="grid grid-cols-[1.75rem_minmax(0,1fr)] items-center gap-2 sm:grid-cols-[1.75rem_minmax(0,1fr)_auto]">
								<span className="w-7 shrink-0 text-xs text-muted-foreground">
									종료
								</span>
								<DatePicker
									value={endDate}
									onChange={setEndDate}
									min={startDate}
									label="종료 날짜"
									className="min-w-0 flex-1 bg-background"
								/>
								{!allDay && (
									<TimePicker
										value={endTime}
										onChange={setEndTime}
										label="종료 시간"
										className="col-start-2 bg-background sm:col-start-auto"
									/>
								)}
							</div>
						</div>
					</fieldset>
					{(invalid || error) && (
						<p role="alert" className="text-xs text-destructive">
							{invalid ? "종료는 시작보다 뒤여야 합니다." : error}
						</p>
					)}
					<div className="flex justify-end gap-2">
						<Button
							type="button"
							variant="ghost"
							disabled={saving}
							onClick={onClose}
						>
							취소
						</Button>
						<Button type="submit" disabled={saving || invalid}>
							{saving ? (
								<LoaderCircle className="size-4 animate-spin" />
							) : (
								<CalendarDays className="size-4" />
							)}
							일정으로 바꾸기
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}
