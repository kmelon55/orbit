import { createFileRoute } from "@tanstack/react-router";
import { GoalWorkspace } from "@/components/goal-workspace";

export const Route = createFileRoute("/goals")({ component: GoalWorkspace });
