import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { ItemWorkspace } from "@/components/item-workspace";
import { useI18n } from "@/components/locale-provider";
import { useOrbitSnapshot } from "./__root";

export const Route = createFileRoute("/search")({ component: SearchItemPage });

function SearchItemPage() {
	const { t } = useI18n();

	const snapshot = useOrbitSnapshot();
	const { note } = Route.useSearch();
	const items = useMemo(
		() => snapshot.items.filter((entry) => entry.id === note),
		[snapshot.items, note],
	);
	return (
		<ItemWorkspace
			snapshot={snapshot}
			items={items}
			heading={t("검색 결과")}
			disableCreate
		/>
	);
}
