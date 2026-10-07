import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useI18n } from "@/components/locale-provider";
import { QuickCapture } from "@/components/quick-capture";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/capture")({
	component: CapturePage,
});

function CapturePage() {
	const { t } = useI18n();

	return (
		<div className="h-full overflow-auto bg-muted/20">
			<div className="mx-auto w-full max-w-2xl px-4 py-5 sm:px-6 sm:py-8">
				<header className="mb-5">
					<h2 className="mt-1 text-2xl font-semibold tracking-tight">
						{t("빠른 기록")}
					</h2>
				</header>
				<QuickCapture placeholder={t("메모, 할 일, 일정")} />
				<div className="mt-4 flex items-center justify-between gap-2">
					<Button variant="ghost" size="sm" asChild>
						<Link to="/">
							<ArrowLeft /> {t("Today")}
						</Link>
					</Button>
				</div>
			</div>
		</div>
	);
}
