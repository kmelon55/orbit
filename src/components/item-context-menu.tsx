import {
	Archive,
	Check,
	Copy,
	FileText,
	Folder,
	FolderInput,
	Inbox,
	Plus,
	Trash2,
} from "lucide-react";
import type { ReactElement } from "react";
import { PARA_SPACES, SPACE_LABEL } from "#/lib/orbit/para";
import type { OrbitItem, OrbitSnapshot, OrbitSpace } from "#/lib/orbit/schema";
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
	ContextMenuLabel,
	ContextMenuSeparator,
	ContextMenuSub,
	ContextMenuSubContent,
	ContextMenuSubTrigger,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";

export type ItemConfirmAction = {
	kind: "archive" | "delete";
	item: OrbitItem;
};

const MOVE_ROOTS: { space: OrbitSpace; label: string }[] = [
	{ space: "inbox", label: SPACE_LABEL.inbox },
	...PARA_SPACES.map((space) => ({
		space: space.space,
		label: space.label,
	})),
	{ space: "event", label: SPACE_LABEL.event },
	{ space: "archive", label: SPACE_LABEL.archive },
];

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
	onMove?: (space: OrbitSpace, folder?: string) => void;
}) {
	const showCreate = Boolean(onCreate);
	const showItem = Boolean(item);
	const showMove = Boolean(item && onMove);
	const canArchive = Boolean(item && onArchive && item.space !== "archive");

	return (
		<ContextMenu>
			<ContextMenuTrigger
				asChild
				onContextMenu={(event) => event.stopPropagation()}
			>
				{children}
			</ContextMenuTrigger>
			<ContextMenuContent className="w-52">
				{showCreate ? (
					<ContextMenuItem onSelect={onCreate}>
						<Plus /> {createLabel}
					</ContextMenuItem>
				) : null}
				{showCreate && (showItem || onOpen) ? <ContextMenuSeparator /> : null}
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
					<MoveSubmenu item={item} snapshot={snapshot} onMove={onMove} />
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
					<ContextMenuItem variant="destructive" onSelect={closeThen(onDelete)}>
						<Trash2 /> 삭제
					</ContextMenuItem>
				) : null}
			</ContextMenuContent>
		</ContextMenu>
	);
}

function MoveSubmenu({
	item,
	snapshot,
	onMove,
}: {
	item: OrbitItem;
	snapshot?: OrbitSnapshot;
	onMove: (space: OrbitSpace, folder?: string) => void;
}) {
	return (
		<ContextMenuSub>
			<ContextMenuSubTrigger>
				<Inbox /> 옮기기
			</ContextMenuSubTrigger>
			<ContextMenuSubContent className="w-44">
				{MOVE_ROOTS.map((target) => {
					const folders =
						target.space === "project" ||
						target.space === "area" ||
						target.space === "resource"
							? (snapshot?.folders[target.space] ?? [])
							: [];
					if (folders.length === 0) {
						return (
							<ContextMenuItem
								key={target.space}
								disabled={item.space === target.space && !item.folder}
								onSelect={() => onMove(target.space)}
							>
								{target.label}
							</ContextMenuItem>
						);
					}
					return (
						<ContextMenuSub key={target.space}>
							<ContextMenuSubTrigger>{target.label}</ContextMenuSubTrigger>
							<ContextMenuSubContent className="w-44">
								<ContextMenuItem
									disabled={item.space === target.space && !item.folder}
									onSelect={() => onMove(target.space)}
								>
									루트
								</ContextMenuItem>
								<ContextMenuSeparator />
								<ContextMenuLabel>폴더</ContextMenuLabel>
								{folders.map((folder) => (
									<ContextMenuItem
										key={folder.slug}
										disabled={
											item.space === target.space && item.folder === folder.slug
										}
										onSelect={() => onMove(target.space, folder.slug)}
									>
										<Folder /> {folder.slug}
									</ContextMenuItem>
								))}
							</ContextMenuSubContent>
						</ContextMenuSub>
					);
				})}
			</ContextMenuSubContent>
		</ContextMenuSub>
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
							? `"${action?.item.title}" 파일이 저장소에서 삭제됩니다. 이 동작은 되돌릴 수 없습니다.`
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
