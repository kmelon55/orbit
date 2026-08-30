import { createFileRoute } from "@tanstack/react-router";
import { TaskManager } from "@/components/task-manager";
import { useOrbitSnapshot } from "./__root";

export const Route = createFileRoute("/tasks")({
	component: TasksPage,
});

function TasksPage() {
	const snapshot = useOrbitSnapshot();
	return <TaskManager snapshot={snapshot} />;
}
