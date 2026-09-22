import { Palette } from "lucide-react";
import { Popover } from "radix-ui";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useState,
} from "react";
import { FOLDER_COLORS } from "#/lib/orbit/folder-colors";
import type { OrbitFolderColor } from "#/lib/orbit/schema";
import { ItemColorPicker } from "@/components/item-color-picker";
import { Button } from "@/components/ui/button";

type Colors = { task: OrbitFolderColor; event: OrbitFolderColor };
const DEFAULTS: Colors = { task: "amber", event: "blue" };
const STORAGE_KEY = "orbit-schedule-colors-v1";
const ColorContext = createContext({
	colors: DEFAULTS,
	change: (_kind: keyof Colors, _color?: OrbitFolderColor) => {},
});
const VALUES: Record<OrbitFolderColor, string> = {
	amber: "#f59e0b",
	red: "#ef4444",
	orange: "#f97316",
	lime: "#84cc16",
	emerald: "#10b981",
	cyan: "#06b6d4",
	blue: "#3b82f6",
	violet: "#8b5cf6",
	pink: "#ec4899",
	slate: "#64748b",
	black: "#000000",
	white: "#ffffff",
};
function readColors(): Colors {
	try {
		const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
		const valid = (value: unknown): value is OrbitFolderColor =>
			FOLDER_COLORS.some((color) => color.id === value);
		return {
			task: valid(stored?.task) ? stored.task : DEFAULTS.task,
			event: valid(stored?.event) ? stored.event : DEFAULTS.event,
		};
	} catch {
		return DEFAULTS;
	}
}
export function ScheduleColorProvider({ children }: { children: ReactNode }) {
	const [colors, setColors] = useState<Colors>(DEFAULTS);
	useEffect(() => {
		setColors(readColors());
		const sync = (event: StorageEvent) => {
			if (event.key === STORAGE_KEY || event.key === null)
				setColors(readColors());
		};
		window.addEventListener("storage", sync);
		return () => window.removeEventListener("storage", sync);
	}, []);
	function change(kind: keyof Colors, color?: OrbitFolderColor) {
		const next = { ...colors, [kind]: color ?? DEFAULTS[kind] };
		setColors(next);
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
		} catch {
			/* Keep the current session usable when storage is unavailable. */
		}
	}
	return (
		<ColorContext.Provider value={{ colors, change }}>
			<style>{`:root { --orbit-task-color: ${VALUES[colors.task]}; --orbit-event-color: ${VALUES[colors.event]}; }`}</style>
			{children}
		</ColorContext.Provider>
	);
}
export function ScheduleColors() {
	const { colors, change } = useContext(ColorContext);
	return (
		<Popover.Root>
			<Popover.Trigger asChild>
				<Button variant="ghost" size="icon-sm" aria-label="할 일·일정 색상">
					<Palette />
				</Button>
			</Popover.Trigger>
			<Popover.Portal>
				<Popover.Content
					align="end"
					sideOffset={6}
					className="z-50 w-64 rounded-xl border bg-popover p-3 text-popover-foreground shadow-lg outline-none"
					aria-label="할 일·일정 색상"
				>
					{(["task", "event"] as const).map((kind) => (
						<div key={kind} className="flex items-center justify-between gap-3">
							<span className="text-sm">
								{kind === "task" ? "할 일" : "일정"}
							</span>
							<ItemColorPicker
								type={kind}
								value={colors[kind]}
								onChange={(color) => change(kind, color)}
							/>
						</div>
					))}
				</Popover.Content>
			</Popover.Portal>
		</Popover.Root>
	);
}
