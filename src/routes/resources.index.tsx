import { createFileRoute } from "@tanstack/react-router";
import { SpaceIndexPage } from "@/components/space-browser";
import { Route as RootRoute } from "./__root";

export const Route = createFileRoute("/resources/")({
	component: ResourcesIndex,
});

function ResourcesIndex() {
	const snapshot = RootRoute.useLoaderData();
	return <SpaceIndexPage snapshot={snapshot} space="resource" />;
}
