import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	intlLocale,
	LOCALE_STORAGE,
	type Locale,
	translate,
	translateError,
} from "#/lib/i18n";
import { saveUiLocale } from "#/lib/i18n/functions";
import { flushLocaleWrites } from "#/lib/i18n/locale-events";

export type LocaleContextValue = {
	locale: Locale;
	changingLocale: boolean;
	intlLocale: string;
	setLocale: (locale: Locale) => Promise<void>;
	t: (message: string, values?: readonly unknown[]) => string;
	errorText: (message: string) => string;
};
const LocaleContext = createContext<LocaleContextValue | null>(null);
export function LocaleProvider({
	children,
	initialLocale,
}: {
	children: ReactNode;
	initialLocale: Locale;
}) {
	const [locale, setCurrent] = useState(initialLocale);
	const [changingLocale, setChangingLocale] = useState(false);
	const saveQueue = useRef<Promise<void>>(Promise.resolve());
	const setLocale = useCallback((next: Locale) => {
		setChangingLocale(true);
		const pending = saveQueue.current
			.catch(() => {})
			.then(async () => {
				await flushLocaleWrites(window);
				await saveUiLocale({ data: next });
				setCurrent(next);
				try {
					localStorage.setItem(LOCALE_STORAGE, next);
				} catch {
					/* Cookie is the durable source. */
				}
			});
		saveQueue.current = pending;
		return pending.finally(() => {
			if (saveQueue.current === pending) setChangingLocale(false);
		});
	}, []);
	useEffect(() => {
		document.documentElement.lang = locale;
		document.title =
			locale === "ko" ? "Orbit · 개인 작업 공간" : "Orbit · Personal workspace";
	}, [locale]);
	useEffect(() => {
		const sync = (event: StorageEvent) => {
			if (
				event.key === LOCALE_STORAGE &&
				(event.newValue === "ko" || event.newValue === "en")
			)
				void flushLocaleWrites(window)
					.then(() => setCurrent(event.newValue as Locale))
					.catch(() => {});
		};
		window.addEventListener("storage", sync);
		return () => window.removeEventListener("storage", sync);
	}, []);
	const t = useCallback(
		(message: string, values?: readonly unknown[]) =>
			translate(locale, message, values),
		[locale],
	);
	const errorText = useCallback(
		(message: string) => translateError(locale, message),
		[locale],
	);
	const value = useMemo(
		() => ({
			locale,
			changingLocale,
			intlLocale: intlLocale(locale),
			setLocale,
			t,
			errorText,
		}),
		[locale, setLocale, changingLocale, t, errorText],
	);
	return (
		<LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
	);
}
export function useI18n() {
	const context = useContext(LocaleContext);
	if (!context) throw new Error("useI18n must be used within LocaleProvider");
	return context;
}

export function LocaleContextBridge({
	value,
	children,
}: {
	value: LocaleContextValue;
	children: ReactNode;
}) {
	return (
		<LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
	);
}
