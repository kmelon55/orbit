import { useRouter } from "@tanstack/react-router";
import {
	Archive,
	FileText,
	FolderInput,
	GripVertical,
	PanelRightOpen,
	Plus,
	Search,
	Tags,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { mutateOrbit } from "#/lib/orbit/functions";
import { ITEM_TYPE_LABEL } from "#/lib/orbit/para";
import type { OrbitItem, OrbitSnapshot, OrbitSpace } from "#/lib/orbit/schema";
import { FileItemForm } from "@/components/file-item-form";
import {
	ConfirmItemDialog,
	type ItemConfirmAction,
	ItemContextMenu,
} from "@/components/item-context-menu";
import { NoteEditor } from "@/components/note-editor";
import { NoteOrganizeTray } from "@/components/note-organize-tray";
import { ScheduleEditor } from "@/components/schedule-editor";
import { TaskCheck, taskTitleClass } from "@/components/task-check";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTaskToggle } from "@/hooks/use-task-toggle";
import { cn } from "@/lib/utils";

type NoteDraft = {
	title: string;
	body: string;
	tags: string;
};

function noteDraft(item?: OrbitItem): NoteDraft {
	return {
		title: item?.title ?? "",
		body: item?.body ?? "",
		tags: item?.tags.join(", ") ?? "",
	};
}

function parseTags(value: string) {
	return Array.from(
		new Set(
			value
				.split(",")
				.map((tag) => tag.trim())
				.filter(Boolean),
		),
	);
}

function draftsEqual(left: NoteDraft, right: NoteDraft) {
	return (
		left.title === right.title &&
		left.body.replace(/\r\n?/g, "\n").trim() ===
			right.body.replace(/\r\n?/g, "\n").trim() &&
		parseTags(left.tags).join("\0") === parseTags(right.tags).join("\0")
	);
}

