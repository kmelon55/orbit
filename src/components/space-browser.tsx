import { useRouter } from "@tanstack/react-router";
import { FolderClosed, FolderOpen, FolderPlus, Plus } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { mutateOrbit } from "#/lib/orbit/functions";
import {
	type FolderSpaceId,
	itemsInFolder,
	spaceConfig,
	unfiledInSpace,
} from "#/lib/orbit/para";
import type { OrbitSnapshot } from "#/lib/orbit/schema";
import { ItemContextMenu } from "@/components/item-context-menu";
import { ItemWorkspace } from "@/components/item-workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

const UNFILED = "__unfiled__" as const;
type FolderSelection = string | typeof UNFILED | null;

function UnifiedFolderWorkspace({
	snapshot,
	space,
	initialFolder,
}: {
	snapshot: OrbitSnapshot;
	space: FolderSpaceId;
	initialFolder?: string;
}) {
	const router = useRouter();
	const meta = spaceConfig(space);
	if (!meta) throw new Error(`Unknown folder space: ${space}`);
	const folders = snapshot.folders[space];
	const unfiled = unfiledInSpace(snapshot.items, space);
	const [selectedFolder, setSelectedFolder] = useState<FolderSelection>(
		initialFolder ?? null,
	);
	const [showFolders, setShowFolders] = useState(!initialFolder);
	const [name, setName] = useState("");
	const [saving, setSaving] = useState(false);

	const items = useMemo(() => {
		if (selectedFolder === null) return [];
		if (selectedFolder === UNFILED) return unfiled;
		return itemsInFolder(snapshot.items, space, selectedFolder);
	}, [selectedFolder, snapshot.items, space, unfiled]);

	function openFolder(folder: FolderSelection) {
		setSelectedFolder(folder);
		setShowFolders(false);
	}

	async function createFolder(event: FormEvent) {
		event.preventDefault();
		const trimmed = name.trim();
		if (!trimmed || saving) return;
		setSaving(true);
		try {
			const created = await mutateOrbit({
				data: { action: "create-folder", input: { space, name: trimmed } },
			});
			setName("");
			await router.invalidate();
			if (created && "slug" in created) openFolder(created.slug);
		} finally {
			setSaving(false);
		}
	}

	async function createNote(folder?: string) {
		await mutateOrbit({
			data: {
				action: "create-item",
				input: { title: "새 노트", type: "note", body: "", space, folder },
			},
		});
		await router.invalidate();
	}

	const navigator = (
		<div className="flex h-full min-h-0 flex-col bg-sidebar/35">
			<header className="shrink-0 border-b border-border/50 px-4 py-4">
				<p className="text-xs font-semibold tracking-[0.16em] text-muted-foreground uppercase">
					{meta.label}
				</p>
				<h2 className="mt-1 text-lg font-semibold tracking-tight">
					{meta.korean}
				</h2>
				<p className="mt-1 text-xs leading-5 text-muted-foreground">
					{meta.hint}
				</p>
			</header>
			<form onSubmit={createFolder} className="flex shrink-0 gap-1.5 p-3">
				<div className="relative min-w-0 flex-1">
					<FolderPlus className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
					<Input
						value={name}
						onChange={(event) => setName(event.target.value)}
						placeholder="새 폴더"
						className="h-9 bg-background/80 pl-8 text-sm"
					/>
				</div>
				<Button
					type="submit"
					size="icon-sm"
					disabled={!name.trim() || saving}
					aria-label="폴더 만들기"
				>
					<Plus />
				</Button>
			</form>
			<ScrollArea className="min-h-0 flex-1">
				<div className="space-y-1 px-2 pb-3">
					{folders.map((folder) => (
						<ItemContextMenu
							key={folder.slug}
							createLabel="노트 추가"
							onCreate={() => void createNote(folder.slug)}
							onOpen={() => openFolder(folder.slug)}
						>
							<button
								type="button"
								onClick={() => openFolder(folder.slug)}
								className={cn(
									"group/folder flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors",
									selectedFolder === folder.slug
										? "bg-sidebar-accent text-sidebar-accent-foreground"
										: "hover:bg-muted/70",
								)}
							>
								<FolderClosed className="size-8 shrink-0 fill-amber-300/55 text-amber-600/80 transition-transform group-hover/folder:scale-105 dark:fill-amber-400/20 dark:text-amber-300/80" />
								<span className="min-w-0 flex-1">
									<span className="block truncate text-sm font-medium">
										{folder.slug}
									</span>
									<span className="mt-0.5 block text-xs text-muted-foreground">
										{folder.count}개 항목
									</span>
								</span>
							</button>
						</ItemContextMenu>
					))}
					{unfiled.length > 0 ? (
						<ItemContextMenu
							createLabel="노트 추가"
							onCreate={() => void createNote()}
							onOpen={() => openFolder(UNFILED)}
						>
							<button
								type="button"
								onClick={() => openFolder(UNFILED)}
								className={cn(
									"group/folder flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors",
									selectedFolder === UNFILED
										? "bg-sidebar-accent text-sidebar-accent-foreground"
										: "hover:bg-muted/70",
								)}
							>
								<FolderOpen className="size-8 shrink-0 text-muted-foreground/70 transition-transform group-hover/folder:scale-105" />
								<span className="min-w-0 flex-1">
									<span className="block truncate text-sm font-medium">
										폴더 없음
									</span>
									<span className="mt-0.5 block text-xs text-muted-foreground">
										{unfiled.length}개 항목
									</span>
								</span>
							</button>
						</ItemContextMenu>
					) : null}
					{folders.length === 0 && unfiled.length === 0 ? (
						<div className="px-3 py-10 text-center text-sm leading-6 text-muted-foreground">
							폴더를 만들거나 여기에 노트를 정리해 보세요.
						</div>
					) : null}
				</div>
			</ScrollArea>
		</div>
	);

	const folderName =
		selectedFolder === UNFILED ? "폴더 없음" : (selectedFolder ?? meta.korean);
	const selectedFolderName =
		selectedFolder && selectedFolder !== UNFILED ? selectedFolder : undefined;

	return (
		<ItemWorkspace
			snapshot={snapshot}
			items={items}
			heading={folderName}
			description={
				selectedFolder === null
					? "폴더를 선택하세요"
					: `${meta.label} · ${items.length}개`
			}
			create={
				selectedFolder === null
					? undefined
					: { space, folder: selectedFolderName }
			}
			disableCreate={selectedFolder === null}
			emptyTitle={
				selectedFolder === null ? "폴더를 선택하세요" : "빈 폴더입니다"
			}
			emptyDescription={
				selectedFolder === null
					? "왼쪽에서 폴더를 열면 항목 목록과 편집기가 이어집니다."
					: "새 노트를 만들면 이 폴더에 바로 저장됩니다."
			}
			navigator={navigator}
			showNavigator={showFolders}
			onShowNavigator={() => setShowFolders(true)}
			scopeKey={`${space}:${selectedFolder ?? "root"}`}
		/>
	);
}

export function SpaceIndexPage({
	snapshot,
	space,
}: {
	snapshot: OrbitSnapshot;
	space: Exclude<FolderSpaceId, "archive">;
}) {
	return <UnifiedFolderWorkspace snapshot={snapshot} space={space} />;
}

export function SpaceFolderPage({
	snapshot,
	space,
	folder,
}: {
	snapshot: OrbitSnapshot;
	space: Exclude<FolderSpaceId, "archive">;
	folder: string;
}) {
	return (
		<UnifiedFolderWorkspace
			snapshot={snapshot}
			space={space}
			initialFolder={folder}
		/>
	);
}

export function ArchivePage({ snapshot }: { snapshot: OrbitSnapshot }) {
	return <UnifiedFolderWorkspace snapshot={snapshot} space="archive" />;
}
