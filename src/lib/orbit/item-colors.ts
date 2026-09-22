import { folderColor } from "./folder-colors";
import type { OrbitFolderColor, OrbitItem } from "./schema";

const SURFACES: Record<OrbitFolderColor, string> = {
	amber:
		"border-amber-500 bg-amber-200 text-amber-950 hover:bg-amber-300 dark:border-amber-500 dark:bg-amber-950 dark:text-amber-100 dark:hover:bg-amber-900",
	red: "border-red-400 bg-red-100 text-red-950 hover:bg-red-200 dark:border-red-500 dark:bg-red-950 dark:text-red-100 dark:hover:bg-red-900",
	orange:
		"border-orange-400 bg-orange-100 text-orange-950 hover:bg-orange-200 dark:border-orange-500 dark:bg-orange-950 dark:text-orange-100 dark:hover:bg-orange-900",
	lime: "border-lime-500 bg-lime-100 text-lime-950 hover:bg-lime-200 dark:border-lime-500 dark:bg-lime-950 dark:text-lime-100 dark:hover:bg-lime-900",
	emerald:
		"border-emerald-400 bg-emerald-100 text-emerald-950 hover:bg-emerald-200 dark:border-emerald-500 dark:bg-emerald-950 dark:text-emerald-100 dark:hover:bg-emerald-900",
	cyan: "border-cyan-400 bg-cyan-100 text-cyan-950 hover:bg-cyan-200 dark:border-cyan-500 dark:bg-cyan-950 dark:text-cyan-100 dark:hover:bg-cyan-900",
	blue: "border-blue-400 bg-blue-100 text-blue-950 hover:bg-blue-200 dark:border-blue-500 dark:bg-blue-950 dark:text-blue-100 dark:hover:bg-blue-900",
	violet:
		"border-violet-400 bg-violet-100 text-violet-950 hover:bg-violet-200 dark:border-violet-500 dark:bg-violet-950 dark:text-violet-100 dark:hover:bg-violet-900",
	pink: "border-pink-400 bg-pink-100 text-pink-950 hover:bg-pink-200 dark:border-pink-500 dark:bg-pink-950 dark:text-pink-100 dark:hover:bg-pink-900",
	slate:
		"border-slate-400 bg-slate-100 text-slate-950 hover:bg-slate-200 dark:border-slate-500 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700",
	black: "border-neutral-500 bg-black text-white hover:bg-neutral-900",
	white: "border-neutral-400 bg-white text-black hover:bg-neutral-100",
};

export function paletteItemColor(item: Pick<OrbitItem, "type" | "color">) {
	const color = item.color ?? (item.type === "event" ? "blue" : "amber");
	return { ...folderColor(color), surface: SURFACES[color] };
}

// Scheduled items use one color per kind; legacy per-item metadata is preserved.
export function itemColor(item: Pick<OrbitItem, "type" | "color">) {
	const kind = item.type === "event" ? "event" : "task";
	return {
		...paletteItemColor({ type: item.type, color: undefined }),
		dot: `orbit-${kind}-dot`,
		icon: `orbit-${kind}-icon`,
		surface: `orbit-${kind}-surface`,
	};
}
