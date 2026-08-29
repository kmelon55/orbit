import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMemo } from "react";
import { itemsInSpace } from "#/lib/orbit/para";
import { ItemWorkspace } from "@/components/item-workspace";
import { QuickCapture } from "@/components/quick-capture";
import { Route as RootRoute } from "./__root";

export const Route = createFileRoute("/inbox")({
	component: InboxPage,
});

function InboxPage() {
	const snapshot = RootRoute.useLoaderData();
	const router = useRouter();
	const inbox = useMemo(
		() => itemsInSpace(snapshot.items, "inbox"),
		[snapshot.items],
	);

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="shrink-0 border-b border-border/50 bg-background/60 px-4 py-3 backdrop-blur-xl">
				<QuickCapture
					placeholder="할 일, 일정, 아이디어를 그냥 넣으세요"
					onSaved={() => void router.invalidate()}
				/>
			</div>
			<div className="min-h-0 flex-1">
				<ItemWorkspace
					snapshot={snapshot}
					items={inbox}
					heading="Inbox"
					description={`정리 대기 ${inbox.length}개`}
					create={{ space: "inbox", type: "note" }}
					hideInboxTarget
					clearSelectionAfterMove
				/>
			</div>
		</div>
	);
}
