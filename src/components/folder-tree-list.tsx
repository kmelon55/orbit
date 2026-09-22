import {
	type DragEvent,
	type ReactNode,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
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
	const [dragKey, setDragKey] = useState<string>();
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
			: kind === "folder" && ratio > 0.25 && ratio < 0.75
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
				error instanceof Error ? error.message : "이동하지 못했습니다.",
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
	return (
		<>
			{moveError ? (
				<output className="px-3 text-xs text-destructive">{moveError}</output>
			) : null}
			{dragKey ? (
				<button
					type="button"
					className={cn(
						"mx-2 mb-1 rounded border border-dashed px-2 py-2 text-xs",
						dropTarget && !dropTarget.target && "border-primary bg-primary/10",
					)}
					onDragOver={(event) => dragOver(event)}
					onDrop={(event) => void drop(event)}
				>
					최상위로 이동
				</button>
			) : null}
			<div
				role="tree"
				aria-label="폴더와 노트"
				aria-busy={Boolean(preview)}
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
								draggable={
									!preview && !row.key.startsWith("item:orbit-optimistic:")
								}
								onDragStart={(event) => {
									event.stopPropagation();
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
									dragRef.current = undefined;
									setDragKey(undefined);
									setDropTarget(undefined);
								}}
								onDragOver={(event) => dragOver(event, row.key, row.kind)}
								onDrop={(event) => void drop(event, row.key, row.kind)}
								className={cn(
									"rounded-lg",
									dragKey === row.key && "opacity-40",
									dropTarget?.target === row.key &&
										(dropTarget.position === "inside"
											? "bg-primary/10 ring-1 ring-inset ring-primary"
											: dropTarget.position === "before"
												? "border-t-2 border-primary"
												: "border-b-2 border-primary"),
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
					</div>
				) : (
					<div className="px-3 py-10 text-center text-sm leading-6 text-muted-foreground">
						{query.trim()
							? "검색 결과가 없습니다."
							: "폴더나 노트를 만들어 시작하세요."}
					</div>
				)}
			</div>
		</>
	);
}
