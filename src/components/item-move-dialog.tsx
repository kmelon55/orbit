import { Link } from "@tanstack/react-router";
import { ArrowUpRight, ChevronDown, Folder, Plus, X } from "lucide-react";
import { useState } from "react";
import { folderColor } from "#/lib/orbit/folder-colors";
import { folderOf, spaceConfig } from "#/lib/orbit/para";
import type { OrbitItem, OrbitSnapshot, OrbitSpace } from "#/lib/orbit/schema";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { FolderDestinationPicker } from "./folder-destination-picker";

export type MoveDestination = (
	space: OrbitSpace,
	folder?: string,
) => void | Promise<void>;

export function ItemMoveDialog({
	item,
	snapshot,
	open,
	onOpenChange,
	onMove,
}: {
	item: OrbitItem;
	snapshot: OrbitSnapshot;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onMove: MoveDestination;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className="flex h-[min(36rem,85svh)] flex-col gap-0 overflow-hidden p-0"
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					(event.target as HTMLElement)
						.querySelector<HTMLInputElement>('input[aria-label="폴더 검색"]')
						?.focus();
				}}
			>
				<DialogHeader className="flex-row items-center border-b px-4 py-3">
					<div className="min-w-0 flex-1">
						<DialogTitle>
							{item.type === "task" ? "소속 변경" : "옮기기"}
						</DialogTitle>
						<DialogDescription className="truncate">
							{item.title}
						</DialogDescription>
					</div>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label="옮기기 닫기"
						onClick={() => onOpenChange(false)}
					>
						<X />
					</Button>
				</DialogHeader>
				<FolderDestinationPicker
					snapshot={snapshot}
					item={item}
					onMove={async (_id, space, folder) => {
						await onMove(space, folder);
						onOpenChange(false);
					}}
				/>
			</DialogContent>
		</Dialog>
	);
}

export function ItemLocation({
	item,
	snapshot,
	onMove,
}: {
	item: OrbitItem;
	snapshot: OrbitSnapshot;
	onMove: MoveDestination;
}) {
	const [open, setOpen] = useState(false);
	const folder = folderOf(item);
	const config = spaceConfig(item.space);
	const assigned = item.space !== "inbox" && item.space !== "event";
	const folders =
		item.space === "project" ||
		item.space === "area" ||
		item.space === "resource" ||
		item.space === "archive"
			? snapshot.folders[item.space]
			: [];
	const color = folders.find((entry) => entry.slug === folder)?.color;
	return (
		<fieldset
			className="flex min-w-0 max-w-[40%] items-center gap-0.5"
			onDragStart={(event) => event.stopPropagation()}
		>
			<button
				type="button"
				aria-label={`${item.title} 소속 변경`}
				title={
					assigned
						? `${config?.korean ?? ""}${folder ? ` / ${folder}` : ""}`
						: "프로젝트·영역에 연결"
				}
				className={cn(
					"flex min-h-7 min-w-0 items-center gap-1 rounded px-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
					!assigned &&
						"sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100",
				)}
				onClick={() => setOpen(true)}
			>
				{assigned ? (
					<Folder
						className={cn("size-3 shrink-0", folderColor(color ?? "lime").icon)}
					/>
				) : (
					<Plus className="size-3 shrink-0" />
				)}
				<span className="truncate">
					{assigned
						? (folder?.split("/").at(-1) ?? config?.korean)
						: "프로젝트·영역"}
				</span>
				{assigned ? <ChevronDown className="size-3 shrink-0" /> : null}
			</button>
			{assigned && config ? (
				folder && config.folderHref ? (
					<Link
						to={config.folderHref}
						params={{ folder }}
						className="grid size-7 shrink-0 place-items-center rounded text-muted-foreground hover:bg-accent"
						aria-label={`${folder} 폴더 열기`}
					>
						<ArrowUpRight className="size-3.5" />
					</Link>
				) : (
					<Link
						to={config.href}
						className="grid size-7 shrink-0 place-items-center rounded text-muted-foreground hover:bg-accent"
						aria-label={`${config.korean} 열기`}
					>
						<ArrowUpRight className="size-3.5" />
					</Link>
				)
			) : null}
			{open ? (
				<ItemMoveDialog
					item={item}
					snapshot={snapshot}
					open={open}
					onOpenChange={setOpen}
					onMove={onMove}
				/>
			) : null}
		</fieldset>
	);
}
