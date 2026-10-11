import { type RefObject, useLayoutEffect, useRef } from "react";

// Use layout coordinates so scrolling never looks like a reorder. Measure only
// mounted rows and retain running animations through unrelated editor renders.
export function useItemListMotion(
	list: RefObject<HTMLUListElement | null>,
	scope: string,
) {
	const previous = useRef(new Map<string, number>());
	const previousScope = useRef(scope);
	const animations = useRef(new Map<HTMLElement, Animation>());

	useLayoutEffect(() => {
		const media = window.matchMedia("(prefers-reduced-motion: reduce)");
		const clear = () => {
			for (const animation of animations.current.values()) animation.cancel();
			animations.current.clear();
		};
		const changed = () => {
			if (media.matches) clear();
		};
		media.addEventListener("change", changed);
		return () => {
			media.removeEventListener("change", changed);
			clear();
			previous.current.clear();
		};
	}, []);

	useLayoutEffect(() => {
		const container = list.current;
		const reset = previousScope.current !== scope;
		previousScope.current = scope;
		const reduced = window.matchMedia(
			"(prefers-reduced-motion: reduce)",
		).matches;
		const rows = Array.from(
			container?.querySelectorAll<HTMLElement>("[data-item-list-key]") ?? [],
			(element) => {
				const key = element.dataset.itemListKey ?? "";
				const top = element.offsetTop;
				const before = previous.current.get(key);
				const transform = getComputedStyle(element).transform;
				const offset =
					transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m42;
				return { element, key, top, before, offset };
			},
		);
		const mounted = new Set(rows.map(({ element }) => element));
		for (const [element, animation] of animations.current) {
			if (reset || reduced || !mounted.has(element)) {
				animation.cancel();
				animations.current.delete(element);
			}
		}
		for (const { element, top, before, offset } of rows) {
			if (
				reset ||
				reduced ||
				before === undefined ||
				Math.abs(before - top) < 0.5
			)
				continue;
			animations.current.get(element)?.cancel();
			const animation = element.animate(
				[
					{ transform: `translateY(${before + offset - top}px)` },
					{ transform: "translateY(0)" },
				],
				{ duration: 260, easing: "cubic-bezier(0.2, 0, 0, 1)" },
			);
			animations.current.set(element, animation);
			animation.onfinish = () => {
				if (animations.current.get(element) === animation)
					animations.current.delete(element);
			};
		}
		previous.current = new Map(rows.map(({ key, top }) => [key, top]));
	});
}
