import { createFileRoute } from "@tanstack/react-router";
import { RoutineWorkspace } from "@/components/routine-manager";
import { useOrbitSnapshot } from "./__root";

export const Route = createFileRoute("/routines")({ component: RoutinesPage });

function RoutinesPage() {
	return <RoutineWorkspace snapshot={useOrbitSnapshot()} />;
}
