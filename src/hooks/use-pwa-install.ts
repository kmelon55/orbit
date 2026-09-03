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
	emit({
		ready: true,
		installed: isStandalone(),
		platform: detectPlatform(),
	});

	window.addEventListener("beforeinstallprompt", (event) => {
		event.preventDefault();
		emit({ prompt: event as BeforeInstallPromptEvent });
	});
	window.addEventListener("appinstalled", () => {
		emit({ installed: true, prompt: null });
	});
	window
		.matchMedia("(display-mode: standalone)")
		.addEventListener("change", () => emit({ installed: isStandalone() }));
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
		return choice.outcome;
	}, []);

	return {
		ready: current.ready,
		installed: current.installed,
		platform: current.platform,
		canInstall: current.prompt !== null,
		install,
	};
}
