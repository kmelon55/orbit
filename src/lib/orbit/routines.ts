import { z } from "zod";
import { intlLocale, type Locale, translate, weekdayName } from "../i18n";

export const ROUTINE_DAYS = ["일", "월", "화", "수", "목", "금", "토"];
export const ROUTINE_MOMENTS = {
	anytime: "시간 없음",
	morning: "아침",
	afternoon: "점심",
	evening: "저녁",
	bedtime: "자기 전",
	time: "시간 지정",
} as const;

export const routineDaySchema = z.iso.date();
export const routineInputSchema = z
	.object({
		timeZone: z
			.string()
			.min(1)
			.max(80)
			.refine((value) => {
				try {
					new Intl.DateTimeFormat("en", { timeZone: value });
					return true;
				} catch {
					return false;
				}
			})
			.default("Asia/Seoul"),
		id: z.string().uuid(),
		title: z.string().trim().min(1).max(160),
		weekdays: z
			.array(z.number().int().min(0).max(6))
			.min(1)
			.max(7)
			.transform((days) => [...new Set(days)].sort()),
		moment: z.enum([
			"anytime",
			"morning",
			"afternoon",
			"evening",
			"bedtime",
			"time",
		]),
		time: z
			.string()
			.regex(/^([01]\d|2[0-3]):[0-5]\d$/)
			.nullable(),
		enabled: z.boolean(),
		durationMinutes: z.number().int().min(1).max(240).default(25),
	})
	.refine((value) => value.moment !== "time" || value.time !== null, {
		message: "시간을 선택해 주세요.",
		path: ["time"],
	});
export const routineSchema = routineInputSchema.safeExtend({
	createdDay: routineDaySchema,
	archived: z.boolean(),
});
export const routineRecordSchema = z.object({
	routineId: z.string().uuid(),
	day: routineDaySchema,
	status: z.enum(["done", "skipped"]),
});
export const routineTimerSchema = z
	.object({
		routineId: z.string().uuid(),
		day: routineDaySchema,
		goalMs: z.number().int().min(60_000).max(14_400_000),
		elapsedMs: z.number().int().nonnegative(),
		totalMs: z.number().int().nonnegative(),
		startedAt: z.number().int().nonnegative().nullable(),
	})
	.refine(
		(timer) =>
			timer.elapsedMs <= timer.goalMs && timer.totalMs >= timer.elapsedMs,
	);
export type RoutineTimerState = z.infer<typeof routineTimerSchema>;

export const routineDataSchema = z
	.object({
		version: z.literal(1),
		routines: z.array(routineSchema).max(200),
		records: z.record(z.string(), routineRecordSchema),
		timers: z.record(z.string(), routineTimerSchema).default({}),
	})
	.superRefine((data, ctx) => {
		const ids = new Set(data.routines.map((routine) => routine.id));
		if (ids.size !== data.routines.length)
			ctx.addIssue({ code: "custom", message: "중복된 루틴입니다." });
		for (const [key, record] of [
			...Object.entries(data.records),
			...Object.entries(data.timers),
		]) {
			if (
				key !== routineRecordKey(record.routineId, record.day) ||
				!ids.has(record.routineId)
			)
				ctx.addIssue({ code: "custom", message: "잘못된 루틴 기록입니다." });
		}
		if (
			Object.values(data.timers).filter((timer) => timer.startedAt !== null)
				.length > 1
		)
			ctx.addIssue({
				code: "custom",
				message: "타이머는 한 번에 하나만 실행할 수 있습니다.",
			});
	});

export const routineMutationSchemas = [
	z.object({ action: z.literal("save-routine"), input: routineInputSchema }),
	z.object({
		action: z.literal("set-routine-enabled"),
		id: z.string().uuid(),
		enabled: z.boolean(),
	}),
	z.object({
		action: z.literal("set-routine-status"),
		id: z.string().uuid(),
		day: routineDaySchema,
		status: z.enum(["open", "done", "skipped"]),
	}),
	z.object({ action: z.literal("delete-routine"), id: z.string().uuid() }),
	z.object({
		action: z.literal("move-routine"),
		id: z.string().uuid(),
		direction: z.enum(["up", "down"]),
	}),
	z.object({
		action: z.literal("routine-timer"),
		id: z.string().uuid(),
		day: routineDaySchema,
		operation: z.enum(["start", "pause", "reset"]),
	}),
] as const;
export const routineMutationSchema = z.discriminatedUnion(
	"action",
	routineMutationSchemas,
);
export type RoutineMutation = z.infer<typeof routineMutationSchema>;
export type Routine = z.infer<typeof routineSchema>;
export type RoutineInput = z.infer<typeof routineInputSchema>;
export type RoutineData = z.infer<typeof routineDataSchema>;
export const emptyRoutineData = (): RoutineData => ({
	version: 1,
	routines: [],
	records: {},
	timers: {},
});

