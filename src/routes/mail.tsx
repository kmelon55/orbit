import { createFileRoute } from "@tanstack/react-router";
import { mailSearch } from "#/lib/orbit/navigation-search";
import { MailWorkspace } from "@/components/mail/mail-workspace";
export const Route = createFileRoute("/mail")({
	validateSearch: mailSearch,
	component: MailPage,
});
function MailPage() {
	const { demo } = Route.useSearch();
	return <MailWorkspace key={demo ? "demo" : "live"} demo={demo} />;
}
