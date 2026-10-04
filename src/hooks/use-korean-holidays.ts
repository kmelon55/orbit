import { useEffect, useSyncExternalStore } from "react";
import {
	bundledHolidaySnapshot,
	koreanHolidaySnapshot,
	refreshKoreanHolidays,
	subscribeKoreanHolidays,
} from "#/lib/orbit/korean-holidays";

export function useKoreanHolidays() {
	useSyncExternalStore(
		subscribeKoreanHolidays,
		koreanHolidaySnapshot,
		bundledHolidaySnapshot,
	);
	useEffect(() => {
		const refresh = () => {
			void refreshKoreanHolidays();
		};
		refresh();
		window.addEventListener("focus", refresh);
		return () => window.removeEventListener("focus", refresh);
	}, []);
}