export function routineToday(timeZone: string, now = new Date()) {
	const parts = new Intl.DateTimeFormat("en", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(now);
	const value = (type: string) =>
		parts.find((part) => part.type === type)?.value;
	return `${value("year")}-${value("month")}-${value("day")}`;
}

export function routineRecordKey(id: string, day: string) {
	return `${day}:${id}`;
}
export function routineStatus(
	data: RoutineData,
	id: string,
	day: string,
): "open" | "done" | "skipped" {
	return data.records[routineRecordKey(id, day)]?.status ?? "open";
}
export function isRoutineDue(routine: Routine, day: string) {
	return (
		!routine.archived &&
		routine.enabled &&
		day >= routine.createdDay &&
		routine.weekdays.includes(new Date(`${day}T12:00:00`).getDay())
	);
}
export function routineScheduleLabel(
	routine: RoutineInput,
	locale: Locale = "ko",
) {
	const repeat =
		routine.weekdays.length === 7
			? translate(locale, "매일")
			: JSON.stringify(routine.weekdays) === "[1,2,3,4,5]"
				? translate(locale, "평일")
				: [1, 2, 3, 4, 5, 6, 0]
						.filter((day) => routine.weekdays.includes(day))
						.map((day) => weekdayName(day, intlLocale(locale)))
						.join("·");
	const moment =
		routine.moment === "time"
			? routine.time
			: routine.moment === "anytime"
				? ""
				: translate(locale, ROUTINE_MOMENTS[routine.moment]);
	return moment ? `${repeat} · ${moment}` : repeat;
}

export type RoutineTimelineEntry = {
	routine: Routine;
	day: string;
	status: "open" | "done" | "skipped";
	phase: "now" | "past" | "next" | "later" | "moment" | "done" | "skipped";
};

export function buildRoutineTimeline(
	data: RoutineData,
	now: Date,
): RoutineTimelineEntry[] {
	const momentOrder = {
		time: 0,
		morning: 1,
		afternoon: 2,
		evening: 3,
		bedtime: 4,
		anytime: 5,
	};
	const entries = data.routines
		.flatMap((routine): RoutineTimelineEntry[] => {
			const day = routineToday(routine.timeZone, now);
			const status = routineStatus(data, routine.id, day);
			if (
				routine.archived ||
				(!isRoutineDue(routine, day) && status === "open")
			)
				return [];
			return [
				{
					routine,
					day,
					status,
					phase:
						status === "open"
							? routine.moment === "time"
								? "later"
								: "moment"
							: status,
				},
			];
		})
		.sort(
			(a, b) =>
				momentOrder[a.routine.moment] - momentOrder[b.routine.moment] ||
				(a.routine.moment === "time"
					? (a.routine.time ?? "").localeCompare(b.routine.time ?? "")
					: 0),
		);
	let current = false,
		next = false;
	for (const entry of entries) {
		if (entry.status !== "open" || entry.routine.moment !== "time") continue;
		const clock = new Intl.DateTimeFormat("en-GB", {
			timeZone: entry.routine.timeZone,
			hour: "2-digit",
			minute: "2-digit",
			hourCycle: "h23",
		}).format(now);
		if ((entry.routine.time ?? "") <= clock) {
			entry.phase = current ? "past" : "now";
			current = true;
		} else {
			entry.phase = next ? "later" : "next";
			next = true;
		}
	}
	return entries;
}

// Explicit status writes make retries safe; each date has an independent record.
export function applyRoutineMutation(
	data: RoutineData,
	mutation: RoutineMutation,
	today?: string,
	now = new Date(),
): RoutineData {
	const timeZone =
		mutation.action === "save-routine"
			? mutation.input.timeZone
			: (data.routines.find((routine) => routine.id === mutation.id)
					?.timeZone ?? "Asia/Seoul");
	today ??= routineToday(timeZone, now);
	if (mutation.action === "save-routine") {
		const existing = data.routines.find(
			(routine) => routine.id === mutation.input.id,
		);
		if (existing?.archived) throw new Error("삭제된 루틴입니다.");
		if (!existing && data.routines.length >= 200)
			throw new Error("루틴은 최대 200개까지 만들 수 있습니다.");
		const routine = {
			...mutation.input,
			time: mutation.input.moment === "time" ? mutation.input.time : null,
			createdDay: existing?.createdDay ?? today,
			archived: false,
		};
		return {
			...data,
			routines: existing
				? data.routines.map((entry) =>
						entry.id === routine.id ? routine : entry,
					)
				: [...data.routines, routine],
		};
	}
	const routine = data.routines.find(
		(entry) => entry.id === mutation.id && !entry.archived,
	);
	if (!routine) throw new Error("루틴을 찾을 수 없습니다.");
	switch (mutation.action) {
		case "set-routine-enabled":
			return {
				...data,
				timers: mutation.enabled
					? data.timers
					: pauseRoutineTimers(data.timers, now, routine.id),
				routines: data.routines.map((entry) =>
					entry.id === routine.id
						? { ...entry, enabled: mutation.enabled }
						: entry,
				),
			};
		case "delete-routine":
			return {
				...data,
				timers: pauseRoutineTimers(data.timers, now, routine.id),
				routines: data.routines.map((entry) =>
					entry.id === routine.id
						? { ...entry, enabled: false, archived: true }
						: entry,
				),
			};
		case "set-routine-status": {
			if (mutation.day > today || mutation.day < routine.createdDay)
				throw new Error("기록할 수 없는 날짜입니다.");
			if (mutation.status !== "open" && !isRoutineDue(routine, mutation.day))
				throw new Error("해당 날짜에 예정된 루틴이 아닙니다.");
			const records = { ...data.records },
				key = routineRecordKey(routine.id, mutation.day);
			if (mutation.status === "open") delete records[key];
			else
				records[key] = {
					routineId: routine.id,
					day: mutation.day,
					status: mutation.status,
				};
			return {
				...data,
				records,
				timers:
					mutation.status === "open"
						? data.timers
						: pauseRoutineTimers(data.timers, now, routine.id, mutation.day),
			};
		}
		case "routine-timer": {
			if (mutation.day !== today)
				throw new Error("오늘의 타이머만 변경할 수 있습니다.");
			const key = routineRecordKey(routine.id, mutation.day);
			const existing = data.timers[key];
			if (mutation.operation === "start") {
				if (
					!isRoutineDue(routine, today) ||
					routineStatus(data, routine.id, today) !== "open"
				)
					throw new Error("진행할 수 있는 루틴이 아닙니다.");
				if (existing?.startedAt !== null && existing?.startedAt !== undefined)
					return data;
				if (existing && existing.elapsedMs >= existing.goalMs)
					throw new Error("타이머를 초기화해 주세요.");
				const timers = pauseRoutineTimers(data.timers, now);
				timers[key] = {
					...(existing ?? {
						routineId: routine.id,
						day: mutation.day,
						goalMs: routine.durationMinutes * 60_000,
						elapsedMs: 0,
						totalMs: 0,
					}),
					startedAt: now.getTime(),
				};
				return { ...data, timers };
			}
			if (!existing) return data;
			const timers = pauseRoutineTimers(data.timers, now, routine.id);
			if (mutation.operation === "reset")
				timers[key] = {
					...timers[key],
					elapsedMs: 0,
					goalMs: routine.durationMinutes * 60_000,
				};
			return { ...data, timers };
		}
		case "move-routine": {
			const routines = [...data.routines],
				index = routines.findIndex((entry) => entry.id === routine.id);
			const step = mutation.direction === "up" ? -1 : 1;
			let target = index + step;
			while (routines[target]?.archived) target += step;
			if (routines[target])
				[routines[index], routines[target]] = [
					routines[target],
					routines[index],
				];
			return { ...data, routines };
		}
	}
}

export function mergeRoutineData(
	current: RoutineData,
	incoming: RoutineData,
): RoutineData {
	const routines = [...current.routines],
		records = { ...current.records },
		timers = { ...current.timers };
	for (const routine of incoming.routines) {
		const existing = routines.find((entry) => entry.id === routine.id);
		if (existing && JSON.stringify(existing) !== JSON.stringify(routine))
			throw new Error(`루틴 가져오기 충돌: ${routine.title}`);
		if (!existing) routines.push(routine);
	}
	for (const [key, record] of Object.entries(incoming.records)) {
		if (records[key] && JSON.stringify(records[key]) !== JSON.stringify(record))
			throw new Error(`루틴 기록 가져오기 충돌: ${record.day}`);
		records[key] = record;
	}
	for (const [key, timer] of Object.entries(incoming.timers)) {
		if (timers[key] && JSON.stringify(timers[key]) !== JSON.stringify(timer))
			throw new Error(`타이머 가져오기 충돌: ${timer.day}`);
		timers[key] = timer;
	}
	return routineDataSchema.parse({ version: 1, routines, records, timers });
}

// Time derives from a saved timestamp, rather than relying on an open tab's interval.
export function routineTimerProgress(
	timer: RoutineTimerState,
	now = new Date(),
) {
	const delta =
		timer.startedAt === null
			? 0
			: Math.min(
					timer.goalMs - timer.elapsedMs,
					Math.max(0, now.getTime() - timer.startedAt),
				);
	const elapsedMs = timer.elapsedMs + delta;
	return {
		elapsedMs,
		totalMs: timer.totalMs + delta,
		remainingMs: timer.goalMs - elapsedMs,
		running: timer.startedAt !== null && elapsedMs < timer.goalMs,
	};
}
function pauseRoutineTimers(
	timers: RoutineData["timers"],
	now: Date,
	id?: string,
	day?: string,
) {
	return Object.fromEntries(
		Object.entries(timers).map(([key, timer]) => {
			if (
				timer.startedAt === null ||
				(id && timer.routineId !== id) ||
				(day && timer.day !== day)
			)
				return [key, timer];
			const { elapsedMs, totalMs } = routineTimerProgress(timer, now);
			return [key, { ...timer, elapsedMs, totalMs, startedAt: null }];
		}),
	);
}
