// A write arriving during a read needs one more read, not a parallel request or
// a stale response that clears the newest optimistic result.
export function createRefreshQueue<T>(
	load: () => Promise<T>,
	commit: (value: T) => void,
) {
	let running: Promise<void> | undefined;
	let requested = false;
	return function refresh(): Promise<void> {
		requested = true;
		if (running) return running;
		running = Promise.resolve().then(async () => {
			try {
				do {
					requested = false;
					commit(await load());
				} while (requested);
			} finally {
				running = undefined;
			}
		});
		return running;
	};
}
