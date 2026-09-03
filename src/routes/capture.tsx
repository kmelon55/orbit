import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { ArrowLeft, Inbox } from "lucide-react";
import { QuickCapture } from "@/components/quick-capture";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/capture")({
	component: CapturePage,
});

function CapturePage() {
	const router = useRouter();
	return (
		<div className="h-full overflow-auto bg-muted/20">
			<div className="mx-auto w-full max-w-2xl px-4 py-5 sm:px-6 sm:py-8">
				<header className="mb-5">
					<p className="text-xs font-medium text-muted-foreground">
						Quick capture
					</p>
					<h2 className="mt-1 text-2xl font-semibold tracking-tight">
						빠른 기록
					</h2>
					<p className="mt-2 text-sm leading-6 text-muted-foreground">
						지금 떠오른 것만 적으세요. 정리는 나중에 Inbox에서 하면 됩니다.
					</p>
				</header>
				<QuickCapture
					placeholder="메모, 할 일, 일정을 바로 기록하세요"
					onSaved={() => void router.invalidate()}
				/>
				<div className="mt-4 flex items-center justify-between gap-2">
					<Button variant="ghost" size="sm" asChild>
						<Link to="/">
							<ArrowLeft /> Today
						</Link>
					</Button>
					<Button variant="outline" size="sm" asChild>
						<Link to="/inbox">
							<Inbox /> Inbox에서 정리
						</Link>
					</Button>
				</div>
			</div>
		</div>
	);
}
