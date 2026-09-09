import type { OrbitFolderColor } from "#/lib/orbit/schema";

export const FOLDER_COLORS: Array<{
	id: OrbitFolderColor;
	label: string;
	icon: string;
	dot: string;
}> = [
	{
		id: "amber",
		label: "노랑",
		icon: "fill-amber-300/60 text-amber-600 dark:fill-amber-400/20 dark:text-amber-300",
		dot: "bg-amber-500",
	},
	{
		id: "red",
		label: "빨강",
		icon: "fill-red-300/60 text-red-600 dark:fill-red-400/20 dark:text-red-300",
		dot: "bg-red-500",
	},
	{
		id: "orange",
		label: "주황",
		icon: "fill-orange-300/60 text-orange-600 dark:fill-orange-400/20 dark:text-orange-300",
		dot: "bg-orange-500",
	},
	{
		id: "lime",
		label: "연두",
		icon: "fill-lime-300/60 text-lime-600 dark:fill-lime-400/20 dark:text-lime-300",
		dot: "bg-lime-500",
	},
	{
		id: "emerald",
		label: "초록",
		icon: "fill-emerald-300/60 text-emerald-600 dark:fill-emerald-400/20 dark:text-emerald-300",
		dot: "bg-emerald-500",
	},
	{
		id: "cyan",
		label: "청록",
		icon: "fill-cyan-300/60 text-cyan-600 dark:fill-cyan-400/20 dark:text-cyan-300",
		dot: "bg-cyan-500",
	},
	{
		id: "blue",
		label: "파랑",
		icon: "fill-blue-300/60 text-blue-600 dark:fill-blue-400/20 dark:text-blue-300",
		dot: "bg-blue-500",
	},
	{
		id: "violet",
		label: "보라",
		icon: "fill-violet-300/60 text-violet-600 dark:fill-violet-400/20 dark:text-violet-300",
		dot: "bg-violet-500",
	},
	{
		id: "pink",
		label: "분홍",
		icon: "fill-pink-300/60 text-pink-600 dark:fill-pink-400/20 dark:text-pink-300",
		dot: "bg-pink-500",
	},
	{
		id: "slate",
		label: "회색",
		icon: "fill-slate-300/60 text-slate-600 dark:fill-slate-400/20 dark:text-slate-300",
		dot: "bg-slate-500",
	},
	{
		id: "black",
		label: "검정",
		icon: "fill-black text-black dark:stroke-neutral-400",
		dot: "bg-black ring-1 ring-inset ring-neutral-500",
	},
	{
		id: "white",
		label: "흰색",
		icon: "fill-white text-neutral-400 dark:text-neutral-300",
		dot: "bg-white ring-1 ring-inset ring-neutral-400",
	},
];

export function folderColor(color: OrbitFolderColor) {
	return (
		FOLDER_COLORS.find((entry) => entry.id === color) ??
		FOLDER_COLORS.find((entry) => entry.id === "lime") ??
		FOLDER_COLORS[0]
	);
}
