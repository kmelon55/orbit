import {
	Check,
	ChevronRight,
	Folder,
	FolderInput,
	FolderOpen,
	Search,
} from "lucide-react";
import {
	type DragEvent,
	type ReactNode,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { folderColor } from "#/lib/orbit/folder-colors";
import { indexFolderTree } from "#/lib/orbit/folder-tree";
import { moveItemLocally } from "#/lib/orbit/item-move";
import { folderOf } from "#/lib/orbit/para";
import type { OrbitItem, OrbitSnapshot, OrbitSpace } from "#/lib/orbit/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

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
}: {
	snapshot: OrbitSnapshot;
	item?: OrbitItem;
	draggingId?: string | null;
	hideInbox?: boolean;
	onMove: MoveItem;
}) {
	const [query, setQuery] = useState("");
	const [selection, setSelection] = useState<{
		itemId: string;
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
				tree: indexFolderTree(
					[],
					snapshot.folders[root.space],
					snapshot.treeOrder?.[root.space],
				),
			})),
		[snapshot.folders, snapshot.treeOrder, item?.type],
	);
	const destinations = useMemo(
		() =>
			trees.flatMap(({ space, label, tree }) => [
				{
					space,
					label,
					depth: 0,
					hasChildren: tree.folders.length > 0,
				} as Destination,
				...tree.folders.map(
					(folder): Destination => ({
						space,
						folder: folder.slug,
						label: folder.name,
						parent: [label, folder.slug.split("/").slice(0, -1).join(" / ")]
							.filter(Boolean)
							.join(" / "),
						color: folderColor(folder.color).icon,
						depth: folder.slug.split("/").length,
						hasChildren: Boolean(tree.childFolders.get(folder.slug)?.length),
					}),
				),
			]),
		[trees],
	);
	const byKey = useMemo(
		() => new Map(destinations.map((target) => [keyOf(target), target])),
		[destinations],
	);
	const searchResults = useMemo(() => {
		const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
		return destinations.filter((target) =>
			words.every((word) =>
				`${target.parent ?? ""} ${target.label}`
					.toLocaleLowerCase()
					.includes(word),
			),
		);
	}, [destinations, query]);
	const childrenByKey = useMemo(() => {
		const children = new Map<string, Destination[]>();
		for (const { space, tree } of trees) {
			for (const [parent, entries] of tree.childrenByFolder) {
				children.set(
					`${space}:${parent}`,
					entries.flatMap((entry) => {
						const target = entry.folder
							? byKey.get(`${space}:${entry.folder.slug}`)
							: undefined;
						return target ? [target] : [];
					}),
				);
			}
		}
		return children;
	}, [byKey, trees]);
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
		if (!id || !before || busyRef.current) return;
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
			setError("옮기지 못했습니다. 다시 시도해 주세요.");
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
		if (busy || draggingId || !item) return;
		setSelection({ itemId: item.id, target });
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
		if (flat && target.hasChildren) setQuery("");
	}
	function renderRow(target: Destination, flat = false) {
		const key = keyOf(target);
		const current =
			item?.space === target.space && folderOf(item) === target.folder;
		const active = selected && keyOf(selected) === key;
		const isOpen = expanded.has(key);
		return (
			<button
				key={key}
				type="button"
				data-destination
				data-destination-key={key}
				aria-expanded={target.hasChildren ? isOpen : undefined}
				aria-pressed={Boolean(active)}
				aria-label={`${target.parent ? `${target.parent} / ` : ""}${target.label}${target.hasChildren ? (isOpen ? " 접기" : " 펼치기") : " 폴더 선택"}`}
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
					<span className="shrink-0 text-[11px] font-medium">여기에 놓기</span>
				) : current ? (
					<Check className="size-3.5 shrink-0 text-muted-foreground" />
				) : null}
			</button>
		);
	}
	function renderBranch(target: Destination): ReactNode {
		const key = keyOf(target);
		return (
			<div key={key}>
				{renderRow(target)}
				{target.hasChildren ? (
					<FolderBranch open={expanded.has(key)}>
						{(childrenByKey.get(key) ?? []).map(renderBranch)}
					</FolderBranch>
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
		: "폴더를 선택하세요";
	return (
		<div className="flex min-h-0 flex-1 flex-col" aria-busy={busy}>
			<div className="relative m-3 mb-2 shrink-0">
				<Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" />
				<Input
					aria-label="폴더 검색"
					placeholder="폴더 검색…"
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
					{error}
				</p>
			) : null}
			<fieldset
				aria-label="정리할 폴더"
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
						event.currentTarget.querySelectorAll<HTMLButtonElement>("button"),
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
									? "소속 없음"
									: item?.type === "event"
										? "캘린더"
										: "Inbox",
							depth: 0,
							hasChildren: false,
						})
					: null}
				{!query.trim() && recentRows.length ? (
					<>
						<p className="px-3 pt-3 pb-1 text-xs font-medium text-muted-foreground">
							최근 사용
						</p>
						{recentRows.map((target) => renderRow(target, true))}
					</>
				) : null}
				<p className="px-3 pt-3 pb-1 text-xs font-medium text-muted-foreground">
					{query.trim() ? `검색 결과 ${searchResults.length}` : "전체 폴더"}
				</p>
				{query.trim()
					? searchResults.map((target) => renderRow(target, true))
					: trees.map(({ space }) => {
							const root = byKey.get(`${space}:`);
							return root ? renderBranch(root) : null;
						})}
				{query.trim() && searchResults.length === 0 ? (
					<p className="p-4 text-center text-sm text-muted-foreground">
						일치하는 폴더가 없습니다.
					</p>
				) : null}
			</fieldset>
			<div className="shrink-0 space-y-2 border-t px-3 py-3">
				<p
					className="break-words text-xs leading-5 text-muted-foreground"
					title={selectionLabel}
				>
					{selectionLabel}
				</p>
				<Button
					className="w-full"
					disabled={
						!selected || selectedCurrent || busy || !item || Boolean(draggingId)
					}
					onClick={() => {
						if (selected) void choose(selected);
					}}
				>
					<FolderInput className="size-4" />
					{busy
						? "옮기는 중…"
						: selectedCurrent
							? "현재 위치입니다"
							: "여기로 이동"}
				</Button>
			</div>
		</div>
	);
}
