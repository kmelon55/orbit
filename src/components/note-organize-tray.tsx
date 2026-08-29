import { Archive, Bookmark, Flag, Inbox, RefreshCw, X } from "lucide-react";
import { useState } from "react";
import { PARA_SPACES, SPACE_LABEL } from "#/lib/orbit/para";
import type { OrbitItem, OrbitSnapshot, OrbitSpace } from "#/lib/orbit/schema";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

const targets = [
	{
		space: "inbox" as const,
		label: "나중에 정리",
		hint: "아직 모르겠다면 그대로 두세요",
		icon: Inbox,
	},
	{
		space: "project" as const,
		label: "프로젝트",
		hint: "끝내야 할 결과가 있나요?",
		icon: Flag,
	},
	{
		space: "area" as const,
		label: "영역",
		hint: "계속 돌봐야 하는 주제인가요?",
		icon: RefreshCw,
	},
	{
		space: "resource" as const,
		label: "자료",
		hint: "나중에 다시 꺼낼 참고인가요?",
		icon: Bookmark,
	},
	{
		space: "archive" as const,
		label: "보관",
		hint: "지금은 필요 없나요?",
		icon: Archive,
	},
];

function targetKey(space: OrbitSpace, folder?: string) {
	return `${space}:${folder ?? "root"}`;
}

export function NoteOrganizeTray({
	open,
	snapshot,
	activeItem,
	draggingId,
	message,
	hideInboxTarget = false,
	variant = "overlay",
	onClose,
	onMove,
}: {
	open: boolean;
	snapshot: OrbitSnapshot;
	activeItem?: OrbitItem;
	draggingId: string | null;
	message?: string;
	hideInboxTarget?: boolean;
	variant?: "overlay" | "panel";
	onClose?: () => void;
	onMove: (id: string, space: OrbitSpace, folder?: string) => void;
}) {
	const [over, setOver] = useState<string | null>(null);
	const isPanel = variant === "panel";
	const visible = isPanel || open;
	const visibleTargets =
		isPanel || hideInboxTarget
			? targets.filter((target) => target.space !== "inbox")
			: targets;
	const movingItem =
		snapshot.items.find((item) => item.id === draggingId) ?? activeItem;

	function receive(event: React.DragEvent, space: OrbitSpace, folder?: string) {
		event.preventDefault();
		const id =
			event.dataTransfer.getData("application/x-orbit-item-id") ||
			event.dataTransfer.getData("text/plain") ||
			draggingId;
		setOver(null);
		if (id) onMove(id, space, folder);
	}

	function moveActive(space: OrbitSpace, folder?: string) {
		if (movingItem) onMove(movingItem.id, space, folder);
	}

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
						{movingItem
							? `“${movingItem.title}”을 끌어 놓으세요`
							: "노트를 고른 뒤 목적지를 누르세요"}
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

			{message ? (
				<output className="mx-3 mt-3 rounded-lg bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-700 dark:text-emerald-300">
					{message}
				</output>
			) : null}

			<ScrollArea className="min-h-0 flex-1">
				<div className="space-y-2 p-3">
					{visibleTargets.map((target) => {
						const Icon = target.icon;
						const key = targetKey(target.space);
						const current =
							movingItem?.space === target.space && !movingItem.folder;
						const folders = PARA_SPACES.some(
							(space) => space.space === target.space,
						)
							? snapshot.folders[
									target.space as "project" | "area" | "resource"
								]
							: [];

						return (
							<fieldset
								key={target.space}
								className={cn(
									"min-w-0 rounded-xl border bg-card transition-[border-color,background-color,box-shadow] duration-150",
									over === key
										? "border-foreground/35 bg-accent shadow-md"
										: "border-border/70",
								)}
								onDragEnter={() => setOver(key)}
								onDragLeave={(event) => {
									if (
										!event.currentTarget.contains(event.relatedTarget as Node)
									) {
										setOver(null);
									}
								}}
								onDragOver={(event) => {
									event.preventDefault();
									event.dataTransfer.dropEffect = "move";
									setOver(key);
								}}
								onDrop={(event) => receive(event, target.space)}
							>
								<button
									type="button"
									disabled={!movingItem || current}
									onClick={() => moveActive(target.space)}
									className="flex w-full items-start gap-3 p-3 text-left disabled:cursor-default disabled:opacity-60"
								>
									<span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
										<Icon className="size-4" />
									</span>
									<span className="min-w-0 flex-1">
										<span className="flex items-center justify-between gap-2 text-sm font-medium">
											{target.label}
											{current ? (
												<span className="text-[10px] font-normal text-muted-foreground">
													현재 위치
												</span>
											) : null}
										</span>
										<span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
											{target.hint}
										</span>
									</span>
								</button>

								{folders.length > 0 ? (
									<div className="flex flex-wrap gap-1.5 border-t border-border/60 px-3 py-2.5">
										{folders.map((folder) => {
											const folderKey = targetKey(target.space, folder.slug);
											const inFolder =
												movingItem?.space === target.space &&
												movingItem.folder === folder.slug;
											return (
												<button
													key={folder.slug}
													type="button"
													disabled={!movingItem || inFolder}
													onClick={() => moveActive(target.space, folder.slug)}
													onDragEnter={(event) => {
														event.stopPropagation();
														setOver(folderKey);
													}}
													onDragOver={(event) => {
														event.preventDefault();
														event.stopPropagation();
														event.dataTransfer.dropEffect = "move";
														setOver(folderKey);
													}}
													onDrop={(event) => {
														event.stopPropagation();
														receive(event, target.space, folder.slug);
													}}
													className={cn(
														"rounded-md border px-2 py-1 text-xs transition-colors disabled:cursor-default",
														over === folderKey
															? "border-foreground/30 bg-foreground text-background"
															: inFolder
																? "border-transparent bg-muted text-muted-foreground"
																: "border-border/70 bg-background hover:bg-accent",
													)}
												>
													{folder.slug} · {folder.count}
												</button>
											);
										})}
									</div>
								) : null}
							</fieldset>
						);
					})}
				</div>
			</ScrollArea>

			<footer className="border-t border-border/60 px-4 py-3 text-xs leading-5 text-muted-foreground">
				{isPanel
					? "놓는 순간 Inbox에서 빠지고, 왼쪽 PARA 공간에서 다시 찾을 수 있습니다."
					: "폴더는 꼭 필요할 때만 쓰세요. 분류해도 노트 파일은 그대로 유지됩니다."}
				{movingItem ? (
					<span className="mt-1 block">
						현재: {SPACE_LABEL[movingItem.space]}
						{movingItem.folder ? ` / ${movingItem.folder}` : ""}
					</span>
				) : null}
			</footer>
		</aside>
	);
}
