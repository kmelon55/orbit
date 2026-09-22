import { Check, RotateCcw } from "lucide-react";
import { Popover } from "radix-ui";
import { useState } from "react";
import { FOLDER_COLORS } from "#/lib/orbit/folder-colors";
import { paletteItemColor } from "#/lib/orbit/item-colors";
import type { OrbitItem } from "#/lib/orbit/schema";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ItemColorPicker({
	type,
	value,
	onChange,
	disabled,
}: {
	type: OrbitItem["type"];
	value: OrbitItem["color"];
	onChange: (color: OrbitItem["color"]) => void;
	disabled?: boolean;
}) {
	const [open, setOpen] = useState(false);
	const selected = paletteItemColor({ type, color: value });
	return (
		<Popover.Root open={open} onOpenChange={setOpen}>
			<Popover.Trigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					disabled={disabled}
					aria-label={`색상 선택: ${value ? selected.label : "기본"}`}
				>
					<span className={cn("size-3 shrink-0 rounded-full", selected.dot)} />
					색상{" "}
					<span className="text-muted-foreground">
						{value ? selected.label : "기본"}
					</span>
				</Button>
			</Popover.Trigger>
			<Popover.Portal>
				<Popover.Content
					align="start"
					sideOffset={6}
					aria-label="색상 선택"
					className="z-50 w-64 rounded-xl border bg-popover p-3 text-popover-foreground shadow-lg outline-none"
				>
					<p className="mb-2 text-xs font-medium text-muted-foreground">색상</p>
					<div className="grid grid-cols-6 gap-1">
						{FOLDER_COLORS.map((color) => (
							<button
								key={color.id}
								type="button"
								aria-label={color.label}
								title={color.label}
								aria-pressed={value === color.id}
								onClick={() => {
									onChange(color.id);
									setOpen(false);
								}}
								className="grid size-9 place-items-center rounded-lg hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
							>
								<span
									className={cn(
										"grid size-6 place-items-center rounded-full",
										color.dot,
									)}
								>
									{value === color.id ? (
										<Check
											className={cn(
												"size-3.5",
												color.id === "black" ||
													color.id === "blue" ||
													color.id === "violet" ||
													color.id === "slate" ||
													color.id === "red" ||
													color.id === "pink"
													? "text-white"
													: "text-black",
											)}
										/>
									) : null}
								</span>
							</button>
						))}
					</div>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="mt-2 w-full justify-start"
						aria-pressed={!value}
						onClick={() => {
							onChange(undefined);
							setOpen(false);
						}}
					>
						<RotateCcw /> 기본 색상
					</Button>
				</Popover.Content>
			</Popover.Portal>
		</Popover.Root>
	);
}
