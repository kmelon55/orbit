import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";
import {
	clampHourHeight,
	zoomedScrollTop,
} from "#/lib/orbit/calendar-timed-layout";

export function useCalendarTimeZoom({
	scrollRef,
	headerRef,
	hourHeight,
	onHourHeightChange,
	onGestureStart,
}: {
	scrollRef: RefObject<HTMLDivElement | null>;
	headerRef: RefObject<HTMLDivElement | null>;
	hourHeight: number;
	onHourHeightChange: (height: number) => void;
	onGestureStart: () => void;
}) {
	const latest = useRef({ hourHeight, onHourHeightChange, onGestureStart });
	useLayoutEffect(() => {
		latest.current = { hourHeight, onHourHeightChange, onGestureStart };
	});
	const pendingScrollTop = useRef<number | null>(null);
	const suppressClickUntil = useRef(0);

	useLayoutEffect(() => {
		if (pendingScrollTop.current !== null && scrollRef.current) {
			scrollRef.current.scrollTop = pendingScrollTop.current;
			pendingScrollTop.current = null;
		}
	});

	useEffect(() => {
		const element = scrollRef.current;
		if (!element) return;
		let pinch: { distance: number; height: number } | null = null;
		let pinching = false;
		let requestedHeight = latest.current.hourHeight;
		const zoom = (height: number, clientY: number) => {
			const next = clampHourHeight(height);
			const previous = latest.current.hourHeight;
			requestedHeight = next;
			if (next === previous) return;
			const headerHeight =
				headerRef.current?.getBoundingClientRect().height ?? 0;
			const offset = Math.max(
				0,
				Math.min(
					element.clientHeight,
					clientY - element.getBoundingClientRect().top,
				) - headerHeight,
			);
			pendingScrollTop.current = zoomedScrollTop(
				element.scrollTop,
				offset,
				previous,
				next,
			);
			latest.current.onHourHeightChange(next);
		};
		const wheel = (event: WheelEvent) => {
			if (!event.metaKey && !event.ctrlKey) return;
			event.preventDefault();
			latest.current.onGestureStart();
			const delta =
				event.deltaY *
				(event.deltaMode === 1
					? 16
					: event.deltaMode === 2
						? element.clientHeight
						: 1);
			zoom(
				requestedHeight *
					Math.exp(-Math.max(-300, Math.min(300, delta)) * 0.005),
				event.clientY,
			);
		};
		const metrics = (touches: TouchList) => ({
			distance: Math.hypot(
				touches[0].clientX - touches[1].clientX,
				touches[0].clientY - touches[1].clientY,
			),
			y: (touches[0].clientY + touches[1].clientY) / 2,
		});
		const start = (event: TouchEvent) => {
			if (event.touches.length < 2) return;
			event.preventDefault();
			pinching = true;
			suppressClickUntil.current = Number.POSITIVE_INFINITY;
			latest.current.onGestureStart();
			pinch = {
				distance: Math.max(1, metrics(event.touches).distance),
				height: latest.current.hourHeight,
			};
		};
		const move = (event: TouchEvent) => {
			if (!pinching) return;
			event.preventDefault();
			if (!pinch || event.touches.length < 2) return;
			const current = metrics(event.touches);
			zoom((pinch.height * current.distance) / pinch.distance, current.y);
		};
		const end = (event: TouchEvent) => {
			if (!pinching) return;
			if (event.touches.length < 2) pinch = null;
			if (event.touches.length === 0) {
				pinching = false;
				suppressClickUntil.current = Date.now() + 350;
			}
		};
		const cancel = () => {
			if (!pinching) return;
			pinch = null;
			pinching = false;
			suppressClickUntil.current = Date.now() + 350;
		};
		element.addEventListener("wheel", wheel, { passive: false });
		element.addEventListener("touchstart", start, { passive: false });
		element.addEventListener("touchmove", move, { passive: false });
		window.addEventListener("touchend", end, { passive: true });
		window.addEventListener("touchcancel", cancel, { passive: true });
		return () => {
			element.removeEventListener("wheel", wheel);
			element.removeEventListener("touchstart", start);
			element.removeEventListener("touchmove", move);
			window.removeEventListener("touchend", end);
			window.removeEventListener("touchcancel", cancel);
		};
	}, [scrollRef, headerRef]);

	return () => Date.now() < suppressClickUntil.current;
}
