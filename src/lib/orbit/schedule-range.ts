export type ScheduleRange = {
	startDate: string;
	endDate: string;
	startTime: string;
	endTime: string;
};

// Civil minutes preserve the local date/time strings used by the schedule editor.
export function scheduleMinute(date: string, time = "00:00") {
	return Date.parse(`${date}T${time}:00Z`) / 60_000;
}

function parts(minute: number) {
	const value = new Date(minute * 60_000).toISOString();
	return { date: value.slice(0, 10), time: value.slice(11, 16) };
}

export function rangeFromMinutes(start: number, end: number): ScheduleRange {
	const first = parts(start);
	const last = parts(end);
	return {
		startDate: first.date,
		startTime: first.time,
		endDate: last.date,
		endTime: last.time,
	};
}
