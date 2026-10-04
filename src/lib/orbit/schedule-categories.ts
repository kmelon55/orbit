import type { OrbitItem, ScheduleCategory } from "./schema";

export const DEFAULT_SCHEDULE_CATEGORIES: ScheduleCategory[] = [
	{ id: "business", name: "비즈니스", color: "blue" },
	{ id: "personal", name: "개인", color: "emerald" },
];

export function upsertScheduleCategory(
	categories: ScheduleCategory[],
	category: ScheduleCategory,
) {
	return categories.some((entry) => entry.id === category.id)
		? categories.map((entry) => (entry.id === category.id ? category : entry))
		: [...categories, category];
}

export function visibleScheduleCategory(
	item: Pick<OrbitItem, "type" | "category">,
	hidden: string[],
) {
	return (
		(item.type !== "event" && item.type !== "task") ||
		!hidden.includes(item.category ?? "uncategorized")
	);
}
