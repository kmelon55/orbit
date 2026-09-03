import { useCallback, useEffect, useSyncExternalStore } from "react";

type BeforeInstallPromptEvent = Event & {
	prompt: () => Promise<void>;
	userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export type PwaPlatform = "android" | "ios" | "desktop" | "other";
export type PwaInstallOutcome = "accepted" | "dismissed" | "unavailable";

type PwaInstallState = {
	ready: boolean;
	installed: boolean;
	platform: PwaPlatform;
	prompt: BeforeInstallPromptEvent | null;
};

const listeners = new Set<() => void>();
const serverState: PwaInstallState = {
	ready: false,
	installed: false,
	platform: "other",
	prompt: null,
};
let state = serverState;
let initialized = false;
const INSTALL_MARKER = "orbit:pwa-installed";

function emit(next: Partial<PwaInstallState>) {
	state = { ...state, ...next };
	for (const listener of listeners) listener();
}

function isStandalone() {
	return (
		window.matchMedia("(display-mode: standalone)").matches ||
		("standalone" in navigator &&
			(navigator as Navigator & { standalone?: boolean }).standalone === true)
	);
}

function hasInstallMarker() {
	try {
		return window.localStorage.getItem(INSTALL_MARKER) === "true";
	} catch {
		return false;
	}
}

function saveInstallMarker(installed: boolean) {
	try {
		if (installed) window.localStorage.setItem(INSTALL_MARKER, "true");
		else window.localStorage.removeItem(INSTALL_MARKER);
	} catch {
		// Private browsing and restricted storage can reject localStorage access.
	}
}

function markInstalled() {
	saveInstallMarker(true);
	emit({ installed: true, prompt: null });
}

function detectPlatform(): PwaPlatform {
	const userAgent = navigator.userAgent;
	const ios =
		/iPad|iPhone|iPod/.test(userAgent) ||
		(navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
	if (ios) return "ios";
	if (/Android/i.test(userAgent)) return "android";
	if (/Windows|Macintosh|Linux/i.test(userAgent)) return "desktop";
	return "other";
}

function initialize() {
	if (initialized || typeof window === "undefined") return;
	initialized = true;
	const standalone = isStandalone();
	if (standalone) saveInstallMarker(true);
	emit({
		ready: true,
		installed: standalone || hasInstallMarker(),
		platform: detectPlatform(),
	});

	window.addEventListener("beforeinstallprompt", (event) => {
		event.preventDefault();
		// Receiving this event means the browser currently considers the app
		// installable, so a marker left behind after uninstalling is stale.
		saveInstallMarker(false);
		emit({ installed: false, prompt: event as BeforeInstallPromptEvent });
	});
	window.addEventListener("appinstalled", () => {
		markInstalled();
	});
	window
		.matchMedia("(display-mode: standalone)")
		.addEventListener("change", () => {
			if (isStandalone()) markInstalled();
		});
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

function getSnapshot() {
	return state;
}

function getServerSnapshot() {
	return serverState;
}

export function usePwaInstall() {
	useEffect(initialize, []);
	const current = useSyncExternalStore(
		subscribe,
		getSnapshot,
		getServerSnapshot,
	);

	const install = useCallback(async (): Promise<PwaInstallOutcome> => {
		const prompt = state.prompt;
		if (!prompt) return "unavailable";
		emit({ prompt: null });
		await prompt.prompt();
		const choice = await prompt.userChoice;
		if (choice.outcome === "accepted") markInstalled();
		return choice.outcome;
	}, []);

	const confirmInstalled = useCallback(() => {
		markInstalled();
	}, []);

	return {
		ready: current.ready,
		installed: current.installed,
		platform: current.platform,
		canInstall: current.prompt !== null,
		install,
		confirmInstalled,
	};
}
