import {
	CalendarDays,
	Check,
	ChevronDown,
	FileText,
	ListTodo,
	LoaderCircle,
} from "lucide-react";
import { DropdownMenu } from "radix-ui";
import type { OrbitItem } from "#/lib/orbit/schema";
import { Button } from "@/components/ui/button";

export type ConvertibleType = "note" | "task" | "event";
export const ITEM_KINDS = {
	note: { label: "노트", action: "노트로 바꾸기", icon: FileText },
	task: { label: "할 일", action: "할 일로 바꾸기", icon: ListTodo },
	event: { label: "일정", action: "일정으로 바꾸기…", icon: CalendarDays },
};

export function ItemTypeMenu({
	item,
	busy,
	onConvert,
}: {
	item: OrbitItem;
	busy: boolean;
	onConvert: (kind: ConvertibleType) => void;
}) {
	if (item.type === "link") return null;
	const current = ITEM_KINDS[item.type];
	const Icon = busy ? LoaderCircle : current.icon;
	return (
		<DropdownMenu.Root modal={false}>
			<DropdownMenu.Trigger asChild>
				<Button
					variant="ghost"
					size="sm"
					disabled={busy}
					aria-label={`${current.label} · 종류 바꾸기`}
					className="h-8 shrink-0 gap-1.5 px-2 text-xs"
				>
					<Icon className={busy ? "size-3.5 animate-spin" : "size-3.5"} />
					{current.label}
					<ChevronDown className="size-3 text-muted-foreground" />
				</Button>
			</DropdownMenu.Trigger>
			<DropdownMenu.Portal>
				<DropdownMenu.Content
					align="end"
					sideOffset={6}
					className="z-50 w-56 rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-lg outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 motion-reduce:animate-none"
				>
					<DropdownMenu.Label className="flex items-center gap-2.5 px-2.5 py-2 text-sm font-medium">
						<current.icon className="size-4 text-muted-foreground" />
						<span className="flex-1">{current.label}</span>
						<Check className="size-3.5 text-muted-foreground" />
						<span className="text-xs font-normal text-muted-foreground">
							현재
						</span>
					</DropdownMenu.Label>
					<DropdownMenu.Separator className="mx-1 my-1 h-px bg-border" />
					{(Object.keys(ITEM_KINDS) as ConvertibleType[])
						.filter((kind) => kind !== item.type)
						.map((kind) => {
							const target = ITEM_KINDS[kind];
							return (
								<DropdownMenu.Item
									key={kind}
									onSelect={() => window.setTimeout(() => onConvert(kind), 0)}
									className="flex min-h-10 cursor-default items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm outline-none select-none focus:bg-accent focus:text-accent-foreground"
								>
									<target.icon className="size-4 text-muted-foreground" />
									{target.action}
								</DropdownMenu.Item>
							);
						})}
				</DropdownMenu.Content>
			</DropdownMenu.Portal>
		</DropdownMenu.Root>
	);
}
