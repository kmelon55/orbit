import { type PointerEvent, useCallback, useRef } from "react";

export function useTreeDragIntent() {
	const pressedKey = useRef<string | undefined>(undefined);
	const reset = useCallback(() => {
		pressedKey.current = undefined;
	}, []);
	return {
		pointerDown(event: PointerEvent, key: string) {
			pressedKey.current =
				event.button === 0 && event.isPrimary && event.pointerType !== "touch"
					? key
					: undefined;
		},
		reset,
		canStart: (key: string) => pressedKey.current === key,
	};
}
