"use client";

import { DropdownMenu as Primitive } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

const DropdownMenu = Primitive.Root;
const DropdownMenuTrigger = Primitive.Trigger;
function DropdownMenuContent({
	className,
	sideOffset = 4,
	...props
}: React.ComponentProps<typeof Primitive.Content>) {
	return (
		<Primitive.Portal>
			<Primitive.Content
				sideOffset={sideOffset}
				align="end"
				className={cn(
					"z-50 max-h-(--radix-dropdown-menu-content-available-height) min-w-36 overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none",
					className,
				)}
				{...props}
			/>
		</Primitive.Portal>
	);
}
function DropdownMenuItem({
	className,
	variant = "default",
	...props
}: React.ComponentProps<typeof Primitive.Item> & {
	variant?: "default" | "destructive";
}) {
	return (
		<Primitive.Item
			data-variant={variant}
			className={cn(
				"relative flex cursor-default select-none items-center gap-1.5 rounded-md px-1.5 py-1 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
				className,
			)}
			{...props}
		/>
	);
}
function DropdownMenuSeparator({
	className,
	...props
}: React.ComponentProps<typeof Primitive.Separator>) {
	return (
		<Primitive.Separator
			className={cn("-mx-1 my-1 h-px bg-border", className)}
			{...props}
		/>
	);
}
export {
	DropdownMenu,
	DropdownMenuTrigger,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
};
