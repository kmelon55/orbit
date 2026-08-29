import { createFileRoute } from "@tanstack/react-router";
import { SpaceFolderPage } from "@/components/space-browser";
import { Route as RootRoute } from "./__root";

export const Route = createFileRoute("/areas/$folder")({
	component: AreaFolderPage,
});

function AreaFolderPage() {
	const snapshot = RootRoute.useLoaderData();
	const { folder } = Route.useParams();
	return <SpaceFolderPage snapshot={snapshot} space="area" folder={folder} />;
}
