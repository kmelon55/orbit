export const BEFORE_LOCALE_CHANGE = "orbit:before-language-change";
export type LocaleWrites = { pending: Promise<unknown>[] };
// Editors register pending writes before a language-driven reconfiguration.
export async function flushLocaleWrites(target: EventTarget) {
	const detail: LocaleWrites = { pending: [] };
	target.dispatchEvent(
		new CustomEvent<LocaleWrites>(BEFORE_LOCALE_CHANGE, { detail }),
	);
	await Promise.all(detail.pending);
}
