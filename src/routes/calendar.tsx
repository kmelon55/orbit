import { createFileRoute } from "@tanstack/react-router";
import { CalendarMonth } from "@/components/calendar-month";
import { useOrbitSnapshot } from "./__root";

export const Route = createFileRoute("/calendar")({
	component: CalendarPage,
});

function CalendarPage() {
	const snapshot = useOrbitSnapshot();
	return <CalendarMonth snapshot={snapshot} />;
}
