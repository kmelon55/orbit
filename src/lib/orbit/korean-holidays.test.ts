import assert from "node:assert/strict";
import test from "node:test";
import {
	koreanHolidayName,
	refreshKoreanHolidays,
	subscribeKoreanHolidays,
} from "./korean-holidays";

test("includes lunar holidays and their actual substitute dates", () => {
	assert.equal(koreanHolidayName("2026-02-17"), "설날");
	assert.equal(koreanHolidayName("2026-09-25"), "추석");
	assert.equal(koreanHolidayName("2026-05-25"), "대체공휴일(부처님오신날)");
	assert.equal(koreanHolidayName("2026-10-05"), "대체공휴일(개천절)");
	assert.equal(koreanHolidayName("2026-06-08"), undefined);
	assert.equal(koreanHolidayName("2026-09-28"), undefined);
});

test("reflects the 2026 law changes and the 2027 calendar", () => {
	assert.equal(koreanHolidayName("2025-05-01"), undefined);
	assert.equal(koreanHolidayName("2025-07-17"), undefined);
	assert.equal(koreanHolidayName("2026-05-01"), "노동절");
	assert.equal(koreanHolidayName("2026-07-17"), "제헌절");
	assert.equal(koreanHolidayName("2027-05-03"), "대체공휴일(노동절)");
	assert.equal(koreanHolidayName("2027-07-19"), "대체공휴일(제헌절)");
	assert.equal(koreanHolidayName("2027-02-09"), "대체공휴일(설날)");
});

test("preserves overlapping, temporary and election holidays", () => {
	assert.equal(koreanHolidayName("2025-05-05"), "어린이날 · 부처님오신날");
	assert.equal(koreanHolidayName("2025-01-27"), "임시공휴일");
	assert.equal(koreanHolidayName("2026-06-03"), "지방선거");
});

test("uses date-only keys and leaves ordinary or unsupported dates unannotated", () => {
	assert.equal(koreanHolidayName("2026-01-01"), "신정");
	assert.equal(koreanHolidayName("2026-12-25"), "성탄절");
	for (const day of ["2026-10-02", "2028-02-01", "", "invalid", "toString"]) {
		assert.equal(koreanHolidayName(day), undefined);
	}
});

test("loads fresh cache without requests, refreshes once after expiry and keeps data on failure", async (t) => {
	const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
	const day = 24 * 60 * 60 * 1000;
	let now = Date.UTC(2026, 9, 4);
	let stored = JSON.stringify({
		checkedAt: now - 1000,
		data: { "2026-10-05": ["대체공휴일(개천절)"] },
	});
	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: {
			localStorage: {
				getItem: () => stored,
				setItem: (_key: string, value: string) => {
					stored = value;
				},
			},
		},
	});
	t.mock.method(Date, "now", () => now);
	let respond: (response: Response) => void = () => {};
	const request = t.mock.method(
		globalThis,
		"fetch",
		() =>
			new Promise<Response>((resolve) => {
				respond = resolve;
			}),
	);
	let changes = 0;
	const unsubscribe = subscribeKoreanHolidays(() => {
		changes++;
	});
	try {
		await refreshKoreanHolidays();
		assert.equal(koreanHolidayName("2026-10-05"), "대체공휴일(개천절)");
		assert.equal(request.mock.callCount(), 0);
		now += day;
		const first = refreshKoreanHolidays();
		const duplicate = refreshKoreanHolidays();
		assert.equal(request.mock.callCount(), 1);
		assert.equal(koreanHolidayName("2026-10-05"), "대체공휴일(개천절)");
		respond(Response.json({ "2028": { "2028-01-01": ["1월 1일"] } }));
		await Promise.all([first, duplicate]);
		assert.equal(koreanHolidayName("2028-01-01"), "신정");
		assert.equal(JSON.parse(stored).checkedAt, now);
		assert.equal(changes, 2);
		await refreshKoreanHolidays();
		assert.equal(request.mock.callCount(), 1);
		const lastGoodCache = stored;
		now += day;
		const failed = refreshKoreanHolidays();
		respond(new Response("unavailable", { status: 503 }));
		await failed;
		assert.equal(stored, lastGoodCache);
		assert.equal(koreanHolidayName("2028-01-01"), "신정");
		await refreshKoreanHolidays();
		assert.equal(request.mock.callCount(), 2);
		now += day;
		const invalid = refreshKoreanHolidays();
		respond(Response.json({ "2028": { "2028-01-01": "broken" } }));
		await invalid;
		assert.equal(stored, lastGoodCache);
		assert.equal(koreanHolidayName("2028-01-01"), "신정");
	} finally {
		unsubscribe();
		if (originalWindow)
			Object.defineProperty(globalThis, "window", originalWindow);
		else Reflect.deleteProperty(globalThis, "window");
	}
});
