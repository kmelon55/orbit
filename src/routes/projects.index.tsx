import { createFileRoute } from "@tanstack/react-router";
import { SpaceIndexPage } from "@/components/space-browser";
import { Route as RootRoute } from "./__root";

export const Route = createFileRoute("/projects/")({
	component: ProjectsIndex,
});

function ProjectsIndex() {
	const snapshot = RootRoute.useLoaderData();
	return <SpaceIndexPage snapshot={snapshot} space="project" />;
}
