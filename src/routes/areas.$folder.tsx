import { createFileRoute } from "@tanstack/react-router";
import { SpaceFolderPage } from "@/components/space-browser";
import { useOrbitSnapshot } from "./__root";

export const Route = createFileRoute("/areas/$folder")({
	component: AreaFolderPage,
});

function AreaFolderPage() {
	const snapshot = useOrbitSnapshot();
	const { folder } = Route.useParams();
	return <SpaceFolderPage snapshot={snapshot} space="area" folder={folder} />;
}
