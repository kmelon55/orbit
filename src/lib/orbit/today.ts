import type { OrbitItem, OrbitSnapshot } from "./schema";

// Use one calendar day for the heading and its contents, independent of the
// server's timezone. The browser supplies its local day after hydration.
export function todayView(
	items: OrbitItem[],
	day: string,
): Pick<OrbitSnapshot, "today" | "displayDate"> {
	const date = new Date(`${day}T12:00:00Z`);
	const format = (locale: string, options: Intl.DateTimeFormatOptions) =>
		new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(
			date,
		);
	return {
		today: {
			tasks: items
				.filter((item) => {
					const start = item.start ?? item.due;
					return (
						item.type === "task" &&
						item.status !== "done" &&
						item.status !== "cancelled" &&
						(!start || start.slice(0, 10) <= day)
					);
				})
				.sort((a, b) =>
					(a.start ?? a.due ?? "9999").localeCompare(
						b.start ?? b.due ?? "9999",
					),
				),
			events: items
				.filter(
					(item) => item.type === "event" && item.start?.slice(0, 10) === day,
				)
				.sort((a, b) => (a.start ?? "").localeCompare(b.start ?? "")),
		},
		displayDate: {
			day: format("en-US", { day: "2-digit" }),
			month: format("en-US", { month: "short" }).toUpperCase(),
			weekday: format("ko-KR", { weekday: "long" }),
			longLabel: format("en-US", {
				weekday: "long",
				month: "long",
				day: "2-digit",
			}).toUpperCase(),
		},
	};
}
