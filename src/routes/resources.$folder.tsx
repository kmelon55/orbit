import { createFileRoute } from "@tanstack/react-router";
import { SpaceFolderPage } from "@/components/space-browser";
import { Route as RootRoute } from "./__root";

export const Route = createFileRoute("/resources/$folder")({
	component: ResourceFolderPage,
});

function ResourceFolderPage() {
	const snapshot = RootRoute.useLoaderData();
	const { folder } = Route.useParams();
	return (
		<SpaceFolderPage snapshot={snapshot} space="resource" folder={folder} />
	);
}
