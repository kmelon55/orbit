import {
	type DragEvent,
	type ReactNode,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useFolderTreeMotion } from "#/hooks/use-folder-tree-motion";
import { useTreeDragIntent } from "#/hooks/use-tree-drag-intent";
import {
	type FolderRow,
	flattenFolderTree,
	indexFolderTree,
	visibleRowRange,
} from "#/lib/orbit/folder-tree";
import type {
	MoveTreeInput,
	OrbitFolder,
	OrbitItem,
	TreeOrder,
} from "#/lib/orbit/schema";
import {
	planTreeMove,
	resolveTreeMove,
	treeMoveEntries,
} from "#/lib/orbit/tree-move";
import { cn } from "#/lib/utils";
import { useI18n } from "@/components/locale-provider";

const ROW_HEIGHT = 34;

export function FolderTreeList({
	items,
	folders,
	collapsed,
	query,
	renderFolder,
	renderNote,
	order,
	space,
	onMove,
}: {
	items: OrbitItem[];
	order?: TreeOrder;
	space: OrbitFolder["space"];
	onMove: (input: MoveTreeInput) => Promise<void>;
	folders: OrbitFolder[];
	collapsed: ReadonlySet<string>;
	query: string;
	renderFolder: (row: FolderRow) => ReactNode;
	renderNote: (item: OrbitItem, depth: number) => ReactNode;
}) {
	const { t, errorText } = useI18n();

	const [dragKey, setDragKey] = useState<string>();
	const dragIntent = useTreeDragIntent();
	const suppressClick = useRef(false);
	const dragRef = useRef<string | undefined>(undefined);
	const [dropTarget, setDropTarget] = useState<MoveTreeInput>();
	const [preview, setPreview] = useState<ReturnType<typeof planTreeMove>>();
	const [moveError, setMoveError] = useState<string>();
	const busy = useRef(false);
	const displayItems = preview?.items ?? items;
	const displayFolders = preview?.folders ?? folders;
	const displayOrder = preview?.order ?? order;
	const displayCollapsed = useMemo(() => {
		if (!preview) return collapsed;
		const next = new Set(collapsed);
		for (const folder of displayFolders) {
			if (
				preview.parent === folder.slug ||
				preview.parent.startsWith(`${folder.slug}/`)
			)
				next.delete(folder.slug);
		}
		return next;
	}, [collapsed, preview, displayFolders]);
	function targetFor(
		event: DragEvent,
		target?: string,
		kind?: "folder" | "item",
	): MoveTreeInput | undefined {
		const key = dragRef.current;
		if (!key || busy.current) return;
		const bounds = event.currentTarget.getBoundingClientRect();
		const ratio = (event.clientY - bounds.top) / bounds.height;
		const position = !target
			? "inside"
			: kind === "folder" && ratio > 0.3 && ratio < 0.7
				? "inside"
				: ratio < 0.5
					? "before"
					: "after";
		const input = { space, key, target, position } as MoveTreeInput;
		try {
			resolveTreeMove(entries, input);
			return input;
		} catch {
			return;
		}
	}
	function dragOver(
		event: DragEvent,
		target?: string,
		kind?: "folder" | "item",
	) {
		event.stopPropagation();
		const input = targetFor(event, target, kind);
		setDropTarget((current) =>
			current?.key === input?.key &&
			current?.target === input?.target &&
			current?.position === input?.position
				? current
				: input,
		);
		if (!input) return;
		event.preventDefault();
		event.dataTransfer.dropEffect = "move";
		const element = viewport.current;
		if (element) {
			const bounds = element.getBoundingClientRect();
			if (event.clientY < bounds.top + 32) element.scrollTop -= ROW_HEIGHT;
			if (event.clientY > bounds.bottom - 32) element.scrollTop += ROW_HEIGHT;
		}
	}
	async function drop(
		event: DragEvent,
		target?: string,
		kind?: "folder" | "item",
	) {
		event.preventDefault();
		event.stopPropagation();
		const input = targetFor(event, target, kind);
		setDragKey(undefined);
		dragIntent.reset();
		dragRef.current = undefined;
		setDropTarget(undefined);
		if (!input) return;
		busy.current = true;
		setMoveError(undefined);
		setPreview(planTreeMove(items, folders, order ?? {}, input));
		try {
			await onMove(input);
		} catch (error) {
			setMoveError(
				error instanceof Error ? error.message : t("이동하지 못했습니다."),
			);
		} finally {
			setPreview(undefined);
			busy.current = false;
		}
	}
	const index = useMemo(
		() => indexFolderTree(displayItems, displayFolders, displayOrder),
		[displayItems, displayFolders, displayOrder],
	);
	const entries = useMemo(() => treeMoveEntries(index), [index]);
	const rows = useMemo(
		() => flattenFolderTree(index, displayCollapsed, query),
		[index, displayCollapsed, query],
	);
	const viewport = useRef<HTMLDivElement>(null);
	const captureFolderMotion = useFolderTreeMotion(viewport, rows);
	const [view, setView] = useState({ top: 0, height: 600 });
	useLayoutEffect(() => {
		const element = viewport.current;
		if (!element) return;
		const measure = () =>
			setView({ top: element.scrollTop, height: element.clientHeight });
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	// Clamp immediately after collapse/search so a scrolled list never goes blank.
	const top = Math.min(
		view.top,
		Math.max(0, rows.length * ROW_HEIGHT - view.height),
	);
	const { start, end } = visibleRowRange(
		rows.length,
		top,
		view.height,
		ROW_HEIGHT,
	);
	const insertion = useMemo(() => {
		if (!dropTarget?.target || dropTarget.position === "inside") return;
		const targetIndex = rows.findIndex((row) => row.key === dropTarget.target);
		if (targetIndex < 0) return;
		const target = rows[targetIndex];
		let boundary = targetIndex;
		if (dropTarget.position === "after") {
			boundary += 1;
			// After an expanded folder means after its whole visible branch.
			while (boundary < rows.length && rows[boundary].depth > target.depth)
				boundary += 1;
		}
		return { top: Math.max(0, boundary * ROW_HEIGHT - 1), depth: target.depth };
	}, [dropTarget, rows]);
	return (
		<div className="relative flex min-h-0 flex-1 flex-col">
			{moveError ? (
				<output className="px-3 text-xs text-destructive">
					{errorText(moveError)}
				</output>
			) : null}
			{dragKey ? (
				<button
					type="button"
					className={cn(
						"absolute right-4 bottom-3 z-30 rounded-lg border border-dashed bg-background px-3 py-2 text-xs shadow-sm",
						dropTarget && !dropTarget.target && "border-primary bg-primary/10",
					)}
					onDragOver={(event) => dragOver(event)}
					onDrop={(event) => void drop(event)}
				>
					{t("최상위로 이동")}
				</button>
			) : null}
			<div
				role="tree"
				aria-label={t("폴더와 노트")}
				aria-busy={Boolean(preview)}
				onClickCapture={(event) => {
					if (suppressClick.current && event.detail !== 0) {
						suppressClick.current = false;
						event.preventDefault();
						event.stopPropagation();
						return;
					}
					captureFolderMotion(event);
				}}
				onDragOver={(event) => {
					if (!(event.target as HTMLElement).closest("[data-tree-index]"))
						dragOver(event);
				}}
				onDrop={(event) => void drop(event)}
				ref={viewport}
				className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 pb-4"
				onScroll={(event) =>
					setView({
						top: event.currentTarget.scrollTop,
						height: event.currentTarget.clientHeight,
					})
				}
				onKeyDown={(event) => {
					if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
						return;
					const current = (event.target as HTMLElement).closest<HTMLElement>(
						"[data-tree-index]",
					);
					if (!current || !viewport.current) return;
					event.preventDefault();
					const position = Number(current.dataset.treeIndex);
					const next =
						event.key === "Home"
							? 0
							: event.key === "End"
								? rows.length - 1
								: Math.max(
										0,
										Math.min(
											rows.length - 1,
											position + (event.key === "ArrowDown" ? 1 : -1),
										),
									);
					const element = viewport.current;
					const offset = next * ROW_HEIGHT;
					if (offset < element.scrollTop) element.scrollTop = offset;
					else if (
						offset + ROW_HEIGHT >
						element.scrollTop + element.clientHeight
					)
						element.scrollTop = offset + ROW_HEIGHT - element.clientHeight;
					setView({ top: element.scrollTop, height: element.clientHeight });
					requestAnimationFrame(() =>
						element
							.querySelector<HTMLButtonElement>(
								`[data-tree-index="${next}"] button`,
							)
							?.focus({ preventScroll: true }),
					);
				}}
			>
				{rows.length ? (
					<div
						style={{ height: rows.length * ROW_HEIGHT, position: "relative" }}
					>
						{rows.slice(start, end).map((row, offset) => (
							<div
								key={row.key}
								data-tree-index={start + offset}
								data-tree-key={row.key}
								data-drag-ready={dragIntent.readyKey === row.key || undefined}
								draggable={
									!preview && !row.key.startsWith("item:orbit-optimistic:")
								}
								onPointerDown={(event) => {
									suppressClick.current = false;
									if (!preview && !row.key.startsWith("item:orbit-optimistic:"))
										dragIntent.pointerDown(event, row.key);
								}}
								onDragStart={(event) => {
									event.stopPropagation();
									if (!dragIntent.canStart(row.key)) {
										event.preventDefault();
										dragIntent.reset();
										return;
									}
									suppressClick.current = true;
									dragRef.current = row.key;
									setDragKey(row.key);
									setMoveError(undefined);
									event.dataTransfer.effectAllowed = "move";
									event.dataTransfer.setData(
										"application/x-orbit-tree-entry",
										row.key,
									);
									event.dataTransfer.setData("text/plain", row.key);
								}}
								onDragEnd={() => {
									dragIntent.reset();
									dragRef.current = undefined;
									setDragKey(undefined);
									setDropTarget(undefined);
								}}
								onDragOver={(event) => dragOver(event, row.key, row.kind)}
								onDrop={(event) => void drop(event, row.key, row.kind)}
								className={cn(
									"rounded-lg",
									dragIntent.readyKey === row.key &&
										"bg-muted/70 [&_*]:cursor-grab",
									dragKey === row.key && "opacity-40",
									dropTarget?.target === row.key &&
										dropTarget.position === "inside" &&
										"bg-blue-500/10 ring-1 ring-inset ring-blue-500",
								)}
								role="treeitem"
								tabIndex={-1}
								aria-level={row.depth + 1}
								aria-expanded={
									row.kind === "folder" && row.hasChildren
										? row.expanded
										: undefined
								}
								style={{
									position: "absolute",
									top: (start + offset) * ROW_HEIGHT,
									height: ROW_HEIGHT,
									left: 0,
									right: 0,
								}}
							>
								{row.kind === "folder"
									? renderFolder(row)
									: renderNote(row.item, row.depth)}
							</div>
						))}
						{insertion ? (
							<div
								aria-hidden="true"
								data-tree-insertion-line
								className="pointer-events-none absolute right-2 z-20 h-0.5 rounded-full bg-blue-500"
								style={{ top: insertion.top, left: 8 + insertion.depth * 16 }}
							>
								<span className="absolute -top-0.5 -left-0.5 size-1.5 rounded-full bg-blue-500" />
							</div>
						) : null}
					</div>
				) : (
					<div className="px-3 py-10 text-center text-sm leading-6 text-muted-foreground">
						{query.trim()
							? t("검색 결과가 없습니다.")
							: t("폴더와 노트가 없습니다.")}
					</div>
				)}
			</div>
		</div>
	);
}
