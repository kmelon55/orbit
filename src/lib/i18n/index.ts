import english from "./en.json";
import korean from "./ko.json";

export type Locale = "ko" | "en";
export const LOCALE_COOKIE = "orbit-ui-locale";
export const LOCALE_STORAGE = "orbit-ui-locale";
export const intlLocale = (locale: Locale) =>
	locale === "ko" ? "ko-KR" : "en-US";

const dateFormatters = new Map<string, Intl.DateTimeFormat>();
export function dateTimeFormatter(
	locale: string,
	options: Intl.DateTimeFormatOptions,
) {
	const key = JSON.stringify([locale, options]);
	let formatter = dateFormatters.get(key);
	if (!formatter) {
		formatter = new Intl.DateTimeFormat(locale, options);
		dateFormatters.set(key, formatter);
		if (dateFormatters.size > 32)
			dateFormatters.delete(dateFormatters.keys().next().value as string);
	}
	return formatter;
}
export function resolveBrowserLocale(cookie: string, preferred = ""): Locale {
	const saved = cookie
		.split(";")
		.map((entry) => entry.trim())
		.find((entry) => entry.startsWith(`${LOCALE_COOKIE}=`))
		?.slice(LOCALE_COOKIE.length + 1);
	return resolveLocale(saved, preferred);
}
export function resolveLocale(saved?: string | null, preferred = ""): Locale {
	if (saved === "ko" || saved === "en") return saved;
	const candidates = preferred
		.split(",")
		.map((entry, order) => {
			const [tag, ...parameters] = entry.trim().split(";");
			const language = tag.toLowerCase().split("-")[0];
			const q = parameters.find((part) => part.trim().startsWith("q="));
			const quality = q ? Number(q.trim().slice(2)) : 1;
			return { language, quality, order };
		})
		.filter(
			({ language, quality }) =>
				(language === "ko" || language === "en") &&
				Number.isFinite(quality) &&
				quality > 0 &&
				quality <= 1,
		)
		.sort((a, b) => b.quality - a.quality || a.order - b.order);
	if (candidates[0]) return candidates[0].language as Locale;
	return "ko";
}
const en: Record<string, string> = english,
	ko: Record<string, string> = korean;
export function translate(
	locale: Locale,
	message: string,
	values: readonly unknown[] = [],
) {
	const translated = (locale === "en" ? en : ko)[message] ?? message;
	return translated.replace(/\{(\d+)\}/g, (placeholder, index: string) =>
		Number(index) < values.length
			? String(values[Number(index)] ?? "")
			: placeholder,
	);
}
// Apply only to application errors, never to user-authored notes or names.
export function translateError(locale: Locale, message: string) {
	const exact = translate(locale, message);
	if (exact !== message) return exact;
	for (const [source] of Object.entries(locale === "en" ? en : ko)) {
		if (!/\{\d+\}/.test(source)) continue;
		const target = (locale === "en" ? en : ko)[source];
		if (
			!/못|실패|없습|오류|주세요|않습|변경되었습니다/.test(
				`${source} ${target}`,
			)
		)
			continue;
		const indices: number[] = [];
		let pattern = "",
			offset = 0;
		const escapePattern = (text: string) =>
			text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		for (const placeholder of source.matchAll(/\{(\d+)\}/g)) {
			pattern += `${escapePattern(source.slice(offset, placeholder.index))}([\\s\\S]*?)`;
			indices.push(Number(placeholder[1]));
			offset = placeholder.index + placeholder[0].length;
		}
		pattern += escapePattern(source.slice(offset));
		const match = new RegExp(`^${pattern}$`).exec(message);
		if (match) {
			const values: string[] = [];
			indices.forEach((index, group) => {
				values[index] = match[group + 1];
			});
			return translate(locale, source, values);
		}
	}

	return message;
}

export function weekdayName(
	day: number,
	locale: string,
	style: "short" | "long" = "short",
) {
	return dateTimeFormatter(locale, {
		weekday: style,
		timeZone: "UTC",
	}).format(new Date(Date.UTC(2023, 0, 1 + day)));
}
