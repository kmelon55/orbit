import {
	type MouseEvent,
	type RefObject,
	useCallback,
	useLayoutEffect,
	useRef,
} from "react";
import type { TreeRow } from "#/lib/orbit/folder-tree";

const timing = { duration: 360, easing: "cubic-bezier(0.4, 0, 0.2, 1)" };
type RowSnapshot = { top: number; clone: HTMLElement };

export function useFolderTreeMotion(
	viewport: RefObject<HTMLDivElement | null>,
	rows: TreeRow[],
) {
	const snapshot = useRef<Map<string, RowSnapshot> | null>(null);
	const animations = useRef(new Set<Animation>());
	const ghosts = useRef(new Set<HTMLElement>());

	const clearMotion = useCallback(() => {
		for (const animation of animations.current) animation.cancel();
		animations.current.clear();
		for (const ghost of ghosts.current) ghost.remove();
		ghosts.current.clear();
	}, []);

	function capture(event: MouseEvent<HTMLDivElement>) {
		const trigger = (event.target as Element).closest("button[aria-expanded]");
		if (!trigger || !viewport.current) return;
		snapshot.current = null;
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
			clearMotion();
			return;
		}
		// Read the current animated positions before cancelling a previous toggle.
		const before = new Map<string, RowSnapshot>();
		for (const element of viewport.current.querySelectorAll<HTMLElement>(
			"[data-tree-key]",
		)) {
			before.set(element.dataset.treeKey ?? "", {
				top: element.getBoundingClientRect().top,
				clone: element.cloneNode(true) as HTMLElement,
			});
		}
		clearMotion();
		snapshot.current = before;
	}

	useLayoutEffect(() => {
		const before = snapshot.current;
		snapshot.current = null;
		const container = viewport.current?.firstElementChild as HTMLElement | null;
		if (!before || !container) return;
		const visibleKeys = new Set(rows.map((row) => row.key));
		const containerTop = container.getBoundingClientRect().top;
		// Batch geometry reads before starting animations; only mounted rows participate.
		const mounted = Array.from(
			container.querySelectorAll<HTMLElement>("[data-tree-key]"),
			(element) => ({
				element,
				previous: before.get(element.dataset.treeKey ?? ""),
				top: element.getBoundingClientRect().top,
			}),
		);
		function animate(element: HTMLElement, frames: Keyframe[], ghost = false) {
			const animation = element.animate(frames, timing);
			animations.current.add(animation);
			animation.onfinish = () => {
				animations.current.delete(animation);
				if (ghost) {
					element.remove();
					ghosts.current.delete(element);
				}
			};
		}
		for (const { element, previous, top } of mounted) {
			const delta = previous ? previous.top - top : 0;
			if (previous && Math.abs(delta) < 0.5) continue;
			animate(element, [
				{ transform: `translateY(${delta}px)`, opacity: previous ? 1 : 0 },
				{ transform: "translateY(0)", opacity: 1 },
			]);
		}
		for (const [key, { top, clone }] of before) {
			if (visibleKeys.has(key)) continue;
			clone.removeAttribute("data-tree-key");
			clone.removeAttribute("data-tree-index");
			clone.removeAttribute("id");
			for (const element of clone.querySelectorAll("[id]"))
				element.removeAttribute("id");
			clone.inert = true;
			clone.setAttribute("aria-hidden", "true");
			clone.style.top = `${top - containerTop}px`;
			clone.style.pointerEvents = "none";
			container.append(clone);
			ghosts.current.add(clone);
			animate(clone, [{ opacity: 1 }, { opacity: 0 }], true);
		}
	}, [rows, viewport]);

	useLayoutEffect(() => clearMotion, [clearMotion]);
	return capture;
}
