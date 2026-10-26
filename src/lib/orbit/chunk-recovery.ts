const RELOAD_KEY = "orbit:chunk-reload:v1";

export function isChunkLoadError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Loading chunk [\w-]+ failed|Unable to preload CSS/i.test(
		message,
	);
}

type RecoveryOptions = {
	entry: string;
	storage: Pick<Storage, "getItem" | "setItem">;
	canReload: () => boolean;
	probe: () => Promise<boolean>;
	reload: () => void;
	now?: () => number;
};

// A rejected module stays rejected in React.lazy. Bound retries across remounts
// and full navigations, including when storage is disabled or the network is down.
export function createChunkRecovery(options: RecoveryOptions) {
	let pending: Promise<boolean> | undefined;
	return () => {
		if (pending) return pending;
		pending = (async () => {
			try {
				if (!options.entry || !options.canReload()) return false;
				const now = options.now?.() ?? Date.now();
				const previous = JSON.parse(
					options.storage.getItem(RELOAD_KEY) || "null",
				);
				if (
					previous &&
					(previous.entry === options.entry || now - previous.at < 60_000)
				)
					return false;
				if (!(await options.probe()) || !options.canReload()) return false;
				options.storage.setItem(
					RELOAD_KEY,
					JSON.stringify({ entry: options.entry, at: now }),
				);
				options.reload();
				return true;
			} catch {
				return false;
			}
		})();
		return pending;
	};
}

let recover: (() => Promise<boolean>) | undefined;
let edited = false;

export function installChunkRecovery() {
	if (typeof window === "undefined" || recover) return;
	// Deliberately conservative: once an editor has been touched, never discard
	// that page automatically, even after a save or a route boundary unmounts it.
	const markEdited = () => {
		edited = true;
	};
	document.addEventListener("input", markEdited, true);
	document.addEventListener("change", markEdited, true);
	const markEditorInteraction = (event: Event) => {
		if (
			event.target instanceof Element &&
			event.target.closest(
				'input, textarea, select, [contenteditable="true"], canvas, [role="dialog"], [role="alertdialog"]',
			)
		)
			markEdited();
	};
	document.addEventListener("pointerdown", markEditorInteraction, true);
	document.addEventListener("keydown", markEditorInteraction, true);
	recover = createChunkRecovery({
		entry:
			document.querySelector<HTMLScriptElement>('script[type="module"][src]')
				?.src ?? "",
		storage: {
			getItem: (key) => sessionStorage.getItem(key),
			setItem: (key, value) => sessionStorage.setItem(key, value),
		},
		canReload: () =>
			!edited &&
			navigator.onLine &&
			!document.querySelector('[role="dialog"], [role="alertdialog"]'),
		probe: async () => {
			const response = await fetch(location.href, {
				cache: "no-store",
				signal: AbortSignal.timeout(5000),
			});
			return (
				response.ok &&
				response.headers.get("content-type")?.includes("text/html") === true
			);
		},
		reload: () => location.reload(),
	});
}

export function recoverChunkLoad() {
	installChunkRecovery();
	return recover?.() ?? Promise.resolve(false);
}

export function hasEditedPage() {
	return edited;
}
