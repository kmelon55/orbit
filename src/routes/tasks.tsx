import { createFileRoute } from "@tanstack/react-router";
import { TaskManager } from "@/components/task-manager";
import { Route as RootRoute } from "./__root";

export const Route = createFileRoute("/tasks")({
	component: TasksPage,
});

function TasksPage() {
	const snapshot = RootRoute.useLoaderData();
	return <TaskManager snapshot={snapshot} />;
}
