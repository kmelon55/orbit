import { createFileRoute } from "@tanstack/react-router";
import { SpaceFolderPage } from "@/components/space-browser";
import { useOrbitSnapshot } from "./__root";

export const Route = createFileRoute("/resources/$folder")({
	component: ResourceFolderPage,
});

function ResourceFolderPage() {
	const snapshot = useOrbitSnapshot();
	const { folder } = Route.useParams();
	return (
		<SpaceFolderPage snapshot={snapshot} space="resource" folder={folder} />
	);
}
