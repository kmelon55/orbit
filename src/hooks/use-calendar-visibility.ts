import { useEffect, useState } from "react";

type CalendarView = "day" | "week" | "month";
type CalendarVisibility = { event: boolean; task: boolean; routine: boolean };
type ViewVisibility = Record<CalendarView, CalendarVisibility>;

const STORAGE_KEY = "orbit:calendar-visibility:v1";

function defaults(): ViewVisibility {
	return {
		day: { event: true, task: true, routine: true },
		week: { event: true, task: true, routine: true },
		month: { event: true, task: true, routine: true },
	};
}

export function useCalendarVisibility(view: CalendarView) {
	const [byView, setByView] = useState(defaults);
	const [restored, setRestored] = useState(false);

	useEffect(() => {
		const next = defaults();
		try {
			const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
			for (const mode of ["day", "week", "month"] as const) {
				for (const kind of ["event", "task", "routine"] as const) {
					if (typeof saved?.[mode]?.[kind] === "boolean") {
						next[mode][kind] = saved[mode][kind];
					}
				}
			}
		} catch {
			// Invalid or unavailable browser storage falls back to showing all items.
		}
		setByView(next);
		setRestored(true);
	}, []);

	useEffect(() => {
		if (!restored) return;
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(byView));
		} catch {
			// Filters still work for this visit when browser storage is unavailable.
		}
	}, [byView, restored]);

	function toggle(kind: keyof CalendarVisibility) {
		setByView((current) => ({
			...current,
			[view]: { ...current[view], [kind]: !current[view][kind] },
		}));
	}

	return [byView[view], toggle] as const;
}
