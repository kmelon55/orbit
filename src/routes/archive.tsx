import { createFileRoute } from "@tanstack/react-router";
import { ArchivePage } from "@/components/space-browser";
import { useOrbitSnapshot } from "./__root";

export const Route = createFileRoute("/archive")({
	component: ArchiveRoute,
});

function ArchiveRoute() {
	const snapshot = useOrbitSnapshot();
	return <ArchivePage snapshot={snapshot} />;
}
