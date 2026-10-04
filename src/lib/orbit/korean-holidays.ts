import holidays from "./korean-holidays.data";

const CACHE_KEY = "orbit:korean-holidays:v1";
const CACHE_TTL = 24 * 60 * 60 * 1000;
const DATA_URL = "https://holidays.hyunbin.page/basic.json";
type HolidayData = Readonly<Record<string, readonly string[]>>;

const DISPLAY_NAMES: Readonly<Record<string, string>> = {
	"1월 1일": "신정",
	"3ㆍ1절": "삼일절",
	"부처님 오신 날": "부처님오신날",
	기독탄신일: "성탄절",
	전국동시지방선거: "지방선거",
};

function holidayLabels(data: HolidayData): Readonly<Record<string, string>> {
	return Object.fromEntries(
		Object.entries(data).map(([day, names]) => [
			day,
			names
				.map((name) => {
					let label = name;
					for (const [original, display] of Object.entries(DISPLAY_NAMES)) {
						label = label.replaceAll(original, display);
					}
					return label;
				})
				.join(" · "),
		]),
	);
}

const bundledLabels = holidayLabels(holidays);
let labels = bundledLabels;
let initialized = false;
let checkedAt = 0;
let attemptedAt = 0;
let pending: Promise<void> | undefined;
const listeners = new Set<() => void>();

function validHolidayData(value: unknown): value is HolidayData {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const entries = Object.entries(value);
	return (
		entries.length > 0 &&
		entries.every(
			([day, names]) =>
				/^\d{4}-\d{2}-\d{2}$/.test(day) &&
				Array.isArray(names) &&
				names.length > 0 &&
				names.every(
					(name) =>
						typeof name === "string" && name.length > 0 && name.length <= 160,
				),
		)
	);
}

function parseHolidayFeed(value: unknown): HolidayData | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return;
	const data: Record<string, readonly string[]> = {};
	for (const [year, days] of Object.entries(value)) {
		if (!/^\d{4}$/.test(year) || !validHolidayData(days)) return;
		for (const [day, names] of Object.entries(days)) {
			if (!day.startsWith(`${year}-`)) return;
			data[day] = names;
		}
	}
	return Object.keys(data).length > 0 ? data : undefined;
}

function applyHolidays(data: HolidayData) {
	labels = holidayLabels(data);
	for (const listener of listeners) listener();
}

export function subscribeKoreanHolidays(listener: () => void) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function koreanHolidaySnapshot() {
	return labels;
}

export function bundledHolidaySnapshot() {
	return bundledLabels;
}

export async function refreshKoreanHolidays() {
	if (typeof window === "undefined") return;
	if (pending) return pending;
	const now = Date.now();
	if (!initialized) {
		initialized = true;
		try {
			const cached = JSON.parse(
				window.localStorage.getItem(CACHE_KEY) ?? "null",
			);
			if (
				cached &&
				validHolidayData(cached.data) &&
				typeof cached.checkedAt === "number" &&
				Number.isFinite(cached.checkedAt) &&
				cached.checkedAt > 0 &&
				cached.checkedAt <= now
			) {
				checkedAt = cached.checkedAt;
				applyHolidays(cached.data);
			}
		} catch {
			/* Keep bundled holidays when storage is unavailable or corrupt. */
		}
	}
	if (now - Math.max(checkedAt, attemptedAt) < CACHE_TTL) return;
	attemptedAt = now;
	pending = (async () => {
		try {
			const response = await fetch(DATA_URL, {
				signal: AbortSignal.timeout(10_000),
				credentials: "omit",
			});
			if (!response.ok) return;
			const data = parseHolidayFeed(await response.json());
			if (!data) return;
			checkedAt = Date.now();
			applyHolidays(data);
			try {
				window.localStorage.setItem(
					CACHE_KEY,
					JSON.stringify({ checkedAt, data }),
				);
			} catch {
				/* The current page can still use fresh data without storage. */
			}
		} catch {
			/* Offline or unavailable upstream: retain the last usable data. */
		}
	})().finally(() => {
		pending = undefined;
	});
	return pending;
}

export function koreanHolidayName(day: string): string | undefined {
	return Object.hasOwn(labels, day) ? labels[day] : undefined;
}
