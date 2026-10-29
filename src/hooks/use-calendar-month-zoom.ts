import {
	type RefObject,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";

const clampZoom = (value: number) => Math.max(1, Math.min(2.5, value));

// Resize the date grid rather than the page, keeping the week under the fingers
// in place even when event lanes make some weeks taller than others.
export function useCalendarMonthZoom({
	scrollRef,
	enabled,
	onGestureStart,
}: {
	scrollRef: RefObject<HTMLDivElement | null>;
	enabled: boolean;
	onGestureStart: () => void;
}) {
	const [zoom, setZoom] = useState(1);
	const latest = useRef({ zoom, onGestureStart });
	const suppressUntil = useRef(0);
	const anchor = useRef<{
		week: HTMLElement;
		fraction: number;
		y: number;
		left: number;
	} | null>(null);
	useLayoutEffect(() => {
		latest.current = { zoom, onGestureStart };
		const element = scrollRef.current;
		const pending = anchor.current;
		if (element && pending) {
			element.scrollLeft = pending.left;
			element.scrollTop =
				pending.week.offsetTop +
				pending.week.offsetHeight * pending.fraction -
				pending.y;
			anchor.current = null;
		}
	});

	useEffect(() => {
		const element = scrollRef.current;
		if (!element || !enabled) return;
		let pinch: { distance: number; zoom: number } | null = null;
		let active = false;
		let requestedZoom = latest.current.zoom;
		const resize = (value: number, x: number, y: number) => {
			const next = clampZoom(value);
			requestedZoom = next;
			const previous = latest.current.zoom;
			if (next === previous) return;
			const rect = element.getBoundingClientRect();
			const localX = x - rect.left;
			const localY = Math.max(40, y - rect.top);
			const week = Array.from(
				element.querySelectorAll<HTMLElement>("[data-calendar-week]"),
			).find((row) => row.getBoundingClientRect().bottom > rect.top + localY);
			if (!week) return;
			anchor.current = {
				week,
				fraction:
					(element.scrollTop + localY - week.offsetTop) / week.offsetHeight,
				y: localY,
				left: ((element.scrollLeft + localX) * next) / previous - localX,
			};
			setZoom(next);
		};
		const metrics = (touches: TouchList) => ({
			distance: Math.hypot(
				touches[0].clientX - touches[1].clientX,
				touches[0].clientY - touches[1].clientY,
			),
			x: (touches[0].clientX + touches[1].clientX) / 2,
			y: (touches[0].clientY + touches[1].clientY) / 2,
		});
		const start = (event: TouchEvent) => {
			if (event.touches.length !== 2) return;
			event.preventDefault();
			active = true;
			suppressUntil.current = Number.POSITIVE_INFINITY;
			latest.current.onGestureStart();
			pinch = {
				distance: Math.max(1, metrics(event.touches).distance),
				zoom: latest.current.zoom,
			};
		};
		const move = (event: TouchEvent) => {
			if (!active) return;
			event.preventDefault();
			if (!pinch || event.touches.length !== 2) return;
			const point = metrics(event.touches);
			resize((pinch.zoom * point.distance) / pinch.distance, point.x, point.y);
		};
		const cancel = () => {
			if (!active) return;
			active = false;
			pinch = null;
			suppressUntil.current = Date.now() + 350;
		};
		const end = (event: TouchEvent) => {
			if (event.touches.length < 2) pinch = null;
			if (event.touches.length === 0) cancel();
		};
		const wheel = (event: WheelEvent) => {
			if (!event.ctrlKey && !event.metaKey) return;
			event.preventDefault();
			latest.current.onGestureStart();
			suppressUntil.current = Date.now() + 350;
			const delta =
				event.deltaY *
				(event.deltaMode === 1
					? 16
					: event.deltaMode === 2
						? element.clientHeight
						: 1);
			resize(
				requestedZoom * Math.exp(-Math.max(-300, Math.min(300, delta)) * 0.005),
				event.clientX,
				event.clientY,
			);
		};
		element.addEventListener("touchstart", start, {
			passive: false,
			capture: true,
		});
		element.addEventListener("touchmove", move, {
			passive: false,
			capture: true,
		});
		element.addEventListener("wheel", wheel, { passive: false });
		window.addEventListener("touchend", end);
		window.addEventListener("touchcancel", cancel);
		window.addEventListener("blur", cancel);
		return () => {
			cancel();
			element.removeEventListener("touchstart", start, true);
			element.removeEventListener("touchmove", move, true);
			element.removeEventListener("wheel", wheel);
			window.removeEventListener("touchend", end);
			window.removeEventListener("touchcancel", cancel);
			window.removeEventListener("blur", cancel);
		};
	}, [scrollRef, enabled]);

	return {
		zoom: enabled ? zoom : 1,
		suppressClick: () => Date.now() < suppressUntil.current,
	};
}
