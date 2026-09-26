import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { itemsInSpace } from "#/lib/orbit/para";
import { ItemWorkspace } from "@/components/item-workspace";
import { useOrbitWrites } from "@/components/orbit-snapshot-provider";
import { QuickCapture } from "@/components/quick-capture";
import { useOrbitSnapshot } from "./__root";

export const Route = createFileRoute("/inbox")({
	component: InboxPage,
});

function InboxPage() {
	const snapshot = useOrbitSnapshot();
	const { pending } = useOrbitWrites();
	const pendingNotes = pending.filter((entry) => entry.input.type === "note");
	const inbox = useMemo(
		() => itemsInSpace(snapshot.items, "inbox"),
		[snapshot.items],
	);

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="shrink-0 border-b border-border/50 bg-background/60 px-4 py-3 backdrop-blur-xl">
				<QuickCapture placeholder="할 일, 일정, 아이디어를 그냥 넣으세요" />
			</div>
			<div className="min-h-0 flex-1">
				<ItemWorkspace
					snapshot={snapshot}
					items={inbox}
					pendingCaptures={pendingNotes}
					heading="Inbox"
					description={`정리 대기 ${inbox.length + pendingNotes.length}개`}
					create={{ space: "inbox", type: "note" }}
					hideInboxTarget
					clearSelectionAfterMove
				/>
			</div>
		</div>
	);
}
