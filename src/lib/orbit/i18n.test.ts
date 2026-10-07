import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";
import {
	dateTimeFormatter,
	intlLocale,
	resolveBrowserLocale,
	resolveLocale,
	translate,
	translateError,
	weekdayName,
} from "../i18n";
import english from "../i18n/en.json";
import korean from "../i18n/ko.json";
import { FOLDER_COLORS } from "./folder-colors";
import { ITEM_TYPE_LABEL } from "./para";
import {
	ROUTINE_MOMENTS,
	type RoutineInput,
	routineScheduleLabel,
} from "./routines";

test("saved locale wins and browser preference respects supported languages and quality", () => {
	assert.equal(resolveLocale("ko", "en-US"), "ko");
	assert.equal(resolveLocale("en", "ko-KR"), "en");
	assert.equal(resolveLocale("invalid", "ja,en-US;q=0.8,ko;q=0.9"), "ko");
	assert.equal(resolveLocale(null, "KO-kr;q=0,en-GB;q=0.5"), "en");
	assert.equal(resolveLocale(null, "fr,ko;q=bad,en;q=2"), "ko");
	assert.equal(resolveLocale(), "ko");
});

test("navigation reads the current locale locally without sharing another session's preference", () => {
	assert.equal(
		resolveBrowserLocale("other=1; orbit-ui-locale=en", "ko-KR"),
		"en",
	);
	assert.equal(
		resolveBrowserLocale("orbit-ui-locale=ko; other=en", "en-US"),
		"ko",
	);
	assert.equal(resolveBrowserLocale("other-orbit-ui-locale=en", "ko-KR"), "ko");
	assert.equal(
		resolveBrowserLocale("orbit-ui-locale=invalid", "en-US,ko"),
		"en",
	);
	assert.equal(resolveBrowserLocale("", "en-US"), "en");
	assert.equal(resolveBrowserLocale("orbit-ui-locale=en"), "en");
	assert.equal(resolveBrowserLocale("orbit-ui-locale=ko"), "ko");
});

test("cached date formatters preserve locale, timezone and formatting options", () => {
	const options = { weekday: "short", timeZone: "UTC" } as const;
	const date = new Date("2026-10-07T00:00:00Z");
	const korean = dateTimeFormatter("ko-KR", options);
	assert.equal(dateTimeFormatter("ko-KR", { ...options }), korean);
	assert.equal(
		korean.format(date),
		new Intl.DateTimeFormat("ko-KR", options).format(date),
	);
	assert.equal(dateTimeFormatter("en-US", options).format(date), "Wed");
	assert.notEqual(
		dateTimeFormatter("ko-KR", { ...options, weekday: "long" }),
		korean,
	);
	assert.notEqual(
		dateTimeFormatter("ko-KR", { ...options, timeZone: "Asia/Seoul" }),
		korean,
	);
});

test("interpolation preserves user values and concurrent requests cannot share a language", async () => {
	const source = "{0} 메뉴";
	const name = "Projects 한글 {1}";
	const [ko, en] = await Promise.all([
		Promise.resolve(translate("ko", source, [name])),
		Promise.resolve(translate("en", source, [name])),
	]);
	assert.equal(ko, `${name} 메뉴`);
	assert.equal(en, `${name} menu`);
	assert.equal(translate("en", "unknown"), "unknown");
	assert.equal(translate("en", "{0} 완료", [0]), "Complete 0");
});

test("catalogs preserve every interpolation argument", () => {
	const placeholders = (text: string) =>
		[...new Set(text.match(/\{\d+\}/g) ?? [])].sort();
	for (const catalog of [english, korean])
		for (const [source, target] of Object.entries(catalog)) {
			assert.deepEqual(placeholders(target), placeholders(source), source);
		}
});

