import {
	Check,
	ChevronRight,
	FileText,
	Folder,
	FolderInput,
	FolderOpen,
	FolderPlus,
	Search,
	X,
} from "lucide-react";
import {
	type DragEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { classificationItemRevision } from "#/lib/orbit/classification";
import { folderColor } from "#/lib/orbit/folder-colors";
import { folderDisplayPath, indexFolderTree } from "#/lib/orbit/folder-tree";
import { mutateOrbit } from "#/lib/orbit/functions";
import { moveItemLocally } from "#/lib/orbit/item-move";
import { folderOf, isInboxItem } from "#/lib/orbit/para";
import type {
	OrbitFolder,
	OrbitItem,
	OrbitSnapshot,
	OrbitSpace,
} from "#/lib/orbit/schema";
import { useI18n } from "@/components/locale-provider";
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
import { cn } from "@/lib/utils";
import { ClassificationSuggestions } from "./classification-suggestions";

const ROOTS = [
	{ space: "project", label: "프로젝트" },
	{ space: "area", label: "영역" },
	{ space: "resource", label: "자료" },
	{ space: "archive", label: "보관" },
] as const;

type Destination = {
	space: OrbitSpace;
	folder?: string;
	label: string;
	parent?: string;
	color?: string;
	depth: number;
	hasChildren: boolean;
};

function isFolderSpace(space: OrbitSpace): space is OrbitFolder["space"] {
	return ROOTS.some((root) => root.space === space);
}

function keyOf(target: Pick<Destination, "space" | "folder">) {
	return `${target.space}:${target.folder ?? ""}`;
}

function FolderBranch({
	open,
	children,
}: {
	open: boolean;
	children: ReactNode;
}) {
	const [mounted, setMounted] = useState(open);
	useEffect(() => {
		if (open) {
			setMounted(true);
			return;
		}
		const timer = setTimeout(() => setMounted(false), 240);
		return () => clearTimeout(timer);
	}, [open]);
	return (
		<div
			inert={!open}
			aria-hidden={!open}
			data-folder-branch
			data-open={open}
			className={cn(
				"grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
				open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
			)}
		>
			<div className="min-h-0 overflow-hidden">
				{open || mounted ? children : null}
			</div>
		</div>
	);
}

export type MoveItem = (
	id: string,
	space: OrbitSpace,
	folder?: string,
) => void | Promise<void>;

export function FolderDestinationPicker({
	snapshot,
	item,
	draggingId,
	hideInbox = false,
	onMove,
	beforeClassify,
}: {
	snapshot: OrbitSnapshot;
	item?: OrbitItem;
	draggingId?: string | null;
	hideInbox?: boolean;
	onMove: MoveItem;
	beforeClassify?: (id: string) => Promise<void>;
}) {
	const { t, errorText } = useI18n();

	const [query, setQuery] = useState("");
	const [previewId, setPreviewId] = useState<string>();
	const [noteLimits, setNoteLimits] = useState<Record<string, number>>({});
	const [newFolderParent, setNewFolderParent] = useState<Destination>();
	const [folderName, setFolderName] = useState("");
	const [folderError, setFolderError] = useState<string>();
	const [creating, setCreating] = useState(false);
	const creatingRef = useRef(false);
	const itemIdRef = useRef(item?.id);
	itemIdRef.current = item?.id;
	const folderNameRef = useRef<HTMLInputElement>(null);
	const [selection, setSelection] = useState<{
		itemId?: string;
		target: Destination;
	}>();
	const selected =
		selection && selection.itemId === item?.id ? selection.target : undefined;
	const hoveredKey = useRef<string | undefined>(undefined);
	const [expanded, setExpanded] = useState(() => {
		const keys = new Set(["project:", "area:"]);
		const parts = (item ? folderOf(item)?.split("/") : undefined) ?? [];
		parts.forEach((_, i) => {
			keys.add(`${item?.space}:${parts.slice(0, i + 1).join("/")}`);
		});
		return keys;
	});
	const [recent, setRecent] = useState<string[]>([]);
	const [over, setOver] = useState<string>();
	const [busy, setBusy] = useState(false);
	const busyRef = useRef(false);
	const [error, setError] = useState<string>();
	const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
		undefined,
	);
	const scrollRef = useRef<HTMLFieldSetElement>(null);
	const scrollFrame = useRef<number | undefined>(undefined);
	const scrollSpeed = useRef(0);
	const storageKey = `orbit:recent-destinations:v1:${snapshot.vaultPath}`;

	useEffect(() => {
		try {
			const value: unknown = JSON.parse(
				localStorage.getItem(storageKey) ?? "[]",
			);
			setRecent(
				Array.isArray(value)
					? value
							.filter((key): key is string => typeof key === "string")
							.slice(0, 6)
					: [],
			);
		} catch {
			setRecent([]);
		}
	}, [storageKey]);
	useEffect(
		() => () => {
			clearTimeout(hoverTimer.current);
			if (scrollFrame.current !== undefined)
				cancelAnimationFrame(scrollFrame.current);
		},
		[],
	);
	useEffect(() => {
		if (draggingId) return;
		clearTimeout(hoverTimer.current);
		scrollSpeed.current = 0;
		hoveredKey.current = undefined;
		setOver(undefined);
	}, [draggingId]);

	const trees = useMemo(
		() =>
			ROOTS.filter(
				(root) => item?.type !== "event" || root.space === "archive",
			).map((root) => ({
				...root,
				label: t(root.label),
				tree: indexFolderTree(
					snapshot.items.filter(
						(entry) => entry.space === root.space && entry.id !== item?.id,
					),
					snapshot.folders[root.space],
					snapshot.treeOrder?.[root.space],
				),
			})),
		[
			snapshot.folders,
			snapshot.treeOrder,
			snapshot.items,
			item?.type,
			item?.id,
			t,
		],
	);
	const destinations = useMemo(
		() =>
			trees.flatMap(({ space, label, tree }) => [
				{
					space,
					label,
					depth: 0,
					hasChildren: Boolean(tree.childrenByFolder.get("")?.length),
				} as Destination,
				...tree.folders.map(
					(folder): Destination => ({
						space,
						folder: folder.slug,
						label: folder.name,
						parent: [
							label,
							folderDisplayPath(tree.folders, folder.parent ?? ""),
						]
							.filter(Boolean)
							.join(" / "),
						color: folderColor(folder.color).icon,
						depth: folder.slug.split("/").length,
						hasChildren: Boolean(
							tree.childrenByFolder.get(folder.slug)?.length,
						),
					}),
				),
			]),
		[trees],
	);
	const byKey = useMemo(
		() => new Map(destinations.map((target) => [keyOf(target), target])),
		[destinations],
	);
	const treesBySpace = useMemo(
		() => new Map(trees.map(({ space, tree }) => [space, tree])),
		[trees],
	);
	const words = useMemo(
		() => query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean),
		[query],
	);
	const matches = useCallback(
		(text: string) => {
			const lower = text.toLocaleLowerCase();
			return words.every((word) => lower.includes(word));
		},
		[words],
	);
	const searchResults = useMemo(
		() =>
			destinations.filter(
				(target) =>
					matches(`${target.parent ?? ""} ${target.label}`) ||
					(isFolderSpace(target.space) &&
						treesBySpace
							.get(target.space)
							?.itemsByFolder.get(target.folder ?? "")
							?.some((entry) => matches(`${entry.title} ${entry.body}`))),
			),
		[destinations, matches, treesBySpace],
	);
	const recentRows = recent.flatMap((key) => {
		const target = byKey.get(key);
		return target ? [target] : [];
	});

	function stopDrag() {
		clearTimeout(hoverTimer.current);
		scrollSpeed.current = 0;
		setOver(undefined);
		hoveredKey.current = undefined;
	}
	async function choose(target: Destination, id = item?.id) {
		const before = snapshot.items.find((entry) => entry.id === id);
		if (!id || !before || busyRef.current || creatingRef.current) return;
		const after = moveItemLocally(before, target.space, target.folder);
		if (before.space === after.space && folderOf(before) === folderOf(after))
			return;
		busyRef.current = true;
		setBusy(true);
		setError(undefined);
		stopDrag();
		try {
			await onMove(id, target.space, target.folder);
			setSelection(undefined);
			if (target.space !== "inbox") {
				const next = [
					keyOf(target),
					...recent.filter((key) => key !== keyOf(target)),
				].slice(0, 6);
				setRecent(next);
				try {
					localStorage.setItem(storageKey, JSON.stringify(next));
				} catch {
					/* Storage is optional. */
				}
			}
		} catch {
			setError(t("옮기지 못했습니다. 다시 시도해 주세요."));
		} finally {
			busyRef.current = false;
			setBusy(false);
		}
	}
	function enterTarget(target: Destination) {
		const key = keyOf(target);
		setOver(key);
		if (hoveredKey.current === key) return;
		hoveredKey.current = key;
		clearTimeout(hoverTimer.current);
		if (target.hasChildren && !expanded.has(key)) {
			hoverTimer.current = setTimeout(() => {
				setExpanded((value) => new Set(value).add(key));
			}, 650);
		}
	}
	function dragOver(event: DragEvent) {
		if (
			!draggingId &&
			!event.dataTransfer.types.includes("application/x-orbit-item-id")
		)
			return;
		event.preventDefault();
		event.dataTransfer.dropEffect = "move";
		const bounds = scrollRef.current?.getBoundingClientRect();
		if (!bounds) return;
		const top = Math.max(
			0,
			Math.min(1, (bounds.top + 56 - event.clientY) / 56),
		);
		const bottom = Math.max(
			0,
			Math.min(1, (event.clientY - bounds.bottom + 56) / 56),
		);
		scrollSpeed.current = (bottom - top) * 12;
		if (scrollFrame.current !== undefined) return;
		function tick() {
			if (!scrollSpeed.current) {
				scrollFrame.current = undefined;
				return;
			}
			scrollRef.current?.scrollBy(0, scrollSpeed.current);
			scrollFrame.current = requestAnimationFrame(tick);
		}
		scrollFrame.current = requestAnimationFrame(tick);
	}
	function browse(target: Destination, flat: boolean) {
		if (busy || creating || draggingId) return;
		setSelection({ itemId: item?.id, target });
		const key = keyOf(target);
		setExpanded((value) => {
			const next = new Set(value);
			if (flat) {
				next.add(`${target.space}:`);
				const parts = target.folder?.split("/") ?? [];
				parts.forEach((_, i) => {
					next.add(`${target.space}:${parts.slice(0, i + 1).join("/")}`);
				});
			} else if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
		if (flat) setQuery("");
	}
	function renderRow(target: Destination, flat = false) {
		const key = keyOf(target);
		const current =
			item?.space === target.space && folderOf(item) === target.folder;
		const active = selected && keyOf(selected) === key;
		const isOpen = (flat && Boolean(query.trim())) || expanded.has(key);
		const row = (
			<button
				key={key}
				type="button"
				disabled={busy || creating}
				data-destination
				data-destination-key={key}
				aria-expanded={target.hasChildren ? isOpen : undefined}
				aria-pressed={Boolean(active)}
				aria-label={`${target.parent ? `${target.parent} / ` : ""}${target.label}${target.hasChildren ? (isOpen ? t("접기") : t("펼치기")) : t("폴더 선택")}`}
				title={[target.parent, target.label].filter(Boolean).join(" / ")}
				className={cn(
					"flex min-h-10 w-full min-w-0 items-center gap-2 rounded-md py-2 pr-3 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring",
					over === key
						? "bg-primary/15 ring-2 ring-inset ring-primary/60"
						: active
							? "bg-accent text-accent-foreground"
							: "hover:bg-accent/70",
				)}
				style={{
					paddingLeft: 10 + (flat ? 0 : Math.min(target.depth, 6) * 14),
				}}
				onClick={() => browse(target, flat)}
				onDragEnter={(event) => {
					if (
						!draggingId &&
						!event.dataTransfer.types.includes("application/x-orbit-item-id")
					)
						return;
					event.stopPropagation();
					enterTarget(target);
				}}
				onDragOver={(event) => {
					if (
						!draggingId &&
						!event.dataTransfer.types.includes("application/x-orbit-item-id")
					)
						return;
					dragOver(event);
					enterTarget(target);
				}}
				onDragLeave={(event) => {
					if (event.currentTarget.contains(event.relatedTarget as Node)) return;
					clearTimeout(hoverTimer.current);
					hoveredKey.current = undefined;
					setOver((value) => (value === key ? undefined : value));
				}}
				onDrop={(event) => {
					event.preventDefault();
					event.stopPropagation();
					const id =
						event.dataTransfer.getData("application/x-orbit-item-id") ||
						draggingId;
					stopDrag();
					if (id) void choose(target, id);
				}}
			>
				<ChevronRight
					className={cn(
						"size-3.5 shrink-0 transition-transform duration-200 motion-reduce:transition-none",
						!target.hasChildren && "invisible",
						isOpen && target.hasChildren && "rotate-90",
					)}
				/>
				{isOpen ? (
					<FolderOpen
						className={cn(
							"size-4 shrink-0",
							target.color ?? "text-muted-foreground",
						)}
					/>
				) : (
					<Folder
						className={cn(
							"size-4 shrink-0",
							target.color ?? "text-muted-foreground",
						)}
					/>
				)}
				<span className="min-w-0 flex-1">
					<span className="block truncate">{target.label}</span>
					{flat && target.parent ? (
						<span className="block truncate text-xs text-muted-foreground">
							{target.parent}
						</span>
					) : null}
				</span>
				{over === key ? (
					<span className="shrink-0 text-[11px] font-medium">
						{t("여기에 놓기")}
					</span>
				) : current ? (
					<Check className="size-3.5 shrink-0 text-muted-foreground" />
				) : null}
			</button>
		);
		if (!isFolderSpace(target.space)) return row;
		return (
			<ContextMenu key={key}>
				<ContextMenuTrigger
					asChild
					onContextMenu={(event) => event.stopPropagation()}
				>
					{row}
				</ContextMenuTrigger>
				<ContextMenuContent className="w-48">
					<ContextMenuItem
						disabled={busy || creating}
						onSelect={() => browse(target, true)}
					>
						<FolderOpen />
						{t("폴더 내용 보기")}
					</ContextMenuItem>
					<ContextMenuItem
						disabled={busy || creating}
						onSelect={() => prepareFolder(target)}
					>
						<FolderPlus />
						{target.folder ? t("새 하위 폴더") : t("새 폴더")}
					</ContextMenuItem>
					<ContextMenuSeparator />
					<ContextMenuItem
						disabled={
							!item || current || busy || creating || Boolean(draggingId)
						}
						onSelect={() => void choose(target)}
					>
						<FolderInput />
						{t("여기로 이동")}
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>
		);
	}

	function prepareFolder(target: Destination) {
		if (busyRef.current || creatingRef.current || !isFolderSpace(target.space))
			return;
		setFolderName("");
		setFolderError(undefined);
		// Let the context menu release focus before opening the dialog.
		window.setTimeout(() => setNewFolderParent(target), 0);
	}
	async function createFolder() {
		const target = newFolderParent;
		if (
			!target ||
			!isFolderSpace(target.space) ||
			!folderName.trim() ||
			creatingRef.current ||
			busyRef.current
		)
			return;
		creatingRef.current = true;
		setCreating(true);
		setFolderError(undefined);
		const itemId = item?.id;
		try {
			const result = await mutateOrbit({
				data: {
					action: "create-folder",
					input: {
						space: target.space,
						parent: target.folder,
						name: folderName.trim(),
					},
				},
			});
			if (!result || !("slug" in result) || typeof result.slug !== "string")
				throw new Error("Invalid folder result");
			const folder = result.slug;
			const next: Destination = {
				space: target.space,
				folder,
				label:
					"name" in result && typeof result.name === "string"
						? result.name
						: (folder.split("/").at(-1) ?? folder),
				parent: [target.parent, target.label].filter(Boolean).join(" / "),
				depth: target.depth + 1,
				hasChildren: false,
			};
			if (itemIdRef.current === itemId) setSelection({ itemId, target: next });
			setExpanded((value) => {
				const expanded = new Set(value).add(`${target.space}:`);
				folder.split("/").forEach((_, index, parts) => {
					expanded.add(
						`${target.space}:${parts.slice(0, index + 1).join("/")}`,
					);
				});
				return expanded;
			});
			setQuery("");
			setNewFolderParent(undefined);
		} catch {
			setFolderError(t("폴더를 만들지 못했습니다."));
		} finally {
			creatingRef.current = false;
			setCreating(false);
		}
	}
	function renderNote(entry: OrbitItem, target: Destination, flat: boolean) {
		const open = previewId === entry.id;
		return (
			<div
				key={entry.id}
				style={{
					paddingLeft: 10 + (flat ? 1 : Math.min(target.depth + 1, 7)) * 14,
				}}
			>
				<ContextMenu>
					<ContextMenuTrigger
						asChild
						onContextMenu={(event) => event.stopPropagation()}
					>
						<button
							type="button"
							data-destination-note={entry.id}
							aria-expanded={open}
							onClick={() => setPreviewId(open ? undefined : entry.id)}
							className="flex min-h-9 w-full min-w-0 items-center gap-2 rounded-md py-1.5 pr-3 text-left text-sm text-muted-foreground hover:bg-accent/70 focus-visible:outline-2 focus-visible:outline-ring"
						>
							<ChevronRight
								className={cn("size-3.5 shrink-0", open && "rotate-90")}
							/>
							<FileText className="size-4 shrink-0" />
							<span className="truncate">{entry.title}</span>
						</button>
					</ContextMenuTrigger>
					<ContextMenuContent>
						<ContextMenuItem onSelect={() => setPreviewId(entry.id)}>
							<FileText />
							{t("미리보기")}
						</ContextMenuItem>
						<ContextMenuItem
							disabled={busy || creating}
							onSelect={() => browse(target, true)}
						>
							<Folder />
							{t("이 폴더 선택")}
						</ContextMenuItem>
						<ContextMenuItem
							disabled={busy || creating}
							onSelect={() => prepareFolder(target)}
						>
							<FolderPlus />
							{t("새 폴더")}
						</ContextMenuItem>
					</ContextMenuContent>
				</ContextMenu>
				{open ? (
					<div className="my-1 mr-3 max-h-56 overflow-y-auto whitespace-pre-wrap break-words rounded-md border bg-muted/30 p-3 text-xs leading-5 select-text">
						{entry.body || entry.url || t("내용이 없습니다.")}
					</div>
				) : null}
			</div>
		);
	}
	function renderBranch(target: Destination, flat = false): ReactNode {
		const key = keyOf(target);
		const entries = isFolderSpace(target.space)
			? (treesBySpace
					.get(target.space)
					?.childrenByFolder.get(target.folder ?? "") ?? [])
			: [];
		const showAllNotes = matches(`${target.parent ?? ""} ${target.label}`);
		const open = flat || expanded.has(key);
		const limitKey = `${key}:${query.trim()}`;
		const limit = noteLimits[limitKey] ?? 40;
		const notes = entries.flatMap((entry) =>
			entry.item &&
			(!flat ||
				showAllNotes ||
				matches(`${entry.item.title} ${entry.item.body}`))
				? [entry.item]
				: [],
		);
		const visibleIds = new Set(notes.slice(0, limit).map((entry) => entry.id));
		return (
			<div key={key}>
				{renderRow(target, flat)}
				{target.hasChildren ? (
					<FolderBranch open={open}>
						{entries.map((entry) => {
							if (entry.item) {
								return visibleIds.has(entry.item.id)
									? renderNote(entry.item, target, flat)
									: null;
							}
							const child = entry.folder
								? byKey.get(`${target.space}:${entry.folder.slug}`)
								: undefined;
							return child && !flat ? renderBranch(child) : null;
						})}
						{notes.length > limit ? (
							<Button
								type="button"
								variant="ghost"
								size="sm"
								className="ml-8 text-xs"
								onClick={() =>
									setNoteLimits((value) => ({
										...value,
										[limitKey]: limit + 40,
									}))
								}
							>
								{t("노트 더 보기 ({0})", [notes.length - limit])}
							</Button>
						) : null}
					</FolderBranch>
				) : open ? (
					<p className="px-8 py-1 text-xs text-muted-foreground">
						{t("빈 폴더")}
					</p>
				) : null}
			</div>
		);
	}
	const selectedCurrent =
		selected &&
		item?.space === selected.space &&
		folderOf(item) === selected.folder;
	const selectionLabel = selected
		? [selected.parent, selected.label].filter(Boolean).join(" / ")
		: t("폴더를 선택하세요");
	return (
		<div className="flex min-h-0 flex-1 flex-col" aria-busy={busy || creating}>
			{item && isInboxItem(item) && (
				<ClassificationSuggestions
					placement="panel"
					key={item.id}
					source={{ kind: "item", id: item.id }}
					revision={classificationItemRevision(item)}
					disabled={busy || creating || item.id.startsWith("orbit-optimistic:")}
					beforeClassify={() => beforeClassify?.(item.id) ?? Promise.resolve()}
					onMove={async (folder, space) => {
						const destination = byKey.get(`${space}:${folder}`);
						if (destination) await choose(destination, item.id);
					}}
				/>
			)}
			<div className="relative m-3 mb-2 shrink-0">
				<Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" />
				<Input
					data-folder-search
					aria-label={t("폴더와 노트 검색")}
					placeholder={t("폴더와 노트 검색")}
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					onDrop={(event) => {
						if (
							event.dataTransfer.types.includes("application/x-orbit-item-id")
						)
							event.preventDefault();
						stopDrag();
					}}
					className="pl-9"
					onKeyDown={(event) => {
						if (event.key === "ArrowDown") {
							event.preventDefault();
							scrollRef.current
								?.querySelector<HTMLButtonElement>("[data-destination]")
								?.focus();
						}
					}}
				/>
			</div>
			{error ? (
				<p role="alert" className="px-4 pb-2 text-xs text-destructive">
					{errorText(error)}
				</p>
			) : null}
			<ContextMenu>
				<ContextMenuTrigger asChild>
					<fieldset
						aria-label={t("정리할 폴더")}
						ref={scrollRef}
						className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3 [overflow-anchor:none]"
						onDragOver={dragOver}
						onDragEnd={stopDrag}
						onDrop={(event) => {
							event.preventDefault();
							stopDrag();
						}}
						onDragLeave={(event) => {
							if (!event.currentTarget.contains(event.relatedTarget as Node))
								stopDrag();
						}}
						onKeyDown={(event) => {
							if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
							const buttons = Array.from(
								event.currentTarget.querySelectorAll<HTMLButtonElement>(
									"button",
								),
							).filter((button) => !button.closest("[inert]"));
							const index = buttons.indexOf(
								document.activeElement as HTMLButtonElement,
							);
							if (index < 0) return;
							event.preventDefault();
							buttons[index + (event.key === "ArrowDown" ? 1 : -1)]?.focus();
						}}
					>
						{!query.trim() && !hideInbox
							? renderRow({
									space: item?.type === "event" ? "event" : "inbox",
									label:
										item?.type === "task"
											? t("소속 없음")
											: item?.type === "event"
												? t("캘린더")
												: t("Inbox"),
									depth: 0,
									hasChildren: false,
								})
							: null}
						{!query.trim() && recentRows.length ? (
							<>
								<p className="px-3 pt-3 pb-1 text-xs font-medium text-muted-foreground">
									{t("최근 사용")}
								</p>
								{recentRows.map((target) => renderRow(target, true))}
							</>
						) : null}
						<p className="px-3 pt-3 pb-1 text-xs font-medium text-muted-foreground">
							{query.trim()
								? t("검색 결과 {0}", [searchResults.length])
								: t("전체 폴더")}
						</p>
						{query.trim()
							? searchResults.map((target) => renderBranch(target, true))
							: trees.map(({ space }) => {
									const root = byKey.get(`${space}:`);
									return root ? renderBranch(root) : null;
								})}
						{query.trim() && searchResults.length === 0 ? (
							<p className="p-4 text-center text-sm text-muted-foreground">
								{t("일치하는 폴더나 노트가 없습니다.")}
							</p>
						) : null}
					</fieldset>
				</ContextMenuTrigger>
				<ContextMenuContent>
					{selected && isFolderSpace(selected.space) ? (
						<ContextMenuItem
							disabled={busy || creating}
							onSelect={() => prepareFolder(selected)}
						>
							<FolderPlus />
							{t("새 하위 폴더")}
						</ContextMenuItem>
					) : null}
					<ContextMenuSub>
						<ContextMenuSubTrigger disabled={busy || creating}>
							<FolderPlus />
							{t("새 폴더")}
						</ContextMenuSubTrigger>
						<ContextMenuSubContent>
							{trees.map(({ space, label }) => (
								<ContextMenuItem
									key={space}
									onSelect={() => {
										const root = byKey.get(`${space}:`);
										if (root) prepareFolder(root);
									}}
								>
									{label}
								</ContextMenuItem>
							))}
						</ContextMenuSubContent>
					</ContextMenuSub>
				</ContextMenuContent>
			</ContextMenu>
			<div className="shrink-0 space-y-2 border-t px-3 py-3">
				{selected && isFolderSpace(selected.space) ? (
					<Button
						variant="ghost"
						size="sm"
						className="w-full justify-start"
						disabled={busy || creating}
						onClick={() => prepareFolder(selected)}
					>
						<FolderPlus className="size-4" />
						{t("새 폴더")}
					</Button>
				) : null}
				<p
					className="break-words text-xs leading-5 text-muted-foreground"
					title={selectionLabel}
				>
					{selectionLabel}
				</p>
				<Button
					className="w-full"
					disabled={
						!selected ||
						selectedCurrent ||
						busy ||
						creating ||
						!item ||
						Boolean(draggingId)
					}
					onClick={() => {
						if (selected) void choose(selected);
					}}
				>
					<FolderInput className="size-4" />
					{busy
						? t("옮기는 중…")
						: selectedCurrent
							? t("현재 위치입니다")
							: t("여기로 이동")}
				</Button>
			</div>
			<Dialog
				open={Boolean(newFolderParent)}
				onOpenChange={(open) => {
					if (!open && !creatingRef.current) setNewFolderParent(undefined);
				}}
			>
				<DialogContent
					onCloseAutoFocus={(event) => {
						event.preventDefault();
						const rows = Array.from(
							scrollRef.current?.querySelectorAll<HTMLButtonElement>(
								"[data-destination]",
							) ?? [],
						);
						const row = rows.find(
							(row) =>
								row.dataset.destinationKey ===
									(selected ? keyOf(selected) : "") && !row.closest("[inert]"),
						);
						row?.focus();
					}}
					onOpenAutoFocus={(event) => {
						event.preventDefault();
						folderNameRef.current?.focus();
					}}
				>
					<DialogHeader>
						<DialogTitle>
							{newFolderParent?.folder ? t("새 하위 폴더") : t("새 폴더")}
						</DialogTitle>
						<DialogDescription>
							{[newFolderParent?.parent, newFolderParent?.label]
								.filter(Boolean)
								.join(" / ")}
						</DialogDescription>
					</DialogHeader>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							void createFolder();
						}}
						className="space-y-4"
					>
						<Input
							ref={folderNameRef}
							aria-label={t("새 폴더 이름")}
							placeholder={t("새 폴더 이름")}
							maxLength={80}
							value={folderName}
							disabled={creating}
							onChange={(event) => setFolderName(event.target.value)}
						/>
						{folderError ? (
							<p role="alert" className="text-xs text-destructive">
								{folderError}
							</p>
						) : null}
						<div className="flex justify-end gap-2">
							<Button
								type="button"
								variant="outline"
								disabled={creating}
								onClick={() => setNewFolderParent(undefined)}
							>
								<X className="size-4" />
								{t("취소")}
							</Button>
							<Button type="submit" disabled={creating || !folderName.trim()}>
								<FolderPlus className="size-4" />
								{t("폴더 만들기")}
							</Button>
						</div>
					</form>
				</DialogContent>
			</Dialog>
		</div>
	);
}
