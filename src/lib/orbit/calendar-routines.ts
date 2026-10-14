import type { CalendarDragTarget } from "./calendar-resize";
import { moveCalendarItem } from "./calendar-schedule";
import { formatDayKey } from "./para";
import {
	isRoutineDue,
	type Routine,
	type RoutineData,
	routineRecordKey,
	routineStatus,
	routineToday,
} from "./routines";
import type { OrbitItem } from "./schema";

export type CalendarRoutineItem = OrbitItem & {
	routine: {
		source: Routine;
		day: string;
		status: "open" | "done" | "skipped";
	};
};

export function isCalendarRoutine(
	item: OrbitItem,
): item is CalendarRoutineItem {
	return "routine" in item;
}

export function moveCalendarRoutine(
	item: CalendarRoutineItem,
	target: CalendarDragTarget,
) {
	const next = moveCalendarItem(item, target);
	if (!item.start?.includes("T") && next.start?.includes("T")) {
		const end = new Date(next.start);
		end.setMinutes(end.getMinutes() + item.routine.source.durationMinutes);
		return {
			...next,
			end: `${formatDayKey(end)}T${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}:00`,
		};
	}
	return next;
}

// Occurrences are view data only; completion writes the original routine/day record.
export function calendarRoutineItems(
	data: RoutineData,
	days: string[],
	now = new Date(),
): CalendarRoutineItem[] {
	const todayByZone = new Map<string, string>();
	const plannedDays = Object.values(data.schedules ?? {})
		.filter((schedule) =>
			days.some(
				(day) =>
					day >= schedule.start.slice(0, 10) &&
					day <= (schedule.end ?? schedule.start).slice(0, 10),
			),
		)
		.map((schedule) => schedule.day);
	return [...new Set([...days, ...plannedDays])].flatMap((day) =>
		data.routines.flatMap((routine): CalendarRoutineItem[] => {
			const status = routineStatus(data, routine.id, day);
			const schedule = data.schedules?.[routineRecordKey(routine.id, day)];
			if (
				routine.archived ||
				(!isRoutineDue(routine, day) &&
					status === "open" &&
					(!schedule || !routine.enabled))
			)
				return [];
			let start =
				routine.moment === "time" && routine.time
					? `${day}T${routine.time}:00`
					: day;
			let end: string | undefined;
			if (start.includes("T")) {
				const finish = new Date(`${day}T${routine.time}:00`);
				finish.setMinutes(finish.getMinutes() + routine.durationMinutes);
				end = `${formatDayKey(finish)}T${String(finish.getHours()).padStart(2, "0")}:${String(finish.getMinutes()).padStart(2, "0")}:00`;
			}
			if (schedule) {
				start = schedule.start;
				end = schedule.end;
			}
			if (status === "open" && !start.includes("T")) {
				let today = todayByZone.get(routine.timeZone);
				if (!today) {
					today = routineToday(routine.timeZone, now);
					todayByZone.set(routine.timeZone, today);
				}
				// Use the effective end date so moved and ongoing occurrences stay visible.
				if ((end ?? start).slice(0, 10) < today) return [];
			}
			return [
				{
					id: `routine:${routine.id}:${day}`,
					title: routine.title,
					type: "task",
					space: "inbox",
					status: status === "done" ? "done" : "open",
					start,
					end,
					tags: [],
					created: routine.createdDay,
					updated: day,
					body: "",
					path: "",
					routine: { source: routine, day, status },
				},
			];
		}),
	);
}
