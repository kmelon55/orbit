import {
	type PointerEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";

const HOLD_MS = 280;
const MOVE_TOLERANCE = 6;

export function useTreeDragIntent() {
	const press = useRef<{
		key: string;
		pointerId: number;
		x: number;
		y: number;
		ready: boolean;
	} | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const [readyKey, setReadyKey] = useState<string>();
	const reset = useCallback(() => {
		clearTimeout(timer.current);
		press.current = null;
		setReadyKey(undefined);
	}, []);

	useEffect(() => {
		const cancelOnMove = (event: globalThis.PointerEvent) => {
			const current = press.current;
			if (!current || current.pointerId !== event.pointerId) return;
			if (
				!current.ready &&
				Math.hypot(event.clientX - current.x, event.clientY - current.y) >
					MOVE_TOLERANCE
			)
				reset();
		};
		const cancelOnEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") reset();
		};
		window.addEventListener("pointerup", reset);
		window.addEventListener("pointermove", cancelOnMove);
		window.addEventListener("pointercancel", reset);
		window.addEventListener("blur", reset);
		window.addEventListener("wheel", reset, { passive: true });
		window.addEventListener("keydown", cancelOnEscape);
		return () => {
			clearTimeout(timer.current);
			window.removeEventListener("pointerup", reset);
			window.removeEventListener("pointermove", cancelOnMove);
			window.removeEventListener("pointercancel", reset);
			window.removeEventListener("blur", reset);
			window.removeEventListener("wheel", reset);
			window.removeEventListener("keydown", cancelOnEscape);
		};
	}, [reset]);

	function pointerDown(event: PointerEvent, key: string) {
		reset();
		// Touch gestures keep their native scrolling behavior.
		if (event.button !== 0 || !event.isPrimary || event.pointerType === "touch")
			return;
		const next = {
			key,
			pointerId: event.pointerId,
			x: event.clientX,
			y: event.clientY,
			ready: false,
		};
		press.current = next;
		timer.current = setTimeout(() => {
			if (press.current !== next) return;
			next.ready = true;
			setReadyKey(key);
		}, HOLD_MS);
	}

	return {
		readyKey,
		pointerDown,
		reset,
		canStart: (key: string) =>
			press.current?.key === key && press.current.ready,
	};
}
