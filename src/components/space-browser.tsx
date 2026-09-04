import { useRouter } from "@tanstack/react-router";
import {
	CalendarDays,
	ChevronRight,
	FilePlus2,
	FileText,
	FolderClosed,
	FolderPlus,
	Link as LinkIcon,
	ListTodo,
	Palette,
	Pencil,
	Plus,
	Search,
	Trash2,
} from "lucide-react";
import {
	type FormEvent,
	Fragment,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { mutateOrbit } from "#/lib/orbit/functions";
import {
	type FolderSpaceId,
	folderOf,
	itemsInSpace,
	spaceConfig,
} from "#/lib/orbit/para";
import type {
	OrbitFolder,
	OrbitFolderColor,
	OrbitItem,
	OrbitSnapshot,
} from "#/lib/orbit/schema";
import {
	ItemWorkspace,
	type ItemWorkspaceNavigatorContext,
} from "@/components/item-workspace";
import { Button } from "@/components/ui/button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuSub,
	ContextMenuSubContent,
	ContextMenuSubTrigger,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

const FOLDER_COLORS: Array<{
	id: OrbitFolderColor;
	label: string;
	icon: string;
	dot: string;
}> = [
	{
		id: "amber",
		label: "노랑",
		icon: "fill-amber-300/60 text-amber-600 dark:fill-amber-400/20 dark:text-amber-300",
		dot: "bg-amber-500",
	},
	{
		id: "red",
		label: "빨강",
		icon: "fill-red-300/60 text-red-600 dark:fill-red-400/20 dark:text-red-300",
		dot: "bg-red-500",
	},
	{
		id: "orange",
		label: "주황",
		icon: "fill-orange-300/60 text-orange-600 dark:fill-orange-400/20 dark:text-orange-300",
		dot: "bg-orange-500",
	},
	{
		id: "lime",
		label: "연두",
		icon: "fill-lime-300/60 text-lime-600 dark:fill-lime-400/20 dark:text-lime-300",
		dot: "bg-lime-500",
	},
	{
		id: "emerald",
		label: "초록",
		icon: "fill-emerald-300/60 text-emerald-600 dark:fill-emerald-400/20 dark:text-emerald-300",
		dot: "bg-emerald-500",
	},
	{
		id: "cyan",
		label: "청록",
		icon: "fill-cyan-300/60 text-cyan-600 dark:fill-cyan-400/20 dark:text-cyan-300",
		dot: "bg-cyan-500",
	},
	{
		id: "blue",
		label: "파랑",
		icon: "fill-blue-300/60 text-blue-600 dark:fill-blue-400/20 dark:text-blue-300",
		dot: "bg-blue-500",
	},
	{
		id: "violet",
		label: "보라",
		icon: "fill-violet-300/60 text-violet-600 dark:fill-violet-400/20 dark:text-violet-300",
		dot: "bg-violet-500",
	},
	{
		id: "pink",
		label: "분홍",
		icon: "fill-pink-300/60 text-pink-600 dark:fill-pink-400/20 dark:text-pink-300",
		dot: "bg-pink-500",
	},
	{
		id: "slate",
		label: "회색",
		icon: "fill-slate-300/60 text-slate-600 dark:fill-slate-400/20 dark:text-slate-300",
		dot: "bg-slate-500",
	},
];

function folderColor(color: OrbitFolderColor) {
	return (
		FOLDER_COLORS.find((entry) => entry.id === color) ??
		FOLDER_COLORS.find((entry) => entry.id === "lime") ??
		FOLDER_COLORS[0]
	);
}

type FolderTreeState = {
	itemsByFolder: Map<string, OrbitItem[]>;
	matchingItems: Set<string>;
	matchingFolders: Set<string>;
};

function itemIcon(item: OrbitItem) {
	if (item.type === "task") return ListTodo;
	if (item.type === "event") return CalendarDays;
	if (item.type === "link") return LinkIcon;
	return FileText;
}

function folderAncestors(folder: string) {
	const parts = folder.split("/");
	return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
}

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
	const { label: spaceLabel, korean: spaceName } = meta;

	const sourceFolders = snapshot.folders[space];
	const [optimisticColors, setOptimisticColors] = useState<
		Partial<Record<string, OrbitFolderColor>>
	>({});
	const folders = useMemo(
		() =>
			sourceFolders.map((folder) => ({
				...folder,
				color: optimisticColors[folder.slug] ?? folder.color,
			})),
		[optimisticColors, sourceFolders],
	);
	useEffect(() => {
		setOptimisticColors((current) => {
			let changed = false;
			const next = { ...current };
			for (const folder of sourceFolders) {
				if (next[folder.slug] === folder.color) {
					delete next[folder.slug];
					changed = true;
				}
			}
			return changed ? next : current;
		});
	}, [sourceFolders]);
	const items = useMemo(
		() => itemsInSpace(snapshot.items, space),
		[snapshot.items, space],
	);
	const inputRef = useRef<HTMLInputElement>(null);
	const colorQueuesRef = useRef(new Map<string, Promise<void>>());
	const [collapsed, setCollapsed] = useState<Set<string>>(() => {
		if (!initialFolder) return new Set();
		const open = new Set(folderAncestors(initialFolder));
		return new Set(
			folders.map((folder) => folder.slug).filter((slug) => !open.has(slug)),
		);
	});
	const [query, setQuery] = useState("");
	const [folderName, setFolderName] = useState("");
	const [newFolderParent, setNewFolderParent] = useState<string>();
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string>();
	const [editingFolder, setEditingFolder] = useState<OrbitFolder>();
	const [editingName, setEditingName] = useState("");
	const [deletingFolder, setDeletingFolder] = useState<OrbitFolder>();

	const childFolders = useMemo(() => {
		const result = new Map<string, OrbitFolder[]>();
		for (const folder of folders) {
			const key = folder.parent ?? "";
			const children = result.get(key) ?? [];
			children.push(folder);
			result.set(key, children);
		}
		for (const children of result.values()) {
			children.sort((left, right) => left.name.localeCompare(right.name, "ko"));
		}
		return result;
	}, [folders]);

	const normalizedQuery = query.trim().toLocaleLowerCase("ko");

	function toggleFolder(folder: OrbitFolder) {
		setCollapsed((current) => {
			const next = new Set(current);
			if (next.has(folder.slug)) next.delete(folder.slug);
			else next.add(folder.slug);
			return next;
		});
	}

	function prepareSubfolder(folder: OrbitFolder) {
		setNewFolderParent(folder.slug);
		setFolderName("");
		setError(undefined);
		setCollapsed((current) => {
			const next = new Set(current);
			next.delete(folder.slug);
			return next;
		});
		window.setTimeout(() => inputRef.current?.focus(), 0);
	}

	async function createFolder(event: FormEvent) {
		event.preventDefault();
		const trimmed = folderName.trim();
		if (!trimmed || saving) return;
		setSaving(true);
		setError(undefined);
		try {
			await mutateOrbit({
				data: {
					action: "create-folder",
					input: { space, name: trimmed, parent: newFolderParent },
				},
			});
			setFolderName("");
			setNewFolderParent(undefined);
			await router.invalidate();
		} catch {
			setError("폴더를 만들지 못했습니다.");
		} finally {
			setSaving(false);
		}
	}

	function createNote(
		folder: string | undefined,
		controls: ItemWorkspaceNavigatorContext,
	) {
		setError(undefined);
		controls.createItem(folder);
	}

	function updateColor(folder: OrbitFolder, color: OrbitFolderColor) {
		setError(undefined);
		const previous = folder.color;
		setOptimisticColors((current) => ({ ...current, [folder.slug]: color }));
		const queued = (
			colorQueuesRef.current.get(folder.slug) ?? Promise.resolve()
		)
			.catch(() => {})
			.then(async () => {
				try {
					await mutateOrbit({
						data: {
							action: "update-folder",
							input: { space, path: folder.slug, color },
						},
					});
					void router.invalidate();
				} catch {
					setOptimisticColors((current) => {
						if (current[folder.slug] !== color) return current;
						return { ...current, [folder.slug]: previous };
					});
					setError("폴더 색상을 바꾸지 못했습니다.");
				}
			});
		colorQueuesRef.current.set(folder.slug, queued);
		void queued.finally(() => {
			if (colorQueuesRef.current.get(folder.slug) === queued) {
				colorQueuesRef.current.delete(folder.slug);
			}
		});
	}

	async function renameFolder(event: FormEvent) {
		event.preventDefault();
		const nextName = editingName.trim();
		if (!editingFolder || !nextName || saving) return;
		setSaving(true);
		setError(undefined);
		try {
			await mutateOrbit({
				data: {
					action: "update-folder",
					input: { space, path: editingFolder.slug, name: nextName },
				},
			});
			setEditingFolder(undefined);
			await router.invalidate();
		} catch {
			setError("같은 이름의 폴더가 있거나 이름을 바꿀 수 없습니다.");
		} finally {
			setSaving(false);
		}
	}

	async function deleteFolder() {
		if (!deletingFolder || saving) return;
		setSaving(true);
		setError(undefined);
		try {
			await mutateOrbit({
				data: {
					action: "delete-folder",
					input: { space, path: deletingFolder.slug },
				},
			});
			setDeletingFolder(undefined);
			await router.invalidate();
		} catch {
			setError("비어 있는 폴더만 삭제할 수 있습니다.");
		} finally {
			setSaving(false);
		}
	}

	function renderFolder(
		folder: OrbitFolder,
		depth: number,
		controls: ItemWorkspaceNavigatorContext,
		tree: FolderTreeState,
	): React.ReactNode {
		if (!tree.matchingFolders.has(folder.slug)) return null;
		const directFolders = childFolders.get(folder.slug) ?? [];
		const directItems = (tree.itemsByFolder.get(folder.slug) ?? []).filter(
			(item) => tree.matchingItems.has(item.id),
		);
		const hasChildren =
			directFolders.length > 0 ||
			(tree.itemsByFolder.get(folder.slug)?.length ?? 0) > 0;
		const expanded = Boolean(normalizedQuery) || !collapsed.has(folder.slug);
		const color = folderColor(folder.color);

		return (
			<Fragment key={folder.slug}>
				<ContextMenu>
					<ContextMenuTrigger asChild>
						<button
							type="button"
							onClick={() => toggleFolder(folder)}
							className="group/folder flex w-full min-w-0 items-center gap-1 rounded-lg py-1.5 pr-2 text-left transition-colors hover:bg-muted/70"
							style={{ paddingLeft: `${8 + depth * 16}px` }}
							aria-expanded={hasChildren ? expanded : undefined}
						>
							<ChevronRight
								className={cn(
									"size-3.5 shrink-0 text-muted-foreground transition-transform",
									expanded && hasChildren && "rotate-90",
									!hasChildren && "opacity-20",
								)}
							/>
							<FolderClosed
								className={cn(
									"size-5 shrink-0 transition-transform group-hover/folder:scale-105",
									color.icon,
								)}
							/>
							<span className="min-w-0 flex-1 truncate text-sm font-medium">
								{folder.name}
							</span>
							<span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">
								{folder.descendantCount || ""}
							</span>
						</button>
					</ContextMenuTrigger>
					<ContextMenuContent className="w-52">
						<ContextMenuItem onSelect={() => createNote(folder.slug, controls)}>
							<FilePlus2 /> 노트 추가
						</ContextMenuItem>
						<ContextMenuItem onSelect={() => prepareSubfolder(folder)}>
							<FolderPlus /> 하위 폴더 만들기
						</ContextMenuItem>
						<ContextMenuSeparator />
						<ContextMenuSub>
							<ContextMenuSubTrigger>
								<Palette /> 색상
							</ContextMenuSubTrigger>
							<ContextMenuSubContent className="w-36">
								{FOLDER_COLORS.map((entry) => (
									<ContextMenuItem
										key={entry.id}
										onSelect={() => updateColor(folder, entry.id)}
									>
										<span className={cn("size-2.5 rounded-full", entry.dot)} />
										{entry.label}
										{folder.color === entry.id ? " · 선택됨" : ""}
									</ContextMenuItem>
								))}
							</ContextMenuSubContent>
						</ContextMenuSub>
						<ContextMenuItem
							onSelect={() => {
								setEditingFolder(folder);
								setEditingName(folder.name);
								setError(undefined);
							}}
						>
							<Pencil /> 이름 바꾸기
						</ContextMenuItem>
						<ContextMenuSeparator />
						<ContextMenuItem
							variant="destructive"
							disabled={folder.descendantCount > 0 || directFolders.length > 0}
							onSelect={() => {
								setDeletingFolder(folder);
								setError(undefined);
							}}
						>
							<Trash2 /> 빈 폴더 삭제
						</ContextMenuItem>
					</ContextMenuContent>
				</ContextMenu>
				<div
					className={cn(
						"grid transition-[grid-template-rows,opacity] duration-200 ease-[var(--interaction-ease)] motion-reduce:transition-none",
						expanded
							? "grid-rows-[1fr] opacity-100"
							: "pointer-events-none grid-rows-[0fr] opacity-0",
					)}
					aria-hidden={!expanded}
					inert={!expanded}
				>
					<div className="min-h-0 overflow-hidden">
						{directFolders.map((child) =>
							renderFolder(child, depth + 1, controls, tree),
						)}
						{directItems.map((item) => renderNote(item, depth + 1, controls))}
					</div>
				</div>
			</Fragment>
		);
	}

	function renderNote(
		item: OrbitItem,
		depth: number,
		controls: ItemWorkspaceNavigatorContext,
	) {
		const Icon = itemIcon(item);
		return (
			<Fragment key={item.id}>
				{controls.renderItem(
					item,
					<button
						type="button"
						onClick={() => controls.openItem(item.id)}
						className={cn(
							"flex w-full min-w-0 items-center gap-2 rounded-lg py-1.5 pr-2 text-left transition-colors",
							controls.selectedId === item.id
								? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm"
								: "text-foreground/85 hover:bg-muted/70",
						)}
						style={{ paddingLeft: `${27 + depth * 16}px` }}
					>
						<Icon className="size-4 shrink-0 text-muted-foreground" />
						<span className="min-w-0 flex-1 truncate text-sm">
							{item.title}
						</span>
					</button>,
				)}
			</Fragment>
		);
	}

	function renderNavigator(controls: ItemWorkspaceNavigatorContext) {
		const itemsByFolder = new Map<string, OrbitItem[]>();
		for (const item of controls.items) {
			const key = folderOf(item) ?? "";
			const children = itemsByFolder.get(key) ?? [];
			children.push(item);
			itemsByFolder.set(key, children);
		}
		for (const children of itemsByFolder.values()) {
			children.sort((left, right) =>
				left.title.localeCompare(right.title, "ko"),
			);
		}
		const matchingItems = normalizedQuery
			? new Set(
					controls.items
						.filter((item) =>
							[
								item.title,
								item.body,
								item.tags.join(" "),
								folderOf(item) ?? "",
							].some((value) =>
								value.toLocaleLowerCase("ko").includes(normalizedQuery),
							),
						)
						.map((item) => item.id),
				)
			: new Set(controls.items.map((item) => item.id));
		const matchingFolders = new Set<string>();
		if (!normalizedQuery) {
			for (const folder of folders) matchingFolders.add(folder.slug);
		} else {
			for (const folder of folders) {
				if (!folder.slug.toLocaleLowerCase("ko").includes(normalizedQuery))
					continue;
				for (const ancestor of folderAncestors(folder.slug))
					matchingFolders.add(ancestor);
			}
			for (const item of controls.items) {
				if (!matchingItems.has(item.id) || !folderOf(item)) continue;
				for (const ancestor of folderAncestors(folderOf(item) ?? "")) {
					matchingFolders.add(ancestor);
				}
			}
		}
		const tree = { itemsByFolder, matchingItems, matchingFolders };
		const rootFolders = childFolders.get("") ?? [];
		const rootItems = (itemsByFolder.get("") ?? []).filter((item) =>
			matchingItems.has(item.id),
		);
		const hasResults =
			rootFolders.some((folder) => matchingFolders.has(folder.slug)) ||
			rootItems.length > 0;

		return (
			<div className="flex h-full min-h-0 flex-col bg-sidebar/35">
				<header className="shrink-0 border-b border-border/50 px-4 py-4">
					<div className="flex items-start justify-between gap-3">
						<div className="min-w-0">
							<p className="text-xs font-semibold tracking-[0.16em] text-muted-foreground uppercase">
								{spaceLabel}
							</p>
							<h2 className="mt-1 text-lg font-semibold tracking-tight">
								{spaceName}
							</h2>
						</div>
						<Button
							size="icon-sm"
							onClick={() => createNote(undefined, controls)}
							aria-label="루트에 새 노트"
						>
							<FilePlus2 />
						</Button>
					</div>
					<p className="mt-1 text-xs leading-5 text-muted-foreground">
						폴더를 펼치고 노트를 선택하세요.
					</p>
				</header>

				<div className="shrink-0 space-y-2 p-3">
					<div className="relative">
						<Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
						<Input
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder="폴더와 노트 검색"
							className="h-9 bg-background/80 pl-8 text-sm"
						/>
					</div>
					<form onSubmit={createFolder} className="space-y-1.5">
						<div className="flex gap-1.5">
							<div className="relative min-w-0 flex-1">
								<FolderPlus className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
								<Input
									ref={inputRef}
									value={folderName}
									onChange={(event) => setFolderName(event.target.value)}
									placeholder={newFolderParent ? "새 하위 폴더" : "새 폴더"}
									className="h-9 bg-background/80 pl-8 text-sm"
								/>
							</div>
							<Button
								type="submit"
								size="icon-sm"
								disabled={!folderName.trim() || saving}
								aria-label="폴더 만들기"
							>
								<Plus />
							</Button>
						</div>
						{newFolderParent ? (
							<div className="flex items-center justify-between gap-2 px-1 text-[11px] text-muted-foreground">
								<span className="truncate">{newFolderParent} 안에 생성</span>
								<button
									type="button"
									onClick={() => setNewFolderParent(undefined)}
									className="shrink-0 hover:text-foreground"
								>
									루트로 변경
								</button>
							</div>
						) : null}
					</form>
					{error ? (
						<output className="block px-1 text-xs text-destructive">
							{error}
						</output>
					) : null}
				</div>

				<ScrollArea className="min-h-0 flex-1">
					<div className="space-y-0.5 px-2 pb-4">
						{rootFolders.map((folder) =>
							renderFolder(folder, 0, controls, tree),
						)}
						{rootItems.map((item) => renderNote(item, 0, controls))}
						{!hasResults ? (
							<div className="px-3 py-10 text-center text-sm leading-6 text-muted-foreground">
								{normalizedQuery
									? "검색 결과가 없습니다."
									: "폴더나 노트를 만들어 시작하세요."}
							</div>
						) : null}
					</div>
				</ScrollArea>

				<footer className="shrink-0 border-t border-border/50 px-4 py-2.5 text-[11px] text-muted-foreground">
					폴더를 우클릭하면 하위 폴더·색상·이름을 관리할 수 있습니다.
				</footer>
			</div>
		);
	}

	return (
		<>
			<ItemWorkspace
				snapshot={snapshot}
				items={items}
				heading={spaceName}
				description={`${spaceLabel} · ${items.length}개`}
				create={{ space }}
				navigator={renderNavigator}
				navigatorOnly
				emptyTitle="노트를 선택하세요"
				emptyDescription="왼쪽 폴더 트리에서 노트를 선택하면 여기에서 바로 편집할 수 있습니다."
				scopeKey={space}
			/>

			<Dialog
				open={Boolean(editingFolder)}
				onOpenChange={(open) => {
					if (!open) setEditingFolder(undefined);
				}}
			>
				<DialogContent className="max-w-sm">
					<DialogHeader>
						<DialogTitle>폴더 이름 바꾸기</DialogTitle>
						<DialogDescription>
							폴더 안의 노트와 하위 폴더 경로도 함께 바뀝니다.
						</DialogDescription>
					</DialogHeader>
					<form onSubmit={renameFolder} className="space-y-4">
						<Input
							autoFocus
							value={editingName}
							onChange={(event) => setEditingName(event.target.value)}
							aria-label="새 폴더 이름"
						/>
						{error ? (
							<output className="block text-sm text-destructive">
								{error}
							</output>
						) : null}
						<div className="flex justify-end gap-2">
							<Button
								type="button"
								variant="outline"
								onClick={() => setEditingFolder(undefined)}
							>
								취소
							</Button>
							<Button type="submit" disabled={!editingName.trim() || saving}>
								변경
							</Button>
						</div>
					</form>
				</DialogContent>
			</Dialog>

			<Dialog
				open={Boolean(deletingFolder)}
				onOpenChange={(open) => {
					if (!open) setDeletingFolder(undefined);
				}}
			>
				<DialogContent className="max-w-sm">
					<DialogHeader>
						<DialogTitle>빈 폴더를 삭제할까요?</DialogTitle>
						<DialogDescription>
							“{deletingFolder?.name}” 폴더만 삭제됩니다. 노트나 하위 폴더가
							있으면 삭제되지 않습니다.
						</DialogDescription>
					</DialogHeader>
					{error ? (
						<output className="block text-sm text-destructive">{error}</output>
					) : null}
					<div className="flex justify-end gap-2">
						<Button
							variant="outline"
							onClick={() => setDeletingFolder(undefined)}
						>
							취소
						</Button>
						<Button
							variant="destructive"
							disabled={saving}
							onClick={() => void deleteFolder()}
						>
							삭제
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</>
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
