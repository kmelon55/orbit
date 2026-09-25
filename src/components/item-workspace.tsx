import {
	useBlocker,
	useNavigate,
	useRouter,
	useSearch,
} from "@tanstack/react-router";
import {
	Archive,
	ChevronLeft,
	FileText,
	FolderInput,
	GripVertical,
	Plus,
	Search,
} from "lucide-react";
import {
	type ReactElement,
	type ReactNode,
	startTransition,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { mutateOrbit } from "#/lib/orbit/functions";
import { moveItemLocally } from "#/lib/orbit/item-move";
import { formatDateTime, ITEM_TYPE_LABEL, isInboxItem } from "#/lib/orbit/para";
import type {
	OrbitCanvas,
	OrbitItem,
	OrbitSnapshot,
	OrbitSpace,
} from "#/lib/orbit/schema";
import { orbitItemSchema } from "#/lib/orbit/schema";
import { onItemUndone } from "#/lib/orbit/undo-events";
import {
	type EventConversion,
	EventConversionDialog,
} from "@/components/event-conversion-dialog";
import { FileItemForm } from "@/components/file-item-form";
import {
	ConfirmItemDialog,
	type ItemConfirmAction,
	ItemContextMenu,
} from "@/components/item-context-menu";
import {
	type ConvertibleType,
	ItemTypeMenu,
} from "@/components/item-type-menu";
import type {
	NoteEditorAnchor,
	NoteEditorHandle,
} from "@/components/note-editor";
import { NoteEditor } from "@/components/note-editor";
import { NoteLinkPicker } from "@/components/note-link-picker";
import { NoteMetadataEditor } from "@/components/note-metadata-editor";
import { NoteOrganizeTray } from "@/components/note-organize-tray";
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
import { useIsMobile } from "@/hooks/use-mobile";
import { useTaskToggle } from "@/hooks/use-task-toggle";
import { cn } from "@/lib/utils";

type NoteDraft = {
	title: string;
	body: string;
	tags: string;
};

export type ItemWorkspaceNavigatorContext = {
	runWithSavedItems: (
		ids: string[],
		operation: () => Promise<unknown>,
	) => Promise<void>;
	selectedId: string | null;
	items: OrbitItem[];
	openItem: (id: string) => void;
	openCreatedItem: (item: OrbitItem) => void;
	createItem: (folder?: string) => void;
	renderItem: (item: OrbitItem, child: ReactElement) => ReactNode;
};

const OPTIMISTIC_ITEM_PREFIX = "orbit-optimistic:";

function isOptimisticItemId(id: string) {
	return id.startsWith(OPTIMISTIC_ITEM_PREFIX);
}

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

function linkedCanvasPaths(body: string) {
	const paths: string[] = [];
	for (const match of body.matchAll(/#\/canvas\/([^\s)"']+)/g)) {
		try {
			paths.push(decodeURIComponent(match[1]));
		} catch {
			paths.push(match[1]);
		}
	}
	return Array.from(new Set(paths));
}

function firstLinkedCanvas(body: string, canvases: OrbitCanvas[]) {
	const linked = linkedCanvasPaths(body)
		.map((path) => canvases.find((canvas) => canvas.path === path))
		.find((canvas): canvas is OrbitCanvas => Boolean(canvas));
	if (linked) return linked;

	const legacyLabels = Array.from(
		body.matchAll(/(?:^|\n)\/?(?:Whiteboard|화이트보드)\s*·\s*([^\n]+)/gi),
		(match) => match[1]?.trim(),
	).filter((label): label is string => Boolean(label));
	return legacyLabels
		.map((label) =>
			canvases.find(
				(canvas) =>
					label === canvas.title ||
					label.startsWith(canvas.title) ||
					canvas.title.startsWith(label),
			),
		)
		.find((canvas): canvas is OrbitCanvas => Boolean(canvas));
}

function normalizeLegacyCanvasLinks(body: string, canvases: OrbitCanvas[]) {
	return body.replace(
		/^\/?(?:Whiteboard|화이트보드)\s*·\s*([^\n]+)$/gim,
		(original, rawLabel: string) => {
			const label = rawLabel.trim();
			const canvas = canvases.find(
				(entry) =>
					label === entry.title ||
					label.startsWith(entry.title) ||
					entry.title.startsWith(label),
			);
			if (!canvas) return original;
			return (
				`[Whiteboard · ${canvas.title.replace(/[[\]]/g, "")}]` +
				`(#/canvas/${encodeURIComponent(canvas.path)})`
			);
		},
	);
}

export function ItemWorkspace({
	snapshot,
	items: sourceItems,
	heading,
	description,
	create,
	initialSelectedId,
	hideInboxTarget = false,
	clearSelectionAfterMove = false,
	navigator,
	navigatorOnly = false,
	showNavigator = false,
	onShowNavigator,
	scopeKey,
	disableCreate = false,
	emptyTitle,
	emptyDescription,
}: {
	snapshot: OrbitSnapshot;
	items: OrbitItem[];
	heading: string;
	description?: string;
	create?: { space: OrbitSpace; folder?: string; type?: OrbitItem["type"] };
	initialSelectedId?: string;
	hideInboxTarget?: boolean;
	clearSelectionAfterMove?: boolean;
	navigator?:
		| ReactNode
		| ((context: ItemWorkspaceNavigatorContext) => ReactNode);
	navigatorOnly?: boolean;
	showNavigator?: boolean;
	onShowNavigator?: () => void;
	scopeKey?: string;
	disableCreate?: boolean;
	emptyTitle?: string;
	emptyDescription?: string;
}) {
	const router = useRouter();
	const { note: urlNote } = useSearch({ from: "__root__" });
	const navigate = useNavigate();
	const setNoteLocation = useCallback(
		(note?: string, replace = false) => {
			void navigate({
				to: ".",
				search: (previous) => ({ ...previous, note }),
				state: {
					orbitDetailBack:
						note && !router.state.location.search.note && !replace
							? "note"
							: undefined,
				},
				replace,
				resetScroll: false,
			});
		},
		[navigate, router],
	);
	const isMobile = useIsMobile();
	const taskToggle = useTaskToggle();
	useEffect(() => {
		taskToggle.sync(snapshot.items);
	}, [snapshot.items, taskToggle.sync]);
	useEffect(() => {
		const refreshCanvases = () => {
			void router.invalidate();
		};
		window.addEventListener("orbit:canvas-renamed", refreshCanvases);
		return () =>
			window.removeEventListener("orbit:canvas-renamed", refreshCanvases);
	}, [router]);
	const [localItems, setLocalItems] = useState<OrbitItem[]>([]);
	const [hiddenItemIds, setHiddenItemIds] = useState<ReadonlySet<string>>(
		new Set(),
	);
	const movingIdsRef = useRef(new Set<string>());
	const [movedItems, setMovedItems] = useState<Record<string, OrbitItem>>({});
	const items = useMemo(() => {
		const sourceIds = new Set(sourceItems.map((item) => item.id));
		return [
			...localItems.filter((item) => !sourceIds.has(item.id)),
			...sourceItems,
		]
			.filter((item) => !hiddenItemIds.has(item.id))
			.map((item) => movedItems[item.id] ?? item)
			.filter((item) => create?.space !== "inbox" || isInboxItem(item));
	}, [hiddenItemIds, localItems, movedItems, sourceItems, create?.space]);
	useEffect(() => {
		const sourceIds = new Set(sourceItems.map((item) => item.id));
		setLocalItems((current) => {
			const next = current.filter((item) => !sourceIds.has(item.id));
			return next.length === current.length ? current : next;
		});
	}, [sourceItems]);
	useEffect(() => {
		const sourceIds = new Set(sourceItems.map((item) => item.id));
		setHiddenItemIds((current) => {
			const next = new Set(
				[...current].filter(
					(id) =>
						isOptimisticItemId(id) ||
						movingIdsRef.current.has(id) ||
						sourceIds.has(id),
				),
			);
			return next.size === current.size ? current : next;
		});
	}, [sourceItems]);
	useEffect(() => {
		setMovedItems((current) => {
			let changed = false;
			const next = { ...current };
			for (const item of snapshot.items) {
				const moved = current[item.id];
				if (
					moved &&
					!movingIdsRef.current.has(item.id) &&
					item.space === moved.space &&
					item.folder === moved.folder
				) {
					delete next[item.id];
					changed = true;
				}
			}
			return changed ? next : current;
		});
	}, [snapshot.items]);
	const initialItem = urlNote
		? snapshot.items.find((item) => item.id === urlNote)
		: (items.find((item) => item.id === initialSelectedId) ?? items[0]);
	const [selectedId, setSelectedId] = useState<string | null>(
		initialItem?.id ?? null,
	);
	const scopeKeyRef = useRef(scopeKey);
	const scopeChanged =
		scopeKey !== undefined && scopeKeyRef.current !== scopeKey;
	const cachedSelectedRef = useRef<OrbitItem | undefined>(initialItem);
	const selectedFromList = items.find((item) => item.id === selectedId);
	const selected = scopeChanged
		? undefined
		: (selectedFromList ??
			(cachedSelectedRef.current?.id === selectedId
				? cachedSelectedRef.current
				: undefined));
	const initialStoredDraft = noteDraft(selected);
	const [draft, setDraft] = useState(() => ({
		...initialStoredDraft,
		body: normalizeLegacyCanvasLinks(
			initialStoredDraft.body,
			snapshot.canvases,
		),
	}));
	const [query, setQuery] = useState("");
	const [filing, setFiling] = useState<OrbitItem | null>(null);
	const [eventConversion, setEventConversion] = useState<OrbitItem | null>(
		null,
	);
	const convertingIds = useRef(new Set<string>());
	const [convertingId, setConvertingId] = useState<string | null>(null);
	const [organizeOpen, setOrganizeOpen] = useState(false);
	const [draggingId, setDraggingId] = useState<string | null>(null);
	const [confirm, setConfirm] = useState<ItemConfirmAction | null>(null);
	const [mobilePane, setMobilePane] = useState<"list" | "editor">(
		urlNote && initialItem ? "editor" : "list",
	);
	const lastUrlNoteRef = useRef(urlNote);
	const [linkPickerAnchor, setLinkPickerAnchor] =
		useState<NoteEditorAnchor | null>(null);
	const [savedById, setSavedById] = useState<Record<string, NoteDraft>>({});
	const [saveErrors, setSaveErrors] = useState<Record<string, boolean>>({});
	const [createError, setCreateError] = useState(false);
	const [actionError, setActionError] = useState<string>();
	const selectedKey = selectedId ?? selected?.id ?? null;
	const selectedKeyRef = useRef<string | null>(selectedKey);
	selectedKeyRef.current = selectedKey;
	const draftRef = useRef(draft);
	const localDraftsRef = useRef<Record<string, NoteDraft>>(
		selected ? { [selected.id]: draft } : {},
	);
	const lastSavedByIdRef = useRef<Record<string, NoteDraft>>(
		selected ? { [selected.id]: initialStoredDraft } : {},
	);
	const saveQueuesRef = useRef<Map<string, Promise<void>>>(new Map());
	const cancelledCreateIdsRef = useRef(new Set<string>());
	const persistRef = useRef<() => Promise<void>>(async () => {});
	const createItemRef = useRef<(folder?: string) => void>(() => {});
	const editorRef = useRef<NoteEditorHandle>(null);
	const savedByIdRef = useRef(savedById);
	const updateDraftTitle = useCallback((title: string) => {
		const id = selectedKeyRef.current;
		const next = { ...draftRef.current, title };
		draftRef.current = next;
		if (id) localDraftsRef.current[id] = next;
		startTransition(() => {
			setDraft((current) => (selectedKeyRef.current === id ? next : current));
		});
	}, []);
	const updateDraftTags = useCallback((tags: string) => {
		const id = selectedKeyRef.current;
		const next = { ...draftRef.current, tags };
		draftRef.current = next;
		if (id) localDraftsRef.current[id] = next;
		startTransition(() => {
			setDraft((current) => (selectedKeyRef.current === id ? next : current));
		});
	}, []);
	const updateDraftBody = useCallback((body: string) => {
		const id = selectedKeyRef.current;
		const next = { ...draftRef.current, body };
		draftRef.current = next;
		if (id) localDraftsRef.current[id] = next;
		startTransition(() => {
			setDraft((current) => (selectedKeyRef.current === id ? next : current));
		});
	}, []);
	const latestLocalDraft = selectedKey
		? localDraftsRef.current[selectedKey]
		: undefined;
	draftRef.current = latestLocalDraft ?? draft;
	savedByIdRef.current = savedById;
	// applyNote initializes newly selected items from their own stored content.
	// The current draft may still belong to the previously selected (or empty) item.
	if (selected) {
		cachedSelectedRef.current = {
			...selected,
			title: draft.title || selected.title,
			body: draft.body,
			tags: parseTags(draft.tags),
		};
	}

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
		if (!next.title.trim() || isOptimisticItemId(id)) return Promise.resolve();
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
	useBlocker({
		enableBeforeUnload: false,
		shouldBlockFn: async ({ current, next }) => {
			if (current.pathname === next.pathname) return false;
			await persistRef.current();
			await Promise.all(saveQueuesRef.current.values());
			const unsaved = Object.entries(localDraftsRef.current).some(
				([id, draft]) =>
					!isOptimisticItemId(id) &&
					!draftsEqual(draft, lastSavedByIdRef.current[id] ?? noteDraft()),
			);
			if (unsaved) {
				setActionError(
					"노트를 저장하지 못했습니다. 저장을 다시 시도한 뒤 이동해 주세요.",
				);
				return true;
			}
			// Refresh the cached root snapshot before another route can reopen this note.
			await router.invalidate();
			return false;
		},
	});
	useEffect(() => {
		const flush = (event: Event) => {
			const { itemId, pending } = (
				event as CustomEvent<{
					itemId: string;
					pending: Promise<unknown>[];
				}>
			).detail;
			const next = localDraftsRef.current[itemId];
			if (next) pending.push(persistSnapshot(itemId, next));
		};
		window.addEventListener("orbit:before-undo", flush);
		const unsubscribe = onItemUndone(({ itemId, item, fields }) => {
			setMovedItems((current) => {
				const next = { ...current };
				delete next[itemId];
				return next;
			});
			setHiddenItemIds((current) => {
				const next = new Set(current);
				if (item) next.delete(itemId);
				else next.add(itemId);
				return next;
			});
			setLocalItems((current) =>
				current.filter((entry) => entry.id !== itemId),
			);
			const prior = localDraftsRef.current[itemId];
			if (item) {
				const restored = noteDraft(item);
				const next = prior
					? {
							title: fields.includes("title") ? restored.title : prior.title,
							body: fields.includes("$body") ? restored.body : prior.body,
							tags: fields.includes("tags") ? restored.tags : prior.tags,
						}
					: restored;
				localDraftsRef.current[itemId] = next;
				lastSavedByIdRef.current[itemId] = restored;
				setSavedById((current) => ({ ...current, [itemId]: next }));
				if (selectedKeyRef.current === itemId) {
					cachedSelectedRef.current = item;
					draftRef.current = next;
					setDraft(next);
				}
			} else {
				delete localDraftsRef.current[itemId];
				delete lastSavedByIdRef.current[itemId];
				if (selectedKeyRef.current === itemId) {
					cachedSelectedRef.current = undefined;
					selectedKeyRef.current = null;
					draftRef.current = noteDraft();
					setDraft(noteDraft());
					setSelectedId(null);
				}
			}
		});
		return () => {
			window.removeEventListener("orbit:before-undo", flush);
			unsubscribe();
		};
	}, [persistSnapshot]);

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
			flush();
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

	const applyNote = useCallback(
		(item: OrbitItem | undefined, id: string) => {
			const storedDraft = noteDraft(item);
			const serverDraft = {
				...storedDraft,
				body: normalizeLegacyCanvasLinks(storedDraft.body, snapshot.canvases),
			};
			const baseline =
				localDraftsRef.current[id] ?? savedByIdRef.current[id] ?? serverDraft;
			localDraftsRef.current[id] = baseline;
			lastSavedByIdRef.current[id] ??= storedDraft;
			cachedSelectedRef.current = item;
			selectedKeyRef.current = id;
			draftRef.current = baseline;
			setLinkPickerAnchor(null);
			setDraft(baseline);
			setSelectedId(id);
		},
		[snapshot.canvases],
	);

	useEffect(() => {
		const locationChanged = lastUrlNoteRef.current !== urlNote;
		if (scopeKeyRef.current === scopeKey && !locationChanged) {
			if (!urlNote && !selectedId && items[0]) applyNote(items[0], items[0].id);
			return;
		}
		lastUrlNoteRef.current = urlNote;
		scopeKeyRef.current = scopeKey;
		void persistRef.current();
		const next = urlNote
			? (items.find((item) => item.id === urlNote) ??
				snapshot.items.find((item) => item.id === urlNote))
			: items[0];
		setMobilePane(urlNote && next ? "editor" : "list");
		if (next) {
			applyNote(next, next.id);
			return;
		}
		cachedSelectedRef.current = undefined;
		selectedKeyRef.current = null;
		draftRef.current = noteDraft();
		setDraft(noteDraft());
		setSelectedId(null);
	}, [applyNote, items, scopeKey, selectedId, snapshot.items, urlNote]);

	function chooseItem(id: string) {
		if (!isOptimisticItemId(id)) setNoteLocation(id);
		if (id === selectedKey) {
			setMobilePane("editor");
			return;
		}
		void persistRef.current();
		const item = items.find((entry) => entry.id === id);
		applyNote(item, id);
		setMobilePane("editor");
	}

	function openCreatedItem(item: OrbitItem) {
		setLocalItems((current) => [
			item,
			...current.filter((entry) => entry.id !== item.id),
		]);
		applyNote(item, item.id);
		setMobilePane("editor");
		if (!isOptimisticItemId(item.id)) setNoteLocation(item.id);
	}

	function openLinkedNote(id: string) {
		if (id === selectedKeyRef.current) return;
		void persistRef.current();
		const item = snapshot.items.find((entry) => entry.id === id);
		if (item) {
			applyNote(item, id);
			setMobilePane("editor");
			setNoteLocation(id);
		}
	}

	async function attachCanvas(canvas: OrbitSnapshot["canvases"][number]) {
		const href = `#/canvas/${encodeURIComponent(canvas.path)}`;
		if (!draftRef.current.body.includes(href)) {
			const inserted = editorRef.current?.insertCanvas(
				canvas.title,
				canvas.path,
			);
			const fallback =
				`${draftRef.current.body.trimEnd()}\n\n[Whiteboard · ${canvas.title.replace(/[[\]]/g, "")}](${href})`.trim();
			const next = { ...draftRef.current, body: inserted ?? fallback };
			updateDraftBody(next.body);
			const id = selectedKeyRef.current;
			if (id) await persistSnapshot(id, next);
		}
	}

	async function openOrCreateCanvas() {
		const linked = firstLinkedCanvas(draftRef.current.body, snapshot.canvases);
		if (linked) {
			if (!draftRef.current.body.includes("#/canvas/")) {
				await attachCanvas(linked);
			}
			return;
		}
		const result = await mutateOrbit({
			data: {
				action: "create-canvas",
				title: `${draftRef.current.title.trim() || "노트"} 보드`,
			},
		});
		if (!result || !("canvas" in result)) return;
		await attachCanvas(result.canvas);
		await router.invalidate();
	}

	function clearSelection() {
		setNoteLocation(undefined, true);
		cachedSelectedRef.current = undefined;
		selectedKeyRef.current = null;
		draftRef.current = noteDraft();
		setDraft(noteDraft());
		setSelectedId(null);
		setMobilePane("list");
	}

	function selectAfterRemoval(id: string) {
		if (selectedKeyRef.current !== id) return;
		const next = items.find((entry) => entry.id !== id);
		if (next) {
			applyNote(next, next.id);
			setNoteLocation(next.id, true);
			return;
		}
		clearSelection();
	}

	function createItem(folder?: string) {
		if (disableCreate) return;
		setCreateError(false);
		setActionError(undefined);
		void persistRef.current();
		const now = new Date().toISOString();
		const optimisticId = `${OPTIMISTIC_ITEM_PREFIX}${crypto.randomUUID()}`;
		const optimistic: OrbitItem = {
			id: optimisticId,
			title: "새 노트",
			type: create?.type ?? "note",
			space: create?.space ?? "inbox",
			status: create?.type === "task" ? "open" : undefined,
			folder: folder ?? create?.folder,
			tags: [],
			created: now,
			updated: now,
			body: "",
			path: "",
		};
		openCreatedItem(optimistic);

		void (async () => {
			try {
				const created = await mutateOrbit({
					data: create
						? {
								action: "create-item",
								input: {
									title: "새 노트",
									type: create.type ?? "note",
									body: "",
									space: create.space,
									folder: folder ?? create.folder,
								},
							}
						: {
								action: "capture",
								input: { title: "새 노트", type: "note", body: "" },
							},
				});
				if (created && "type" in created && "space" in created) {
					const latestDraft =
						localDraftsRef.current[optimisticId] ?? noteDraft(optimistic);
					delete localDraftsRef.current[optimisticId];
					delete lastSavedByIdRef.current[optimisticId];
					if (cancelledCreateIdsRef.current.delete(optimisticId)) {
						setLocalItems((current) =>
							current.filter((item) => item.id !== optimisticId),
						);
						setHiddenItemIds((current) => {
							const next = new Set(current);
							next.delete(optimisticId);
							return next;
						});
						try {
							await mutateOrbit({
								data: { action: "delete-item", id: created.id },
							});
						} catch {
							setActionError(
								`“${latestDraft.title || created.title}” 노트를 삭제하지 못했습니다.`,
							);
						}
						void router.invalidate();
						return;
					}
					localDraftsRef.current[created.id] = latestDraft;
					lastSavedByIdRef.current[created.id] = noteDraft(created);
					setLocalItems((current) => [
						...current.map((item) =>
							item.id === optimisticId ? created : item,
						),
					]);
					setSavedById((current) => {
						const next = { ...current, [created.id]: latestDraft };
						delete next[optimisticId];
						return next;
					});
					if (selectedKeyRef.current === optimisticId) {
						cachedSelectedRef.current = created;
						selectedKeyRef.current = created.id;
						draftRef.current = latestDraft;
						setSelectedId(created.id);
						setNoteLocation(created.id);
					}
					void persistSnapshot(created.id, latestDraft);
					void router.invalidate();
				}
			} catch {
				const wasCancelled = cancelledCreateIdsRef.current.delete(optimisticId);
				setLocalItems((current) =>
					current.filter((item) => item.id !== optimisticId),
				);
				setHiddenItemIds((current) => {
					if (!current.has(optimisticId)) return current;
					const next = new Set(current);
					next.delete(optimisticId);
					return next;
				});
				delete localDraftsRef.current[optimisticId];
				delete lastSavedByIdRef.current[optimisticId];
				selectAfterRemoval(optimisticId);
				if (!wasCancelled) setCreateError(true);
			}
		})();
	}
	createItemRef.current = createItem;

	useEffect(() => {
		const createSpace = create?.space ?? "inbox";
		const handleCreate = (event: Event) => {
			const detail = (event as CustomEvent<{ space?: string; folder?: string }>)
				.detail;
			if (detail?.space !== createSpace) return;
			createItemRef.current(detail.folder);
		};
		window.addEventListener("orbit:create-note", handleCreate);
		return () => window.removeEventListener("orbit:create-note", handleCreate);
	}, [create?.space]);

	async function archiveItem(item: OrbitItem) {
		await moveItem(item, "archive", item.folder);
	}

	async function deleteItem(item: OrbitItem) {
		setActionError(undefined);
		setHiddenItemIds((current) => new Set(current).add(item.id));
		selectAfterRemoval(item.id);
		if (isOptimisticItemId(item.id)) {
			cancelledCreateIdsRef.current.add(item.id);
			return;
		}
		try {
			await (saveQueuesRef.current.get(item.id) ?? Promise.resolve()).catch(
				() => {},
			);
			await mutateOrbit({ data: { action: "delete-item", id: item.id } });
			delete localDraftsRef.current[item.id];
			delete lastSavedByIdRef.current[item.id];
			setLocalItems((current) =>
				current.filter((entry) => entry.id !== item.id),
			);
			setSavedById((current) => {
				if (!(item.id in current)) return current;
				const next = { ...current };
				delete next[item.id];
				return next;
			});
			void router.invalidate();
		} catch {
			setHiddenItemIds((current) => {
				const next = new Set(current);
				next.delete(item.id);
				return next;
			});
			setActionError(`“${item.title}” 노트를 삭제하지 못했습니다.`);
		}
	}

	async function moveItem(item: OrbitItem, space: OrbitSpace, folder?: string) {
		if (movingIdsRef.current.has(item.id) || isOptimisticItemId(item.id))
			return;
		const moved = moveItemLocally(item, space, folder);
		const destinationSpace = moved.space;
		if (item.space === moved.space && item.folder === moved.folder) return;
		movingIdsRef.current.add(item.id);
		setActionError(undefined);
		const leavesList = item.space !== destinationSpace;
		const wasSelected = selectedKeyRef.current === item.id;
		const localDraft = localDraftsRef.current[item.id];
		// Capture and queue this item's edits before switching the editor.
		const saved = localDraft
			? persistSnapshot(item.id, localDraft)
			: (saveQueuesRef.current.get(item.id) ?? Promise.resolve());
		setMovedItems((current) => ({ ...current, [item.id]: moved }));
		if (leavesList) {
			setHiddenItemIds((current) => new Set(current).add(item.id));
			selectAfterRemoval(item.id);
			if (wasSelected && (space === "archive" || clearSelectionAfterMove))
				setMobilePane("list");
		}
		const operation = saved.then(async () => {
			if (
				localDraft &&
				!draftsEqual(
					localDraft,
					lastSavedByIdRef.current[item.id] ?? noteDraft(),
				)
			) {
				throw new Error("Save pending edits before moving");
			}
			await mutateOrbit({
				data: { action: "file-item", id: item.id, input: { space, folder } },
			});
		});
		// Later autosaves wait for the move instead of racing its file write.
		saveQueuesRef.current.set(item.id, operation);
		try {
			await operation;
			setLocalItems((current) =>
				leavesList
					? current.filter((entry) => entry.id !== item.id)
					: current.map((entry) => (entry.id === item.id ? moved : entry)),
			);
		} catch {
			setMovedItems((current) => {
				const next = { ...current };
				delete next[item.id];
				return next;
			});
			setHiddenItemIds((current) => {
				const next = new Set(current);
				next.delete(item.id);
				return next;
			});
			setActionError(
				`“${item.title}” 노트를 옮기지 못했습니다. 다시 시도해 주세요.`,
			);
			return false;
		} finally {
			movingIdsRef.current.delete(item.id);
			if (saveQueuesRef.current.get(item.id) === operation)
				saveQueuesRef.current.delete(item.id);
		}
		// Keep the local result until the snapshot actually acknowledges the move.
		await router.invalidate();
	}

	async function moveItemById(id: string, space: OrbitSpace, folder?: string) {
		const item = items.find((entry) => entry.id === id);
		setDraggingId(null);
		if (!item || (await moveItem(item, space, folder)) === false)
			throw new Error("Move failed");
	}

	async function convertItem(
		item: OrbitItem,
		kind: ConvertibleType,
		schedule?: EventConversion,
	) {
		if (item.type === kind || convertingIds.current.has(item.id)) return;
		if (kind === "event" && !schedule)
			throw new Error("일정 날짜를 선택해 주세요.");
		convertingIds.current.add(item.id);
		setConvertingId(item.id);
		try {
			await runWithSavedItems([item.id], async () => {
				const scheduleValue = item.start ?? item.due;
				const saved = orbitItemSchema.parse(
					await mutateOrbit({
						data: {
							action: "file-item",
							id: item.id,
							input: {
								type: kind,
								space:
									kind === "event"
										? "event"
										: item.space === "event"
											? "inbox"
											: item.space,
								folder:
									kind === "event" || item.space === "event"
										? undefined
										: item.folder,
								status: kind === "task" ? item.status : undefined,
								due: kind === "task" ? scheduleValue : null,
								start: kind === "event" ? schedule?.start : null,
								end: kind === "event" ? schedule?.end : null,
							},
						},
					}),
				);
				const leavesList =
					saved.space !== (create?.space ?? item.space) ||
					(create?.space === "inbox" && !isInboxItem(saved));
				if (leavesList) {
					setHiddenItemIds((current) => new Set(current).add(item.id));
					setLocalItems((current) =>
						current.filter((entry) => entry.id !== item.id),
					);
					selectAfterRemoval(item.id);
				} else {
					cachedSelectedRef.current = saved;
					applyNote(saved, saved.id);
				}
			});
			await router.invalidate();
		} finally {
			convertingIds.current.delete(item.id);
			setConvertingId((current) => (current === item.id ? null : current));
		}
	}

	function requestConversion(item: OrbitItem, kind: ConvertibleType) {
		if (kind === "event") {
			setEventConversion(
				item.id === selectedKeyRef.current
					? { ...item, title: draftRef.current.title || item.title }
					: item,
			);
			return;
		}
		void convertItem(item, kind).catch(() => {
			setActionError("종류를 바꾸지 못했습니다. 다시 시도해 주세요.");
		});
	}

	function itemMenu(item: OrbitItem) {
		return {
			item,
			snapshot,
			onCreate: disableCreate ? undefined : () => void createItem(),
			onOpen: () => void chooseItem(item.id),
			onFile: () => setFiling(item),
			onArchive: () => setConfirm({ kind: "archive", item }),
			onDelete: () => setConfirm({ kind: "delete", item }),
			onToggleTask:
				item.type === "task" ? () => void taskToggle.toggle(item) : undefined,
			onConvert: (kind: "note" | "task" | "event") =>
				requestConversion(item, kind),
			onMove: async (space: OrbitSpace, folder?: string) => {
				if ((await moveItem(item, space, folder)) === false)
					throw new Error("Move failed");
			},
		};
	}

	async function runWithSavedItems(
		ids: string[],
		action: () => Promise<unknown>,
	) {
		const drafts = ids.map((id) => ({
			id,
			draft:
				selectedKeyRef.current === id
					? draftRef.current
					: localDraftsRef.current[id],
		}));
		const saves = drafts.map(({ id, draft }) =>
			draft
				? persistSnapshot(id, draft)
				: (saveQueuesRef.current.get(id) ?? Promise.resolve()),
		);
		const operation = Promise.all(saves).then(async () => {
			for (const { id, draft } of drafts) {
				if (
					draft &&
					!draftsEqual(draft, lastSavedByIdRef.current[id] ?? noteDraft())
				)
					throw new Error("노트 저장 후 다시 이동해 주세요.");
			}
			await action();
		});
		for (const id of ids) saveQueuesRef.current.set(id, operation);
		try {
			await operation;
		} finally {
			for (const id of ids)
				if (saveQueuesRef.current.get(id) === operation)
					saveQueuesRef.current.delete(id);
		}
	}

	const renderedNavigator =
		typeof navigator === "function"
			? navigator({
					runWithSavedItems,
					selectedId: selected?.id ?? null,
					items,
					openItem: chooseItem,
					openCreatedItem,
					createItem,
					renderItem: (item, child) => (
						<ItemContextMenu {...itemMenu(item)}>{child}</ItemContextMenu>
					),
				})
			: navigator;

	const listPane = navigatorOnly ? null : (
		<ItemContextMenu
			onCreate={disableCreate ? undefined : () => void createItem()}
		>
			<div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-sidebar/30">
				<div className="flex h-14 shrink-0 items-center justify-between gap-2 px-3">
					{renderedNavigator && isMobile && !navigatorOnly ? (
						<Button
							variant="ghost"
							size="icon-sm"
							onClick={onShowNavigator}
							aria-label="폴더 목록"
						>
							<ChevronLeft />
						</Button>
					) : null}
					<div className="min-w-0 flex-1 overflow-hidden">
						<p className="truncate text-sm font-medium">{heading}</p>
						{createError || actionError ? (
							<output className="block truncate text-xs text-destructive">
								{actionError ?? "새 노트를 만들지 못했습니다."}
							</output>
						) : (
							<p className="truncate text-xs text-muted-foreground">
								{description ?? `${items.length}개`}
							</p>
						)}
					</div>
					<div className="flex shrink-0 items-center gap-1">
						{disableCreate ? null : (
							<Button
								size="icon-sm"
								onClick={() => void createItem()}
								aria-label="새 노트"
							>
								<Plus />
							</Button>
						)}
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
												color={item.color}
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
											<p className="mt-1 truncate text-[10px] text-muted-foreground/75">
												수정 {formatDateTime(item.updated)} · 작성{" "}
												{formatDateTime(item.created)}
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
	const navigationPane =
		renderedNavigator && isMobile && !navigatorOnly ? (
			<div className="h-full overflow-hidden">
				<div
					className={cn(
						"flex h-full w-[200%] transition-transform duration-300 ease-[var(--interaction-ease)]",
						showNavigator ? "translate-x-0" : "-translate-x-1/2",
					)}
				>
					<div className="h-full w-1/2 min-w-0">{renderedNavigator}</div>
					<div className="h-full w-1/2 min-w-0">{listPane}</div>
				</div>
			</div>
		) : navigatorOnly && renderedNavigator ? (
			renderedNavigator
		) : (
			listPane
		);

	const dialogs = (
		<>
			{eventConversion && (
				<EventConversionDialog
					key={eventConversion.id}
					item={eventConversion}
					onClose={() => setEventConversion(null)}
					onConvert={(schedule) =>
						convertItem(eventConversion, "event", schedule)
					}
				/>
			)}
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
			{selected ? (
				<NoteLinkPicker
					items={snapshot.items}
					currentId={selected.id}
					open={linkPickerAnchor !== null}
					anchor={linkPickerAnchor}
					onOpenChange={(open) => {
						if (!open) setLinkPickerAnchor(null);
					}}
					onSelect={(item) =>
						editorRef.current?.insertLink(
							item.title,
							`#/note/${encodeURIComponent(item.id)}`,
						)
					}
				/>
			) : null}
		</>
	);

	if (!selected) {
		const emptyPane = (
			<ItemContextMenu
				onCreate={disableCreate ? undefined : () => void createItem()}
			>
				<div className="grid h-full place-items-center p-8 text-center">
					<div>
						<div className="mx-auto mb-4 grid size-12 place-items-center rounded-xl bg-muted">
							<FileText className="size-5 text-muted-foreground" />
						</div>
						<h2 className="text-sm font-medium">
							{emptyTitle ?? "아직 항목이 없습니다"}
						</h2>
						<p className="mt-1.5 text-sm text-muted-foreground">
							{emptyDescription ??
								"우클릭하거나 아래 버튼으로 새 노트를 만드세요."}
						</p>
						{createError || actionError ? (
							<output className="mt-2 block text-sm text-destructive">
								{actionError ?? "새 노트를 만들지 못했습니다."}
							</output>
						) : null}
						{disableCreate ? null : (
							<Button className="mt-4" onClick={() => void createItem()}>
								<Plus /> 새 노트
							</Button>
						)}
					</div>
				</div>
			</ItemContextMenu>
		);
		if (isMobile) {
			return (
				<div className="relative h-full min-h-0 overflow-hidden">
					{navigationPane}
					{dialogs}
				</div>
			);
		}
		if (renderedNavigator) {
			return (
				<div className="relative h-full min-h-0 overflow-hidden">
					<ResizablePanelGroup
						id="orbit-folder-notes"
						orientation="horizontal"
						className="h-full"
					>
						<ResizablePanel
							id="orbit-folder-tree"
							defaultSize={navigatorOnly ? "32%" : "22%"}
							minSize={navigatorOnly ? "22%" : "16%"}
							maxSize={navigatorOnly ? "46%" : "32%"}
							className="min-w-0 overflow-hidden"
						>
							{renderedNavigator}
						</ResizablePanel>
						{navigatorOnly ? null : (
							<>
								<ResizableHandle withHandle />
								<ResizablePanel
									id="orbit-note-list"
									defaultSize="25%"
									minSize="18%"
									maxSize="36%"
									className="min-w-0 overflow-hidden"
								>
									{listPane}
								</ResizablePanel>
							</>
						)}
						<ResizableHandle withHandle />
						<ResizablePanel
							id="orbit-note-editor"
							defaultSize={navigatorOnly ? "68%" : "53%"}
							minSize="40%"
							className="min-w-0 overflow-hidden"
						>
							{emptyPane}
						</ResizablePanel>
					</ResizablePanelGroup>
					{dialogs}
				</div>
			);
		}
		return (
			<>
				{emptyPane}
				{dialogs}
			</>
		);
	}

	const editorPane = (
		<div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
			<ItemContextMenu {...itemMenu(selected)}>
				<header className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b border-border/50 bg-background/60 px-4 py-1.5 backdrop-blur-xl">
					{isMobile ? (
						<Button
							variant="ghost"
							size="icon-sm"
							onClick={() => {
								void persistRef.current();
								setMobilePane("list");
								if (router.state.location.state.orbitDetailBack === "note")
									router.history.back();
								else setNoteLocation(undefined, true);
							}}
							aria-label="목록으로 돌아가기"
						>
							<ChevronLeft />
						</Button>
					) : null}
					<p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
						{selected.path}
					</p>
					<ItemTypeMenu
						item={selected}
						busy={convertingId === selected.id}
						onConvert={(kind) => requestConversion(selected, kind)}
					/>
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
			<div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
				<div className="mx-auto w-full max-w-[52rem] min-w-0 px-4 pt-5 sm:pr-6 sm:pl-16 sm:pt-6">
					<NoteMetadataEditor
						key={selected.id}
						title={draft.title}
						tags={draft.tags}
						onTitleChange={updateDraftTitle}
						onTagsChange={updateDraftTags}
					/>
					<div className="mt-3 mb-5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
						<span>작성 {formatDateTime(selected.created)}</span>
						<span>수정 {formatDateTime(selected.updated)}</span>
					</div>
				</div>
				<div className="mx-auto flex w-full max-w-[52rem] min-w-0 flex-1 flex-col px-4 sm:pr-6 sm:pl-16">
					<NoteEditor
						ref={editorRef}
						noteId={selected.id}
						markdown={draft.body}
						onChange={updateDraftBody}
						onOpenNote={(id) => void openLinkedNote(id)}
						onRequestNoteLink={setLinkPickerAnchor}
						onRequestCanvas={() => void openOrCreateCanvas()}
					/>
				</div>
			</div>
		</div>
	);

	if (isMobile) {
		return (
			<div className="relative h-full min-h-0 overflow-hidden">
				{mobilePane === "editor" ? editorPane : navigationPane}
				<NoteOrganizeTray
					open={organizeOpen || draggingId !== null}
					snapshot={snapshot}
					activeItem={selected}
					draggingId={draggingId}
					hideInboxTarget={hideInboxTarget}
					onClose={() => setOrganizeOpen(false)}
					onMove={moveItemById}
				/>
				{dialogs}
			</div>
		);
	}

	if (renderedNavigator) {
		return (
			<div className="relative h-full min-h-0 overflow-hidden">
				<ResizablePanelGroup
					id="orbit-folder-notes"
					orientation="horizontal"
					className="h-full"
				>
					<ResizablePanel
						id="orbit-folder-tree"
						defaultSize={navigatorOnly ? "32%" : "22%"}
						minSize={navigatorOnly ? "22%" : "16%"}
						maxSize={navigatorOnly ? "46%" : "32%"}
						className="min-w-0 overflow-hidden"
					>
						{renderedNavigator}
					</ResizablePanel>
					{navigatorOnly ? null : (
						<>
							<ResizableHandle withHandle />
							<ResizablePanel
								id="orbit-note-list"
								defaultSize="25%"
								minSize="18%"
								maxSize="36%"
								className="min-w-0 overflow-hidden"
							>
								{listPane}
							</ResizablePanel>
						</>
					)}
					<ResizableHandle withHandle />
					<ResizablePanel
						id="orbit-note-editor"
						defaultSize={navigatorOnly ? "68%" : "53%"}
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
					hideInboxTarget={hideInboxTarget}
					onClose={() => setOrganizeOpen(false)}
					onMove={moveItemById}
				/>
				{dialogs}
			</div>
		);
	}

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
					{navigationPane}
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
				hideInboxTarget={hideInboxTarget}
				onClose={() => setOrganizeOpen(false)}
				onMove={moveItemById}
			/>
			{dialogs}
		</div>
	);
}