export function ItemWorkspace({
	snapshot,
	items,
	heading,
	description,
	create,
	initialSelectedId,
	hideInboxTarget = false,
	clearSelectionAfterMove = false,
}: {
	snapshot: OrbitSnapshot;
	items: OrbitItem[];
	heading: string;
	description?: string;
	create?: { space: OrbitSpace; folder?: string; type?: OrbitItem["type"] };
	initialSelectedId?: string;
	hideInboxTarget?: boolean;
	clearSelectionAfterMove?: boolean;
}) {
	const router = useRouter();
	const taskToggle = useTaskToggle();
	useEffect(() => {
		taskToggle.sync(snapshot.items);
	}, [snapshot.items, taskToggle.sync]);
	const initialItem =
		items.find((item) => item.id === initialSelectedId) ?? items[0];
	const [selectedId, setSelectedId] = useState<string | null>(
		initialItem?.id ?? null,
	);
	const cachedSelectedRef = useRef<OrbitItem | undefined>(initialItem);
	const selectedFromList = items.find((item) => item.id === selectedId);
	const selected =
		selectedFromList ??
		(cachedSelectedRef.current?.id === selectedId
			? cachedSelectedRef.current
			: items[0]);
	const [draft, setDraft] = useState(() => noteDraft(selected));
	const [query, setQuery] = useState("");
	const [filing, setFiling] = useState<OrbitItem | null>(null);
	const [organizeOpen, setOrganizeOpen] = useState(false);
	const [draggingId, setDraggingId] = useState<string | null>(null);
	const [organizeMessage, setOrganizeMessage] = useState<string>();
	const [confirm, setConfirm] = useState<ItemConfirmAction | null>(null);
	const [scheduleEditor, setScheduleEditor] = useState<{
		open: boolean;
		kind: "task" | "event";
		item?: OrbitItem;
	}>({ open: false, kind: "task" });
	const [savedById, setSavedById] = useState<Record<string, NoteDraft>>({});
	const [saveErrors, setSaveErrors] = useState<Record<string, boolean>>({});
	const selectedKey = selectedId ?? selected?.id ?? null;
	const draftRef = useRef(draft);
	const localDraftsRef = useRef<Record<string, NoteDraft>>(
		selected ? { [selected.id]: draft } : {},
	);
	const lastSavedByIdRef = useRef<Record<string, NoteDraft>>(
		selected ? { [selected.id]: noteDraft(selected) } : {},
	);
	const saveQueuesRef = useRef<Map<string, Promise<void>>>(new Map());
	const persistRef = useRef<() => Promise<void>>(async () => {});
	const savedByIdRef = useRef(savedById);
	draftRef.current = draft;
	savedByIdRef.current = savedById;
	if (selectedKey) localDraftsRef.current[selectedKey] = draft;
	if (selected) {
		cachedSelectedRef.current = {
			...selected,
			title: draft.title || selected.title,
			body: draft.body,
			tags: parseTags(draft.tags),
		};
	}

	useEffect(() => {
		if (!selectedId && items[0]) setSelectedId(items[0].id);
	}, [items, selectedId]);

	const visibleItems = useMemo(
		() =>
			items.map((item) => {
				if (item.id === selectedKey) {
					return {
						...item,
						title: draft.title || item.title,
						body: draft.body,
						tags: parseTags(draft.tags),
					};
				}
				const overlay = savedById[item.id];
				return overlay
					? {
							...item,
							title: overlay.title || item.title,
							body: overlay.body,
							tags: parseTags(overlay.tags),
						}
					: item;
			}),
		[draft, items, savedById, selectedKey],
	);

	const filtered = useMemo(() => {
		const needle = query.trim().toLocaleLowerCase();
		if (!needle) return visibleItems;
		return visibleItems.filter((item) =>
			[item.title, item.body, item.tags.join(" "), item.folder ?? ""]
				.join("\n")
				.toLocaleLowerCase()
				.includes(needle),
		);
	}, [query, visibleItems]);

	const persistSnapshot = useCallback((id: string, next: NoteDraft) => {
		if (!next.title.trim()) return Promise.resolve();
		const previous = saveQueuesRef.current.get(id) ?? Promise.resolve();
		const queued = previous
			.catch(() => {})
			.then(async () => {
				const saved = lastSavedByIdRef.current[id];
				if (saved && draftsEqual(next, saved)) return;

				try {
					await mutateOrbit({
						data: {
							action: "update-note",
							id,
							input: {
								title: next.title,
								body: next.body,
								tags: parseTags(next.tags),
							},
						},
					});
					lastSavedByIdRef.current[id] = next;
					setSavedById((currentSaved) => ({
						...currentSaved,
						[id]: next,
					}));
					setSaveErrors((current) => {
						if (!current[id]) return current;
						const nextErrors = { ...current };
						delete nextErrors[id];
						return nextErrors;
					});
				} catch {
					setSaveErrors((current) => ({ ...current, [id]: true }));
				}
			});
		saveQueuesRef.current.set(id, queued);
		void queued.then(() => {
			if (saveQueuesRef.current.get(id) === queued) {
				saveQueuesRef.current.delete(id);
			}
		});
		return queued;
	}, []);

	persistRef.current = () => {
		const id = selectedKey;
		return id ? persistSnapshot(id, draftRef.current) : Promise.resolve();
	};

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (
				(event.metaKey || event.ctrlKey) &&
				event.key.toLocaleLowerCase() === "s"
			) {
				event.preventDefault();
				void persistRef.current();
			}
		};
		const flush = () => {
			void persistRef.current();
		};
		const onVisibility = () => {
			if (document.visibilityState === "hidden") flush();
		};
		window.addEventListener("keydown", onKeyDown);
		window.addEventListener("beforeunload", flush);
		document.addEventListener("visibilitychange", onVisibility);
		return () => {
			window.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("beforeunload", flush);
			document.removeEventListener("visibilitychange", onVisibility);
		};
	}, []);

	useEffect(() => {
		if (!selectedKey) return;
		const lastSaved = lastSavedByIdRef.current[selectedKey];
		if (lastSaved && draftsEqual(draft, lastSaved)) return;
		const id = selectedKey;
		const snapshot = draft;
		const timer = window.setTimeout(() => {
			void persistSnapshot(id, snapshot);
		}, 700);
		return () => window.clearTimeout(timer);
	}, [draft, persistSnapshot, selectedKey]);

	function applyNote(item: OrbitItem | undefined, id: string) {
		const serverDraft = noteDraft(item);
		const baseline =
			localDraftsRef.current[id] ?? savedByIdRef.current[id] ?? serverDraft;
		localDraftsRef.current[id] = baseline;
		lastSavedByIdRef.current[id] ??= serverDraft;
		setDraft(baseline);
		setSelectedId(id);
	}

	function chooseItem(id: string) {
		if (id === selectedKey) return;
		void persistRef.current();
		const item = items.find((entry) => entry.id === id);
		applyNote(item, id);
	}

	async function createItem() {
		await persistRef.current();
		const created = await mutateOrbit({
			data: create
				? {
						action: "create-item",
						input: {
							title: "새 노트",
							type: create.type ?? "note",
							body: "",
							space: create.space,
							folder: create.folder,
						},
					}
				: {
						action: "capture",
						input: { title: "새 노트", type: "note", body: "" },
					},
		});
		await router.invalidate();
		if (created && "id" in created) {
			applyNote(created, created.id);
		}
	}

	async function archiveItem(item: OrbitItem) {
		await persistRef.current();
		await mutateOrbit({ data: { action: "archive-item", id: item.id } });
		if (item.id === selectedKey) setSelectedId(null);
		await router.invalidate();
	}

	async function deleteItem(item: OrbitItem) {
		await mutateOrbit({ data: { action: "delete-item", id: item.id } });
		if (item.id === selectedKey) setSelectedId(null);
		delete localDraftsRef.current[item.id];
		delete lastSavedByIdRef.current[item.id];
		setSavedById((current) => {
			if (!(item.id in current)) return current;
			const next = { ...current };
			delete next[item.id];
			return next;
		});
		await router.invalidate();
	}

	async function moveItem(item: OrbitItem, space: OrbitSpace, folder?: string) {
		await persistRef.current();
		await mutateOrbit({
			data: {
				action: "file-item",
				id: item.id,
				input: { space, folder },
			},
		});
		if (
			item.id === selectedKey &&
			(space === "archive" || clearSelectionAfterMove)
		) {
			setSelectedId(null);
		}
		await router.invalidate();
		const destination =
			folder ??
			(
				{
					inbox: "나중에 정리",
					project: "프로젝트",
					area: "영역",
					resource: "자료",
					event: "일정",
					archive: "보관",
				} satisfies Record<OrbitSpace, string>
			)[space];
		setOrganizeMessage(`“${item.title}” → ${destination}`);
		window.setTimeout(() => setOrganizeMessage(undefined), 1800);
	}

	function moveItemById(id: string, space: OrbitSpace, folder?: string) {
		const item = snapshot.items.find((entry) => entry.id === id);
		setDraggingId(null);
		if (item) void moveItem(item, space, folder);
	}

	async function openScheduleEditor(item: OrbitItem, kind: "task" | "event") {
		await persistRef.current();
		const currentDraft = item.id === selectedKey ? draftRef.current : undefined;
		setScheduleEditor({
			open: true,
			kind,
			item: currentDraft
				? {
						...item,
						title: currentDraft.title || item.title,
						body: currentDraft.body,
						tags: parseTags(currentDraft.tags),
					}
				: item,
		});
	}

	function itemMenu(item: OrbitItem) {
		return {
			item,
			snapshot,
			onCreate: () => void createItem(),
			onOpen: () => void chooseItem(item.id),
			onFile: () => setFiling(item),
			onArchive: () => setConfirm({ kind: "archive", item }),
			onDelete: () => setConfirm({ kind: "delete", item }),
			onToggleTask:
				item.type === "task" ? () => void taskToggle.toggle(item) : undefined,
			onConvert: (kind: "task" | "event") =>
				void openScheduleEditor(item, kind),
			onMove: (space: OrbitSpace, folder?: string) =>
				void moveItem(item, space, folder),
		};
	}

	const listPane = (
		<ItemContextMenu onCreate={() => void createItem()}>
			<div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-sidebar/30">
				<div className="flex h-14 shrink-0 items-center justify-between gap-2 px-3">
					<div className="min-w-0 flex-1 overflow-hidden">
						<p className="truncate text-sm font-medium">{heading}</p>
						<p className="truncate text-xs text-muted-foreground">
							{description ?? `${items.length}개`}
						</p>
					</div>
					<div className="flex shrink-0 items-center gap-1">
						<Button
							variant={organizeOpen ? "secondary" : "ghost"}
							size="icon-sm"
							onClick={() => setOrganizeOpen((open) => !open)}
							aria-label="정리함 열기"
						>
							<PanelRightOpen />
						</Button>
						<Button
							size="icon-sm"
							onClick={() => void createItem()}
							aria-label="새 노트"
						>
							<Plus />
						</Button>
					</div>
				</div>
				<div className="px-3 pb-3">
					<div className="relative">
						<Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
						<Input
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder="검색"
							className="h-9 bg-background/80 pl-8 text-sm"
						/>
					</div>
				</div>
				<ScrollArea className="min-h-0 min-w-0 flex-1">
					<ul className="w-full min-w-0 space-y-0.5 p-2">
						{filtered.map((item) => {
							const checked =
								item.type === "task" && taskToggle.isChecked(item);
							return (
								<ItemContextMenu key={item.id} {...itemMenu(item)}>
									<li
										draggable
										onDragStart={(event) => {
											event.dataTransfer.effectAllowed = "move";
											event.dataTransfer.setData(
												"application/x-orbit-item-id",
												item.id,
											);
											event.dataTransfer.setData("text/plain", item.id);
											setDraggingId(item.id);
										}}
										onDragEnd={() => setDraggingId(null)}
										className={cn(
											"group/note flex min-w-0 items-center overflow-hidden rounded-xl transition-colors duration-200 ease-[var(--interaction-ease)]",
											item.id === selected?.id
												? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm"
												: "hover:bg-muted/70",
											draggingId === item.id && "opacity-45",
										)}
									>
										<span
											className="ml-1 flex size-5 shrink-0 items-center justify-center text-muted-foreground/45 opacity-0 transition-opacity group-hover/note:opacity-100 group-focus-within/note:opacity-100"
											aria-hidden="true"
										>
											<GripVertical className="size-3.5" />
										</span>
										{item.type === "task" ? (
											<TaskCheck
												checked={checked}
												animate={taskToggle.isAnimating(item.id)}
												disabled={taskToggle.isBusy(item.id)}
												className="ml-2"
												onClick={() => void taskToggle.toggle(item)}
												aria-label={`${item.title} 완료 전환`}
											/>
										) : null}
										<button
											type="button"
											onClick={() => void chooseItem(item.id)}
											className="min-w-0 flex-1 overflow-hidden px-2.5 py-2 text-left"
										>
											<p
												className={taskTitleClass(
													checked,
													"text-sm font-medium",
												)}
											>
												{item.title}
											</p>
											<p className="mt-0.5 truncate text-xs text-muted-foreground">
												{item.body || ITEM_TYPE_LABEL[item.type]}
											</p>
										</button>
									</li>
								</ItemContextMenu>
							);
						})}
						{filtered.length === 0 && (
							<li className="px-3 py-10 text-center text-sm text-muted-foreground">
								항목이 없습니다. 우클릭해서 노트를 추가하세요.
							</li>
						)}
					</ul>
				</ScrollArea>
			</div>
		</ItemContextMenu>
	);

	const dialogs = (
		<>
			<Dialog
				open={filing !== null}
				onOpenChange={(open) => {
					if (!open) setFiling(null);
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>세부 정리</DialogTitle>
						<DialogDescription>
							필요할 때만 종류, 일정, 폴더까지 한 번에 다듬습니다.
						</DialogDescription>
					</DialogHeader>
					{filing ? (
						<FileItemForm
							key={filing.id}
							item={
								filing.id === selected?.id
									? { ...filing, title: draft.title, body: draft.body }
									: filing
							}
							snapshot={snapshot}
							onDone={async () => {
								setFiling(null);
								await router.invalidate();
							}}
						/>
					) : null}
				</DialogContent>
			</Dialog>
			<ConfirmItemDialog
				action={confirm}
				onOpenChange={(open) => {
					if (!open) setConfirm(null);
				}}
				onConfirm={() => {
					if (!confirm) return;
					const next = confirm;
					setConfirm(null);
					void (next.kind === "delete"
						? deleteItem(next.item)
						: archiveItem(next.item));
				}}
			/>
			<ScheduleEditor
				open={scheduleEditor.open}
				onOpenChange={(open) =>
					setScheduleEditor((current) => ({ ...current, open }))
				}
				kind={scheduleEditor.kind}
				item={scheduleEditor.item}
				onSaved={(saved) => {
					const previous = scheduleEditor.item;
					if (
						previous &&
						clearSelectionAfterMove &&
						saved.space !== previous.space
					) {
						cachedSelectedRef.current = undefined;
						setSelectedId(null);
						return;
					}
					if (saved.id === selectedKey) {
						cachedSelectedRef.current = saved;
						applyNote(saved, saved.id);
					}
				}}
			/>
		</>
	);

	if (!selected) {
		return (
			<>
				<ItemContextMenu onCreate={() => void createItem()}>
					<div className="grid h-full place-items-center p-8 text-center">
						<div>
							<div className="mx-auto mb-4 grid size-12 place-items-center rounded-xl bg-muted">
								<FileText className="size-5 text-muted-foreground" />
							</div>
							<h2 className="text-sm font-medium">아직 항목이 없습니다</h2>
							<p className="mt-1.5 text-sm text-muted-foreground">
								우클릭하거나 아래 버튼으로 새 노트를 만드세요.
							</p>
							<Button className="mt-4" onClick={() => void createItem()}>
								<Plus /> 새 노트
							</Button>
						</div>
					</div>
				</ItemContextMenu>
				{dialogs}
			</>
		);
	}

	const editorPane = (
		<div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
			<ItemContextMenu {...itemMenu(selected)}>
				<header className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b border-border/50 bg-background/60 px-4 py-1.5 backdrop-blur-xl">
					<p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
						{selected.path}
					</p>
					{saveErrors[selected.id] ? (
						<output className="shrink-0 text-xs text-destructive">
							자동 저장 실패
						</output>
					) : null}
					<Button
						variant="outline"
						size="sm"
						onClick={() => setOrganizeOpen((open) => !open)}
					>
						<FolderInput /> 정리
					</Button>
					{selected.space !== "archive" ? (
						<Button
							variant="ghost"
							size="icon"
							aria-label="보관"
							onClick={() => setConfirm({ kind: "archive", item: selected })}
						>
							<Archive />
						</Button>
					) : null}
				</header>
			</ItemContextMenu>
			<div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto">
				<div className="mx-auto flex w-full max-w-3xl min-w-0 flex-1 flex-col px-6 pt-6">
					<Input
						value={draft.title}
						onChange={(event) => {
							setDraft((current) => ({
								...current,
								title: event.target.value,
							}));
						}}
						placeholder="제목 없음"
						className="h-auto rounded-none border-0 bg-transparent px-0 text-3xl font-semibold tracking-tight shadow-none focus-visible:ring-0"
					/>
					<div className="mt-2 mb-4 flex items-center gap-2">
						<Tags className="size-3.5 shrink-0 text-muted-foreground" />
						<Input
							value={draft.tags}
							onChange={(event) => {
								setDraft((current) => ({
									...current,
									tags: event.target.value,
								}));
							}}
							placeholder="태그"
							className="h-7 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
						/>
					</div>
					<NoteEditor
						noteId={selected.id}
						markdown={draft.body}
						onChange={(body) => {
							setDraft((current) => ({ ...current, body }));
						}}
					/>
				</div>
			</div>
		</div>
	);

	return (
		<div className="relative h-full min-h-0 overflow-hidden">
			<ResizablePanelGroup
				id="orbit-notes"
				orientation="horizontal"
				className="h-full"
			>
				<ResizablePanel
					id="orbit-note-list"
					defaultSize="28%"
					minSize="18%"
					maxSize="46%"
					className="min-w-0 overflow-hidden"
				>
					{listPane}
				</ResizablePanel>
				<ResizableHandle withHandle />
				<ResizablePanel
					id="orbit-note-editor"
					defaultSize="72%"
					minSize="40%"
					className="min-w-0 overflow-hidden"
				>
					{editorPane}
				</ResizablePanel>
			</ResizablePanelGroup>
			<NoteOrganizeTray
				open={organizeOpen || draggingId !== null}
				snapshot={snapshot}
				activeItem={selected}
				draggingId={draggingId}
				message={organizeMessage}
				hideInboxTarget={hideInboxTarget}
				onClose={() => setOrganizeOpen(false)}
				onMove={moveItemById}
			/>
			{dialogs}
		</div>
	);
}
