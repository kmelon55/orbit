import { createFileRoute } from "@tanstack/react-router";
import { MailWorkspace } from "@/components/mail/mail-workspace";
export const Route = createFileRoute("/mail")({
	validateSearch: (
		search: Record<string, unknown>,
	): { message?: string; connection?: string; demo?: boolean } => ({
		demo:
			search.demo === "1" ||
			search.demo === 1 ||
			search.demo === true ||
			undefined,
		message: typeof search.message === "string" ? search.message : undefined,
		connection:
			typeof search.connection === "string" ? search.connection : undefined,
	}),
	component: MailPage,
});
function MailPage() {
	const { message, demo } = Route.useSearch();
	return (
		<MailWorkspace
			key={demo ? "demo" : "live"}
			demo={demo}
			initialMessage={message || (demo ? "demo-newsletter" : undefined)}
		/>
	);
}
