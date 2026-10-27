import { useSyncExternalStore } from "react";
import { formatDayKey } from "#/lib/orbit/para";

function subscribe(onChange: () => void) {
	let timer: ReturnType<typeof setTimeout>;
	const update = () => {
		clearTimeout(timer);
		onChange();
		const now = new Date();
		const midnight = new Date(
			now.getFullYear(),
			now.getMonth(),
			now.getDate() + 1,
		);
		timer = setTimeout(update, midnight.getTime() - now.getTime());
	};
	update();
	window.addEventListener("focus", update);
	document.addEventListener("visibilitychange", update);
	return () => {
		clearTimeout(timer);
		window.removeEventListener("focus", update);
		document.removeEventListener("visibilitychange", update);
	};
}

const getDay = () => formatDayKey();
const getServerDay = () => null;

export function useLocalDay() {
	return useSyncExternalStore(subscribe, getDay, getServerDay);
}
