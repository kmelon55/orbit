import { createFileRoute } from "@tanstack/react-router";
import { ArchivePage } from "@/components/space-browser";
import { Route as RootRoute } from "./__root";

export const Route = createFileRoute("/archive")({
	component: ArchiveRoute,
});

function ArchiveRoute() {
	const snapshot = RootRoute.useLoaderData();
	return <ArchivePage snapshot={snapshot} />;
}
