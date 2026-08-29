import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/areas")({
	component: AreasLayout,
});

function AreasLayout() {
	return <Outlet />;
}
