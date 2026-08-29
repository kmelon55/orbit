import { createFileRoute } from "@tanstack/react-router";
import { CalendarMonth } from "@/components/calendar-month";
import { Route as RootRoute } from "./__root";

export const Route = createFileRoute("/calendar")({
	component: CalendarPage,
});

function CalendarPage() {
	const snapshot = RootRoute.useLoaderData();
	return <CalendarMonth snapshot={snapshot} />;
}
