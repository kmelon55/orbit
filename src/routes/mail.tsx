import { createFileRoute } from "@tanstack/react-router";
import { MailWorkspace } from "@/components/mail/mail-workspace";
export const Route = createFileRoute("/mail")({
	validateSearch: (
		search: Record<string, unknown>,
	): { message?: string; connection?: string } => ({
		message: typeof search.message === "string" ? search.message : undefined,
		connection:
			typeof search.connection === "string" ? search.connection : undefined,
	}),
	component: MailPage,
});
function MailPage() {
	const { message } = Route.useSearch();
	return <MailWorkspace initialMessage={message} />;
}
