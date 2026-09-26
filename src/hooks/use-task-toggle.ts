import { useCallback, useEffect, useRef, useState } from "react";
import { mutateOrbit } from "#/lib/orbit/functions";
import { isPendingItemId } from "#/lib/orbit/optimistic-mutations";
import type { OrbitItem } from "#/lib/orbit/schema";
import { onItemUndone } from "#/lib/orbit/undo-events";

const COMPLETE_HOLD_MS = 120;
const EXIT_MS = 140;

function prefersReducedMotion() {
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function wait(ms: number) {
	if (ms <= 0 || prefersReducedMotion()) return Promise.resolve();
	return new Promise<void>((resolve) => {
		window.setTimeout(resolve, ms);
	});
}

function without(ids: ReadonlySet<string>, id: string) {
	if (!ids.has(id)) return ids;
	const next = new Set(ids);
	next.delete(id);
	return next;
}

function prune(
	ids: ReadonlySet<string>,
	items: Map<string, OrbitItem>,
	keep: (item: OrbitItem | undefined) => boolean,
) {
	let next: Set<string> | null = null;
	for (const id of ids) {
		if (keep(items.get(id))) continue;
		if (!next) next = new Set(ids);
		next.delete(id);
	}
	return next ?? ids;
}

export function useTaskToggle() {
	const busyRef = useRef(new Set<string>());
	const versions = useRef(new Map<string, number>());
	const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
	const [completing, setCompleting] = useState<ReadonlySet<string>>(new Set());
	const [leavingOpen, setLeavingOpen] = useState<ReadonlySet<string>>(
		new Set(),
	);
	const [leavingDone, setLeavingDone] = useState<ReadonlySet<string>>(
		new Set(),
	);
	const [hiddenOpen, setHiddenOpen] = useState<ReadonlySet<string>>(new Set());
	const [hiddenDone, setHiddenDone] = useState<ReadonlySet<string>>(new Set());
	useEffect(
		() =>
			onItemUndone(({ itemId }) => {
				versions.current.set(itemId, (versions.current.get(itemId) ?? 0) + 1);
				setCompleting((current) => without(current, itemId));
				setLeavingOpen((current) => without(current, itemId));
				setLeavingDone((current) => without(current, itemId));
				setHiddenOpen((current) => without(current, itemId));
				setHiddenDone((current) => without(current, itemId));
			}),
		[],
	);

	const sync = useCallback((items: OrbitItem[]) => {
		const byId = new Map(items.map((item) => [item.id, item]));
		setCompleting((current) =>
			prune(current, byId, (item) =>
				Boolean(
					item && (busyRef.current.has(item.id) || item.status !== "done"),
				),
			),
		);
		setLeavingOpen((current) =>
			prune(current, byId, (item) =>
				Boolean(
					item && (busyRef.current.has(item.id) || item.status !== "done"),
				),
			),
		);
		setHiddenOpen((current) =>
			prune(current, byId, (item) =>
				Boolean(
					item && (busyRef.current.has(item.id) || item.status !== "done"),
				),
			),
		);
		setLeavingDone((current) =>
			prune(current, byId, (item) =>
				Boolean(
					item && (busyRef.current.has(item.id) || item.status === "done"),
				),
			),
		);
		setHiddenDone((current) =>
			prune(current, byId, (item) =>
				Boolean(
					item && (busyRef.current.has(item.id) || item.status === "done"),
				),
			),
		);
	}, []);

	const toggle = useCallback(
		async (item: OrbitItem, options?: { exit?: boolean }) => {
			if (busyRef.current.has(item.id) || isPendingItemId(item.id)) return;
			busyRef.current.add(item.id);
			const version = versions.current.get(item.id) ?? 0;
			const undone = () =>
				versions.current.get(item.id) !== version &&
				versions.current.has(item.id);
			setBusy(new Set(busyRef.current));
			const toDone = item.status !== "done";
			const shouldExit = Boolean(options?.exit);
			if (toDone) {
				setCompleting((current) => new Set(current).add(item.id));
			}

			let cancelled = false;
			try {
				await Promise.all([
					mutateOrbit({ data: { action: "toggle-task", id: item.id } }),
					(async () => {
						if (!shouldExit) return;
						await wait(COMPLETE_HOLD_MS);
						if (cancelled || undone()) return;
						if (toDone)
							setLeavingOpen((current) => new Set(current).add(item.id));
						else setLeavingDone((current) => new Set(current).add(item.id));
						await wait(EXIT_MS);
						if (cancelled || undone()) return;
						if (toDone)
							setHiddenOpen((current) => new Set(current).add(item.id));
						else setHiddenDone((current) => new Set(current).add(item.id));
					})(),
				]);
			} catch {
				cancelled = true;
				setCompleting((current) => without(current, item.id));
				setLeavingOpen((current) => without(current, item.id));
				setLeavingDone((current) => without(current, item.id));
				setHiddenOpen((current) => without(current, item.id));
				setHiddenDone((current) => without(current, item.id));
			} finally {
				setCompleting((current) => without(current, item.id));
				setLeavingOpen((current) => without(current, item.id));
				setLeavingDone((current) => without(current, item.id));
				setHiddenOpen((current) => without(current, item.id));
				setHiddenDone((current) => without(current, item.id));
				busyRef.current.delete(item.id);
				setBusy((current) => without(current, item.id));
			}
		},
		[],
	);

	return {
		toggle,
		sync,
		isBusy: (id: string) => busy.has(id),
		isChecked: (item: OrbitItem) =>
			item.status === "done" || completing.has(item.id),
		isAnimating: (id: string) => completing.has(id),
		isExiting: (id: string) => leavingOpen.has(id) || leavingDone.has(id),
		keepInOpenList: (item: OrbitItem) => {
			if (hiddenOpen.has(item.id) || hiddenDone.has(item.id)) return false;
			if (leavingOpen.has(item.id) || completing.has(item.id)) return true;
			if (leavingDone.has(item.id)) return false;
			return item.status !== "done" && item.status !== "cancelled";
		},
		keepInDoneList: (item: OrbitItem) => {
			if (hiddenDone.has(item.id) || hiddenOpen.has(item.id)) return false;
			if (leavingDone.has(item.id)) return true;
			if (completing.has(item.id) || leavingOpen.has(item.id)) return false;
			return item.status === "done";
		},
	};
}
