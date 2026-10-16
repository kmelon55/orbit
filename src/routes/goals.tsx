import { createFileRoute } from "@tanstack/react-router";
import { GoalWorkspace } from "@/components/goal-portfolio";

export const Route = createFileRoute("/goals")({ component: GoalWorkspace });
