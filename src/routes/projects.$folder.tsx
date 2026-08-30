import { createFileRoute } from "@tanstack/react-router";
import { SpaceFolderPage } from "@/components/space-browser";
import { useOrbitSnapshot } from "./__root";

export const Route = createFileRoute("/projects/$folder")({
	component: ProjectFolderPage,
});

function ProjectFolderPage() {
	const snapshot = useOrbitSnapshot();
	const { folder } = Route.useParams();
	return (
		<SpaceFolderPage snapshot={snapshot} space="project" folder={folder} />
	);
}
