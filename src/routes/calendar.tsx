import { createFileRoute } from "@tanstack/react-router";
import { calendarSearch } from "#/lib/orbit/navigation-search";
import { CalendarMonth } from "@/components/calendar-month";
import { useOrbitSnapshot } from "./__root";

export const Route = createFileRoute("/calendar")({
	validateSearch: calendarSearch,
	component: CalendarPage,
});

function CalendarPage() {
	const snapshot = useOrbitSnapshot();
	return <CalendarMonth snapshot={snapshot} />;
}
