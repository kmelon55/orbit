import { ArrowRight, CalendarDays, LoaderCircle } from "lucide-react";
import { useRef, useState } from "react";
import { formatDayKey } from "#/lib/orbit/para";
import { rangeFromMinutes, scheduleMinute } from "#/lib/orbit/schedule-range";
import type { OrbitItem } from "#/lib/orbit/schema";
import { useI18n } from "@/components/locale-provider";
import { DatePicker, TimePicker } from "@/components/schedule-controls";
import { ScheduleRangeCalendar } from "@/components/schedule-range-calendar";
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
	const { t } = useI18n();

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
			setError(t("변경하지 못했습니다. 다시 시도해 주세요."));
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
			<DialogContent className="gap-5 sm:max-w-xl">
				<DialogHeader>
					<div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
						<source.icon className="size-3.5" />
						{t(source.label)}
						<ArrowRight className="size-3" />
						<CalendarDays className="size-3.5" />
						{t("일정")}
					</div>
					<DialogTitle>{t("일정으로 바꾸기")}</DialogTitle>
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
							<span className="text-sm font-medium">{t("날짜와 시간")}</span>
							<label className="flex cursor-pointer items-center gap-2 text-sm">
								<input
									type="checkbox"
									checked={allDay}
									onChange={(event) => setAllDay(event.target.checked)}
									className="size-4 accent-foreground"
								/>
								{t("종일")}
							</label>
						</div>
						<div className="space-y-2 rounded-xl bg-muted/40 p-3">
							<div className="grid grid-cols-[1.75rem_minmax(0,1fr)] items-center gap-2 sm:grid-cols-[1.75rem_minmax(0,1fr)_9.5rem]">
								<span className="w-7 shrink-0 text-xs text-muted-foreground">
									{t("시작")}
								</span>
								<DatePicker
									value={startDate}
									onChange={(value) => {
										setStartDate(value);
										if (endDate < value) setEndDate(value);
									}}
									label={t("시작 날짜")}
									className={`w-full min-w-0 bg-background ${allDay ? "sm:col-span-2" : ""}`}
								/>
								{!allDay && (
									<TimePicker
										value={startTime}
										onChange={(time) => {
											setStartTime(time);
											if (endDate === startDate && endTime <= time) {
												const next = rangeFromMinutes(
													scheduleMinute(startDate, time),
													scheduleMinute(startDate, time) + 60,
												);
												setEndDate(next.endDate);
												setEndTime(next.endTime);
											}
										}}
										label={t("시작 시간")}
										className="col-start-2 w-full bg-background sm:col-start-auto"
									/>
								)}
							</div>
							<div className="grid grid-cols-[1.75rem_minmax(0,1fr)] items-center gap-2 sm:grid-cols-[1.75rem_minmax(0,1fr)_9.5rem]">
								<span className="w-7 shrink-0 text-xs text-muted-foreground">
									{t("종료")}
								</span>
								<DatePicker
									value={endDate}
									onChange={setEndDate}
									min={startDate}
									label={t("종료 날짜")}
									className={`w-full min-w-0 bg-background ${allDay ? "sm:col-span-2" : ""}`}
								/>
								{!allDay && (
									<TimePicker
										value={endTime}
										onChange={setEndTime}
										label={t("종료 시간")}
										className="col-start-2 w-full bg-background sm:col-start-auto"
									/>
								)}
							</div>
						</div>
						<ScheduleRangeCalendar
							value={{ startDate, endDate, startTime, endTime }}
							disabled={saving}
							onChange={(range) => {
								setStartDate(range.startDate);
								setEndDate(range.endDate);
								setStartTime(range.startTime);
								setEndTime(range.endTime);
							}}
						/>
					</fieldset>
					{(invalid || error) && (
						<p role="alert" className="text-xs text-destructive">
							{invalid ? t("종료는 시작보다 뒤여야 합니다.") : error}
						</p>
					)}
					<div className="flex justify-end gap-2">
						<Button
							type="button"
							variant="ghost"
							disabled={saving}
							onClick={onClose}
						>
							{t("취소")}
						</Button>
						<Button type="submit" disabled={saving || invalid}>
							{saving ? (
								<LoaderCircle className="size-4 animate-spin" />
							) : (
								<CalendarDays className="size-4" />
							)}
							{t("일정으로 바꾸기")}
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}
