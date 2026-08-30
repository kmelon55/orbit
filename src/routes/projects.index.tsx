import { createFileRoute } from "@tanstack/react-router";
import { SpaceIndexPage } from "@/components/space-browser";
import { useOrbitSnapshot } from "./__root";

export const Route = createFileRoute("/projects/")({
	component: ProjectsIndex,
});

function ProjectsIndex() {
	const snapshot = useOrbitSnapshot();
	return <SpaceIndexPage snapshot={snapshot} space="project" />;
}
