export type UndoEntry = { id: string; undo: () => Promise<void> };

// A failed undo remains available; concurrent shortcuts cannot undo it twice.
export class UndoHistory<T extends UndoEntry> {
	private entries: T[] = [];
	busy = false;
	get latest() {
		return this.entries.at(-1);
	}
	push(entry: T) {
		this.entries.push(entry);
		if (this.entries.length > 200) this.entries.shift();
	}
	get(id: string) {
		return this.entries.find((entry) => entry.id === id);
	}
	async undo(id = this.latest?.id) {
		const entry = id ? this.get(id) : undefined;
		if (!entry || this.busy) return undefined;
		this.busy = true;
		try {
			await entry.undo();
			this.entries = this.entries.filter((value) => value.id !== entry.id);
			return entry;
		} finally {
			this.busy = false;
		}
	}
}
