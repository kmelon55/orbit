import {
	isRoutineDue,
	type RoutineData,
	routineRecordKey,
	routineStatus,
	routineTimerProgress,
	routineToday,
} from "./routines";

export function shiftRoutineDay(day: string, amount: number) {
	const date = new Date(`${day}T12:00:00Z`);
	date.setUTCDate(date.getUTCDate() + amount);
	return date.toISOString().slice(0, 10);
}
export function buildRoutineActivity(
	data: RoutineData,
	year: number,
	id?: string,
	now = new Date(),
) {
	const routine = data.routines.find((entry) => entry.id === id);
	const today = routineToday(
		routine?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
		now,
	);
	const start = `${year}-01-01`,
		end = `${year}-12-31`;
	const counts = new Map<string, number>(),
		skips = new Map<string, number>(),
		focus = new Map<string, number>();
	for (const record of Object.values(data.records)) {
		if (id && record.routineId !== id) continue;
		const target = record.status === "done" ? counts : skips;
		target.set(record.day, (target.get(record.day) ?? 0) + 1);
	}
	for (const timer of Object.values(data.timers)) {
		if (id && timer.routineId !== id) continue;
		focus.set(
			timer.day,
			(focus.get(timer.day) ?? 0) + routineTimerProgress(timer, now).totalMs,
		);
	}
	const first = shiftRoutineDay(
		start,
		-new Date(`${start}T12:00:00Z`).getUTCDay(),
	);
	const last = shiftRoutineDay(
		end,
		6 - new Date(`${end}T12:00:00Z`).getUTCDay(),
	);
	const days = [];
	let completed = 0,
		activeDays = 0,
		focusMs = 0,
		bestStreak = 0,
		streak = 0;
	for (let day = first; day <= last; day = shiftRoutineDay(day, 1)) {
		const inYear = day >= start && day <= end;
		const count = counts.get(day) ?? 0;
		const spent = focus.get(day) ?? 0;
		days.push({
			day,
			count,
			skipped: skips.get(day) ?? 0,
			focusMs: spent,
			available: inYear && day <= today,
		});
		if (!inYear || day > today) continue;
		completed += count;
		activeDays += count > 0 ? 1 : 0;
		focusMs += spent;
		const scheduled =
			!routine ||
			isRoutineDue({ ...routine, enabled: true, archived: false }, day);
		if (scheduled) {
			streak = count > 0 ? streak + 1 : 0;
			bestStreak = Math.max(bestStreak, streak);
		}
	}
	// Today stays open until its first completion, rather than prematurely breaking a streak.
	let currentStreak = 0;
	const earliest =
		routine?.createdDay ??
		data.routines.map((entry) => entry.createdDay).sort()[0] ??
		today;
	for (
		let day = (counts.get(today) ?? 0) > 0 ? today : shiftRoutineDay(today, -1);
		day >= earliest;
		day = shiftRoutineDay(day, -1)
	) {
		if (
			routine &&
			!isRoutineDue({ ...routine, enabled: true, archived: false }, day)
		)
			continue;
		if (!(counts.get(day) ?? 0)) break;
		currentStreak++;
	}
	return {
		days,
		completed,
		activeDays,
		focusMs,
		currentStreak,
		bestStreak,
		today,
	};
}

export function routineDayDetails(data: RoutineData, day: string, id?: string) {
	return data.routines
		.filter(
			(routine) =>
				(!id || routine.id === id) &&
				(isRoutineDue(routine, day) ||
					data.records[routineRecordKey(routine.id, day)] ||
					data.timers[routineRecordKey(routine.id, day)]),
		)
		.map((routine) => ({
			routine,
			status: routineStatus(data, routine.id, day),
			timer: data.timers[routineRecordKey(routine.id, day)],
		}));
}
