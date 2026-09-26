import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
} from "react";
import { loadOrbit, mutateOrbit } from "#/lib/orbit/functions";
import {
	type MutationLifecycle,
	OptimisticItems,
} from "#/lib/orbit/optimistic-mutations";
import { createRefreshQueue } from "#/lib/orbit/refresh-queue";
import {
	type CreateItemInput,
	type OrbitItem,
	type OrbitSnapshot,
	orbitItemSchema,
} from "#/lib/orbit/schema";
import { onItemUndone } from "#/lib/orbit/undo-events";

export type PendingCapture = {
	id: string;
	input: CreateItemInput;
	failed: boolean;
};
const SnapshotContext = createContext<OrbitSnapshot | null>(null);
const ActionsContext = createContext<{
	acknowledge: (item: OrbitItem) => void;
	refresh: () => Promise<void>;
	capture: (input: CreateItemInput) => void;
	retry: (id: string) => void;
	pending: PendingCapture[];
} | null>(null);

export function OrbitSnapshotProvider({
	snapshot,
	children,
}: {
	snapshot: OrbitSnapshot;
	children: ReactNode;
}) {
	const [source, setSource] = useState(snapshot);
	useEffect(() => setSource(snapshot), [snapshot]);
	const [refresh] = useState(() =>
		createRefreshQueue(() => loadOrbit(), setSource),
	);
	const activeSaves = useRef(new Set<string>());
	const [store] = useState(() => new OptimisticItems());
	const [revision, render] = useReducer((value: number) => value + 1, 0);
	const snapshotRef = useRef(source);
	snapshotRef.current = source;
	const [pending, setPending] = useState<PendingCapture[]>([]);
	const acknowledge = useCallback(
		(item: OrbitItem) => {
			store.acknowledge(item);
			render();
		},
		[store],
	);
	useEffect(() => {
		store.reconcile(source);
		render();
	}, [source, store]);
	useEffect(() => {
		let refreshTimer: ReturnType<typeof setTimeout> | undefined;
		const changed = (event: Event) => {
			const change = (event as CustomEvent<MutationLifecycle>).detail;
			if (change.phase === "start")
				store.start(change.requestId, change.mutation, snapshotRef.current);
			else store.finish(change);
			render();
			if (
				change.phase === "success" &&
				change.mutation.action !== "update-note" &&
				change.mutation.action !== "save-canvas"
			) {
				clearTimeout(refreshTimer);
				refreshTimer = setTimeout(() => {
					void refresh().catch(() => {});
				}, 150);
			}
		};
		const unsubscribe = onItemUndone(({ itemId, item }) => {
			store.restore(itemId, item);
			render();
		});
		window.addEventListener("orbit:write", changed);
		return () => {
			clearTimeout(refreshTimer);
			unsubscribe();
			window.removeEventListener("orbit:write", changed);
		};
	}, [store, refresh]);
	const save = useCallback(
		async (entry: PendingCapture) => {
			if (activeSaves.current.has(entry.id)) return;
			activeSaves.current.add(entry.id);
			try {
				const result = await mutateOrbit({
					data: { action: "create-item", input: entry.input },
				});
				acknowledge(orbitItemSchema.parse(result));
				setPending((current) => current.filter((item) => item.id !== entry.id));
			} catch {
				setPending((current) =>
					current.map((item) =>
						item.id === entry.id ? { ...item, failed: true } : item,
					),
				);
			} finally {
				activeSaves.current.delete(entry.id);
			}
		},
		[acknowledge],
	);
	const capture = useCallback(
		(input: CreateItemInput) => {
			const entry = { id: crypto.randomUUID(), input, failed: false };
			setPending((current) => [entry, ...current]);
			void save(entry);
		},
		[save],
	);
	const retry = useCallback(
		(id: string) => {
			const entry = pending.find((item) => item.id === id && item.failed);
			if (!entry) return;
			setPending((current) =>
				current.map((item) =>
					item.id === id ? { ...item, failed: false } : item,
				),
			);
			void save(entry);
		},
		[pending, save],
	);
	const value = useMemo(() => {
		void revision;
		return store.project(source);
	}, [source, store, revision]);
	const actions = useMemo(
		() => ({ acknowledge, capture, retry, pending, refresh }),
		[acknowledge, capture, retry, pending, refresh],
	);
	return (
		<ActionsContext.Provider value={actions}>
			<SnapshotContext.Provider value={value}>
				{children}
			</SnapshotContext.Provider>
		</ActionsContext.Provider>
	);
}

export function useOrbitSnapshot() {
	const value = useContext(SnapshotContext);
	if (!value) throw new Error("Orbit workspace is unavailable.");
	return value;
}

export function useOrbitWrites() {
	const value = useContext(ActionsContext);
	if (!value) throw new Error("Orbit workspace is unavailable.");
	return value;
}
