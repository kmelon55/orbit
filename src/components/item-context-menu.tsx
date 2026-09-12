import {
	Archive,
	CalendarDays,
	Check,
	Copy,
	FileText,
	FolderInput,
	ListTodo,
	Plus,
	Trash2,
} from "lucide-react";
import { type ReactElement, useState } from "react";
import type { OrbitItem, OrbitSnapshot } from "#/lib/orbit/schema";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";

import { ItemMoveDialog, type MoveDestination } from "./item-move-dialog";

export type ItemConfirmAction = {
	kind: "archive" | "delete";
	item: OrbitItem;
};

function closeThen(action?: () => void) {
	if (!action) return undefined;
	return () => {
		window.setTimeout(action, 0);
	};
}

export function ItemContextMenu({
	children,
	item,
	snapshot,
	createLabel = "새 노트",
	onCreate,
	onOpen,
	onFile,
	onArchive,
	onDelete,
	onToggleTask,
	onConvert,
	onMove,
}: {
	children: ReactElement;
	item?: OrbitItem;
	snapshot?: OrbitSnapshot;
	createLabel?: string;
	onCreate?: () => void;
	onOpen?: () => void;
	onFile?: () => void;
	onArchive?: () => void;
	onDelete?: () => void;
	onToggleTask?: () => void;
	onConvert?: (kind: "note" | "task" | "event") => void;
	onMove?: MoveDestination;
}) {
	const [open, setOpen] = useState(false);
	const [moveOpen, setMoveOpen] = useState(false);
	const showCreate = Boolean(onCreate);
	const showItem = Boolean(item);
	const showMove = Boolean(item && snapshot && onMove);
	const showConvert = Boolean(item && onConvert && item.type !== "link");
	const canArchive = Boolean(item && onArchive && item.space !== "archive");

	return (
		<>
			<ContextMenu onOpenChange={setOpen}>
				<ContextMenuTrigger
					asChild
					onContextMenu={(event) => event.stopPropagation()}
				>
					{children}
				</ContextMenuTrigger>
				{open ? (
					<ContextMenuContent className="w-52">
						{showCreate ? (
							<ContextMenuItem onSelect={onCreate}>
								<Plus /> {createLabel}
							</ContextMenuItem>
						) : null}
						{showCreate && (showItem || onOpen) ? (
							<ContextMenuSeparator />
						) : null}
						{onOpen ? (
							<ContextMenuItem onSelect={onOpen}>
								<FileText /> 열기
							</ContextMenuItem>
						) : null}
						{item && onFile ? (
							<ContextMenuItem onSelect={closeThen(onFile)}>
								<FolderInput /> 세부 정리...
							</ContextMenuItem>
						) : null}
						{showMove && item && onMove ? (
							<ContextMenuItem onSelect={closeThen(() => setMoveOpen(true))}>
								<FolderInput />{" "}
								{item.type === "task" ? "소속 변경…" : "옮기기…"}
							</ContextMenuItem>
						) : null}
						{showConvert && item && onConvert ? <ContextMenuSeparator /> : null}
						{showConvert && onConvert && item?.type !== "note" ? (
							<ContextMenuItem onSelect={closeThen(() => onConvert("note"))}>
								<FileText /> 노트로 바꾸기
							</ContextMenuItem>
						) : null}
						{showConvert && onConvert && item?.type !== "task" ? (
							<ContextMenuItem onSelect={closeThen(() => onConvert("task"))}>
								<ListTodo /> 할 일로 바꾸기
							</ContextMenuItem>
						) : null}
						{showConvert && onConvert && item?.type !== "event" ? (
							<ContextMenuItem onSelect={closeThen(() => onConvert("event"))}>
								<CalendarDays /> 일정으로 바꾸기…
							</ContextMenuItem>
						) : null}
						{item?.type === "task" && onToggleTask ? (
							<ContextMenuItem onSelect={onToggleTask}>
								<Check /> {item.status === "done" ? "다시 열기" : "완료로 표시"}
							</ContextMenuItem>
						) : null}
						{item ? (
							<>
								<ContextMenuSeparator />
								<ContextMenuItem
									onSelect={() => {
										void navigator.clipboard.writeText(item.path);
									}}
								>
									<Copy /> 경로 복사
								</ContextMenuItem>
							</>
						) : null}
						{item && (canArchive || onDelete) ? <ContextMenuSeparator /> : null}
						{canArchive ? (
							<ContextMenuItem onSelect={closeThen(onArchive)}>
								<Archive /> 보관
							</ContextMenuItem>
						) : null}
						{item && onDelete ? (
							<ContextMenuItem
								variant="destructive"
								onSelect={closeThen(onDelete)}
							>
								<Trash2 /> 삭제
							</ContextMenuItem>
						) : null}
					</ContextMenuContent>
				) : null}
			</ContextMenu>
			{item && snapshot && onMove && moveOpen ? (
				<ItemMoveDialog
					item={item}
					snapshot={snapshot}
					open={moveOpen}
					onOpenChange={setMoveOpen}
					onMove={onMove}
				/>
			) : null}
		</>
	);
}

export function ConfirmItemDialog({
	action,
	onOpenChange,
	onConfirm,
}: {
	action: ItemConfirmAction | null;
	onOpenChange: (open: boolean) => void;
	onConfirm: () => void;
}) {
	const isDelete = action?.kind === "delete";
	return (
		<AlertDialog open={action !== null} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						{isDelete ? "이 항목을 삭제할까요?" : "이 항목을 보관할까요?"}
					</AlertDialogTitle>
					<AlertDialogDescription>
						{isDelete
							? `“${action?.item.title}” 항목을 삭제합니다.`
							: `"${action?.item.title}" 파일은 삭제되지 않고 archive 폴더로 이동합니다.`}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>취소</AlertDialogCancel>
					<AlertDialogAction
						variant={isDelete ? "destructive" : "default"}
						onClick={onConfirm}
					>
						{isDelete ? "삭제" : "보관"}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
