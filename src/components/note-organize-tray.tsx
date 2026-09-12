import { X } from "lucide-react";
import { SPACE_LABEL } from "#/lib/orbit/para";
import type { OrbitItem, OrbitSnapshot } from "#/lib/orbit/schema";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
	FolderDestinationPicker,
	type MoveItem,
} from "./folder-destination-picker";

export function NoteOrganizeTray({
	open,
	snapshot,
	activeItem,
	draggingId,
	hideInboxTarget = false,
	variant = "overlay",
	onClose,
	onMove,
}: {
	open: boolean;
	snapshot: OrbitSnapshot;
	activeItem?: OrbitItem;
	draggingId: string | null;
	hideInboxTarget?: boolean;
	variant?: "overlay" | "panel";
	onClose?: () => void;
	onMove: MoveItem;
}) {
	const isPanel = variant === "panel";
	const visible = isPanel || open;
	const movingItem =
		snapshot.items.find((item) => item.id === draggingId) ?? activeItem;

	return (
		<aside
			aria-hidden={!visible}
			inert={!visible}
			className={cn(
				"flex min-h-0 flex-col bg-background/96 backdrop-blur-xl",
				isPanel
					? "h-full w-full"
					: "absolute inset-y-0 right-0 z-30 w-[22rem] max-w-[88vw] border-l border-border/70 shadow-2xl transition-transform duration-300 ease-[var(--interaction-ease)]",
				!isPanel &&
					(open ? "translate-x-0" : "pointer-events-none translate-x-full"),
			)}
		>
			<header className="flex min-h-16 shrink-0 items-center gap-3 border-b border-border/60 px-4">
				<div className="min-w-0 flex-1">
					<p className="text-sm font-semibold">정리함</p>
					<p className="truncate text-xs text-muted-foreground">
						{movingItem ? `“${movingItem.title}” 정리` : "항목을 선택하세요"}
					</p>
				</div>
				{!isPanel ? (
					<Button
						variant="ghost"
						size="icon-sm"
						onClick={onClose}
						aria-label="정리함 닫기"
					>
						<X />
					</Button>
				) : null}
			</header>

			{visible ? (
				<FolderDestinationPicker
					snapshot={snapshot}
					item={movingItem}
					draggingId={draggingId}
					hideInbox={isPanel || hideInboxTarget}
					onMove={onMove}
				/>
			) : null}

			<footer className="border-t border-border/60 px-4 py-3 text-xs leading-5 text-muted-foreground">
				{movingItem ? (
					<span>
						현재: {SPACE_LABEL[movingItem.space]}
						{movingItem.folder ? ` / ${movingItem.folder}` : ""}
					</span>
				) : null}
			</footer>
		</aside>
	);
}
