import { createFileRoute } from "@tanstack/react-router";
import { SpaceIndexPage } from "@/components/space-browser";
import { useOrbitSnapshot } from "./__root";

export const Route = createFileRoute("/resources/")({
	component: ResourcesIndex,
});

function ResourcesIndex() {
	const snapshot = useOrbitSnapshot();
	return <SpaceIndexPage snapshot={snapshot} space="resource" />;
}
