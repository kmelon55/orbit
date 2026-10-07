import { type Locale, translate } from "../i18n";
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

// Only built-in names on reserved IDs are UI labels. Renamed/custom names stay intact.
export function scheduleCategoryLabel(
	category: Pick<ScheduleCategory, "id" | "name">,
	locale: Locale,
) {
	const builtIn =
		category.id === "uncategorized"
			? "미분류"
			: DEFAULT_SCHEDULE_CATEGORIES.find((entry) => entry.id === category.id)
					?.name;
	return category.name === builtIn
		? translate(locale, category.name)
		: category.name;
}
