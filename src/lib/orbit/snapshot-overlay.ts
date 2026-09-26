import { formatDayKey, isInboxItem } from "./para";
import type { OrbitItem, OrbitSnapshot } from "./schema";

// Keep acknowledged writes visible until a refreshed snapshot has caught up.
export function mergeSnapshotItems(
	snapshot: OrbitSnapshot,
	writes: OrbitItem[],
	force = false,
): OrbitSnapshot {
	if (!writes.length && !force) return snapshot;
	const byId = new Map(snapshot.items.map((item) => [item.id, item]));
	for (const item of writes) {
		const stored = byId.get(item.id);
		if (!stored || stored.updated < item.updated) byId.set(item.id, item);
	}
	const items = [...byId.values()].sort((a, b) =>
		b.updated.localeCompare(a.updated),
	);
	const today = formatDayKey();
	return {
		...snapshot,
		items,
		today: {
			tasks: items
				.filter(
					(item) =>
						item.type === "task" &&
						item.status !== "done" &&
						item.status !== "cancelled" &&
						(!item.due || item.due.slice(0, 10) <= today),
				)
				.sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999")),
			events: items
				.filter(
					(item) => item.type === "event" && item.start?.slice(0, 10) === today,
				)
				.sort((a, b) => (a.start ?? "").localeCompare(b.start ?? "")),
		},
		counts: {
			inbox: items.filter(isInboxItem).length,
			project: items.filter((item) => item.space === "project").length,
			area: items.filter((item) => item.space === "area").length,
			resource: items.filter((item) => item.space === "resource").length,
			archive: items.filter((item) => item.space === "archive").length,
			event: items.filter((item) => item.space === "event").length,
		},
	};
}

export function unobservedWrites(items: OrbitItem[], writes: OrbitItem[]) {
	const byId = new Map(items.map((item) => [item.id, item]));
	return writes.filter((item) => {
		const stored = byId.get(item.id);
		return !stored || stored.updated < item.updated;
	});
}
