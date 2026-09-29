import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { ItemWorkspace } from "@/components/item-workspace";
import { useOrbitSnapshot } from "./__root";

export const Route = createFileRoute("/search")({ component: SearchItemPage });

function SearchItemPage() {
	const snapshot = useOrbitSnapshot();
	const { note } = Route.useSearch();
	const items = useMemo(
		() => snapshot.items.filter((entry) => entry.id === note),
		[snapshot.items, note],
	);
	const item = items[0];
	return (
		<ItemWorkspace
			snapshot={snapshot}
			items={items}
			heading="검색 결과"
			description={item ? "검색한 항목" : "검색에서 항목을 선택해 주세요"}
			disableCreate
		/>
	);
}
