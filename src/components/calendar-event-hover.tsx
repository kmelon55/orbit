import {
	createContext,
	type Dispatch,
	type PointerEvent,
	type ReactNode,
	type SetStateAction,
	useCallback,
	useContext,
	useEffect,
	useId,
	useMemo,
	useState,
} from "react";

type HoveredSegment = { itemId: string; instanceId: string } | null;
const CalendarHover = createContext<{
	hovered: HoveredSegment;
	setHovered: Dispatch<SetStateAction<HoveredSegment>>;
} | null>(null);

// Keep hover updates in the event cards, without rerendering the time grid.
export function CalendarEventHoverProvider({
	children,
}: {
	children: ReactNode;
}) {
	const [hovered, setHovered] = useState<HoveredSegment>(null);
	const value = useMemo(() => ({ hovered, setHovered }), [hovered]);
	useEffect(() => {
		const clear = () => setHovered(null);
		window.addEventListener("blur", clear);
		return () => window.removeEventListener("blur", clear);
	}, []);
	return (
		<CalendarHover.Provider value={value}>{children}</CalendarHover.Provider>
	);
}

export function useCalendarEventHover(itemId: string) {
	const context = useContext(CalendarHover);
	const instanceId = useId();
	const setHovered = context?.setHovered;
	const clear = useCallback(() => {
		setHovered?.((current) =>
			current?.instanceId === instanceId && current.itemId === itemId
				? null
				: current,
		);
	}, [instanceId, itemId, setHovered]);
	// Filtering, navigation, and virtual rows can remove the hovered segment
	// without a pointerleave event. Only its owner may clear the highlight.
	useEffect(() => clear, [clear]);
	return {
		"data-calendar-item-id": itemId,
		"data-calendar-hovered": context?.hovered?.itemId === itemId || undefined,
		onPointerEnter: (event: PointerEvent<HTMLDivElement>) => {
			if (event.pointerType !== "touch") setHovered?.({ itemId, instanceId });
		},
		onPointerLeave: clear,
		onPointerCancel: clear,
		onDragStartCapture: clear,
	};
}