test("all explicit Korean UI messages and shared labels have an English translation", () => {
	const catalog: Record<string, string> = english;
	function walk(directory: string) {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const file = join(directory, entry.name);
			if (entry.isDirectory()) walk(file);
			else if (file.endsWith(".tsx")) {
				const source = readFileSync(file, "utf8"),
					ast = ts.createSourceFile(
						file,
						source,
						ts.ScriptTarget.Latest,
						true,
						ts.ScriptKind.TSX,
					);
				const visit = (node: ts.Node) => {
					if (
						ts.isCallExpression(node) &&
						node.expression.getText(ast) === "t" &&
						node.arguments[0] &&
						ts.isStringLiteral(node.arguments[0]) &&
						/[가-힣]/.test(node.arguments[0].text)
					)
						assert.ok(
							catalog[node.arguments[0].text],
							`${file}: ${node.arguments[0].text}`,
						);
					ts.forEachChild(node, visit);
				};
				visit(ast);
			}
		}
	}
	walk("src/components");
	walk("src/routes");
	for (const label of [
		...Object.values(ITEM_TYPE_LABEL),
		...Object.values(ROUTINE_MOMENTS),
		...FOLDER_COLORS.map((color) => color.label),
	])
		assert.ok(catalog[label], label);
});

test("application errors switch in both directions and retain names", () => {
	assert.equal(
		translateError("en", "루틴을 찾을 수 없습니다."),
		"Routine not found.",
	);
	const source = "“{0}”의 날짜를 {1}로 바꾸지 못했습니다.";
	const ko = translate("ko", source, ["한글 Projects", "내일"]),
		en = translate("en", source, ["한글 Projects", "내일"]);
	assert.notEqual(ko, en);
	assert.equal(translateError("en", ko), en);
	assert.equal(translateError("ko", en), ko);
	assert.equal(
		translateError("en", "Provider error 123"),
		"Provider error 123",
	);
});

test("weekday and routine labels follow the selected locale without changing records", () => {
	assert.equal(weekdayName(0, intlLocale("ko")), "일");
	assert.equal(weekdayName(0, intlLocale("en")), "Sun");
	const routine = {
		weekdays: [1, 2, 3, 4, 5],
		moment: "morning",
		time: null,
	} as RoutineInput;
	assert.equal(routineScheduleLabel(routine, "ko"), "평일 · 아침");
	assert.equal(routineScheduleLabel(routine, "en"), "Weekdays · Morning");
	routine.weekdays = [0, 6];
	assert.equal(routineScheduleLabel(routine, "en"), "Sat·Sun · Morning");
});

test("language changes wait for editor writes and fail before reconfiguration when a write fails", async () => {
	const { BEFORE_LOCALE_CHANGE, flushLocaleWrites } = await import(
		"../i18n/locale-events"
	);
	const target = new EventTarget();
	let resolveWrite: () => void = () => {};
	const write = new Promise<void>((resolve) => {
		resolveWrite = resolve;
	});
	const listener = (event: Event) => {
		(event as CustomEvent<{ pending: Promise<unknown>[] }>).detail.pending.push(
			write,
		);
	};
	target.addEventListener(BEFORE_LOCALE_CHANGE, listener);
	let changed = false;
	const change = flushLocaleWrites(target).then(() => {
		changed = true;
	});
	await Promise.resolve();
	assert.equal(changed, false);
	resolveWrite();
	await change;
	assert.equal(changed, true);
	target.removeEventListener(BEFORE_LOCALE_CHANGE, listener);
	target.addEventListener(BEFORE_LOCALE_CHANGE, (event) => {
		(event as CustomEvent<{ pending: Promise<unknown>[] }>).detail.pending.push(
			Promise.reject(new Error("write failed")),
		);
	});
	await assert.rejects(flushLocaleWrites(target), /write failed/);
});

test("built-in category labels translate while renamed categories retain their names", async () => {
	const { scheduleCategoryLabel } = await import("./schedule-categories");
	assert.equal(
		scheduleCategoryLabel({ id: "business", name: "비즈니스" }, "en"),
		"Business",
	);
	assert.equal(
		scheduleCategoryLabel({ id: "business", name: "회사 업무" }, "en"),
		"회사 업무",
	);
	assert.equal(
		scheduleCategoryLabel({ id: "custom", name: "개인" }, "en"),
		"개인",
	);
});
