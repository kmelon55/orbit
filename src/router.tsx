import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { WorkspaceSkeleton } from "./components/workspace-skeleton";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
	const router = createTanStackRouter({
		routeTree,
		scrollRestoration: true,
		defaultPreload: "intent",
		defaultPreloadDelay: 0,
		defaultPendingComponent: WorkspaceSkeleton,
		defaultPendingMs: 80,
		defaultPendingMinMs: 0,
		defaultStaleTime: Number.POSITIVE_INFINITY,
		defaultPreloadStaleTime: Number.POSITIVE_INFINITY,
	});

	return router;
}

declare module "@tanstack/react-router" {
	interface HistoryState {
		orbitDetailBack?: "note" | "mail";
	}
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
