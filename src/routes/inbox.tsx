import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { itemsInSpace } from "#/lib/orbit/para";
import { ItemWorkspace } from "@/components/item-workspace";
import { useI18n } from "@/components/locale-provider";
import { useOrbitWrites } from "@/components/orbit-snapshot-provider";
import { useOrbitSnapshot } from "./__root";

export const Route = createFileRoute("/inbox")({
	component: InboxPage,
});

function InboxPage() {
	const { t } = useI18n();

	const snapshot = useOrbitSnapshot();
	const { pending } = useOrbitWrites();
	const pendingNotes = pending.filter(
		(entry) =>
			entry.input.space === "inbox" &&
			(entry.input.type === "note" || entry.input.type === "link"),
	);
	const inbox = useMemo(
		() => itemsInSpace(snapshot.items, "inbox"),
		[snapshot.items],
	);

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="min-h-0 flex-1">
				<ItemWorkspace
					snapshot={snapshot}
					items={inbox}
					pendingCaptures={pendingNotes}
					heading={t("Inbox")}
					description={t("정리 대기 {0}개", [
						inbox.length + pendingNotes.length,
					])}
					listEmptyMessage={t("정리할 메모가 없습니다.")}
					emptyTitle={t("선택된 메모 없음")}
					create={{ space: "inbox", type: "note" }}
					hideInboxTarget
					clearSelectionAfterMove
				/>
			</div>
		</div>
	);
}
