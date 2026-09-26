import { moveItemLocally } from "./item-move";
import {
	type FolderMutation,
	folderMutationObserved,
	isFolderMutation,
	projectFolderMutation,
} from "./optimistic-folders";
import {
	type OrbitItem,
	type OrbitMutation,
	type OrbitSnapshot,
	orbitItemSchema,
} from "./schema";
import { mergeSnapshotItems } from "./snapshot-overlay";

export type MutationLifecycle = {
	requestId: string;
	mutation: OrbitMutation;
	phase: "start" | "success" | "failure";
	result?: unknown;
};

export function isPendingItemId(id?: string) {
	return Boolean(id?.startsWith("orbit-pending:"));
}

function predict(
	mutation: OrbitMutation,
	item?: OrbitItem,
): OrbitItem | null | undefined {
	if (!item) return undefined;
	switch (mutation.action) {
		case "delete-item":
			return null;
		case "archive-item":
			return moveItemLocally(item, "archive");
		case "toggle-task":
			return { ...item, status: item.status === "done" ? "open" : "done" };
		case "update-note":
			return { ...item, ...mutation.input };
		case "file-item": {
			const input = mutation.input;
			const next = moveItemLocally(
				{ ...item, type: input.type ?? item.type },
				input.space,
				input.folder,
			);
			for (const field of [
				"title",
				"body",
				"type",
				"color",
				"status",
				"project",
				"due",
				"start",
				"end",
				"url",
				"tags",
			] as const) {
				if (input[field] !== undefined)
					Object.assign(next, { [field]: input[field] ?? undefined });
			}
			next.status =
				next.type === "task"
					? (input.status ?? item.status ?? "open")
					: undefined;
			return next;
		}
		default:
			return undefined;
	}
}

// Confirmed writes and pending operations are separate. If a later queued write
// fails, its rollback reveals the earlier success instead of the original snapshot.
export class OptimisticItems {
	private folders = new Map<
		string,
		{ mutation: FolderMutation; settled: boolean }
	>();
	private restored = new Set<string>();
	private confirmed = new Map<string, OrbitItem | null>();
	private pending = new Map<
		string,
		{
			id: string;
			mutation: OrbitMutation;
			initial?: OrbitItem;
			targetStatus?: OrbitItem["status"];
		}
	>();

	acknowledge(item: OrbitItem) {
		this.restored.delete(item.id);
		this.confirmed.set(item.id, item);
	}
	restore(id: string, item: OrbitItem | null) {
		this.restored.add(id);
		this.confirmed.set(id, item);
	}

	start(requestId: string, mutation: OrbitMutation, snapshot: OrbitSnapshot) {
		if (isFolderMutation(mutation)) {
			this.folders.set(requestId, { mutation, settled: false });
		} else if ("id" in mutation) {
			const item = this.project(snapshot).items.find(
				(entry) => entry.id === mutation.id,
			);
			if (predict(mutation, item) !== undefined)
				this.pending.set(requestId, {
					id: mutation.id,
					mutation,
					targetStatus:
						mutation.action === "toggle-task"
							? item?.status === "done"
								? "open"
								: "done"
							: undefined,
				});
		} else if (
			(mutation.action === "create-item" || mutation.action === "capture") &&
			["task", "event"].includes(mutation.input.type)
		) {
			const input = mutation.input;
			const id = `orbit-pending:${requestId}`;
			const now = new Date().toISOString();
			const initial: OrbitItem = {
				...input,
				id,
				space: "space" in input ? input.space : "inbox",
				status: input.type === "task" ? "open" : undefined,
				tags: [],
				path: "",
				created: now,
				updated: now,
			};
			this.pending.set(requestId, { id, mutation, initial });
		}
	}

	finish(event: MutationLifecycle) {
		const folder = this.folders.get(event.requestId);
		if (folder) {
			if (event.phase === "success") folder.settled = true;
			else this.folders.delete(event.requestId);
		}
		this.pending.delete(event.requestId);
		if (event.phase !== "success") return;
		if (event.mutation.action === "delete-item")
			this.confirmed.set(event.mutation.id, null);
		const item = orbitItemSchema.safeParse(event.result);
		if (item.success) this.acknowledge(item.data);
	}

	reconcile(snapshot: OrbitSnapshot) {
		for (const [id, entry] of this.folders) {
			if (entry.settled && folderMutationObserved(snapshot, entry.mutation))
				this.folders.delete(id);
		}
		const items = new Map(snapshot.items.map((item) => [item.id, item]));
		for (const [id, item] of this.confirmed) {
			const stored = items.get(id);
			if (
				item
					? stored &&
						(this.restored.has(id)
							? JSON.stringify(stored) === JSON.stringify(item)
							: stored.updated >= item.updated)
					: !stored
			) {
				this.confirmed.delete(id);
				this.restored.delete(id);
			}
		}
	}

	project(snapshot: OrbitSnapshot): OrbitSnapshot {
		if (!this.confirmed.size && !this.pending.size && !this.folders.size)
			return snapshot;
		const items = new Map(snapshot.items.map((item) => [item.id, item]));
		for (const [id, item] of this.confirmed) {
			if (!item) items.delete(id);
			else if (
				this.restored.has(id) ||
				!items.has(id) ||
				(items.get(id)?.updated ?? "") <= item.updated
			)
				items.set(id, item);
		}
		for (const entry of this.pending.values()) {
			const item =
				entry.initial ?? predict(entry.mutation, items.get(entry.id));
			if (item === null) items.delete(entry.id);
			else if (item)
				items.set(
					entry.id,
					entry.targetStatus ? { ...item, status: entry.targetStatus } : item,
				);
		}
		let projected = mergeSnapshotItems(
			{ ...snapshot, items: [] },
			[...items.values()],
			true,
		);
		for (const entry of this.folders.values())
			projected = projectFolderMutation(projected, entry.mutation);
		return projected;
	}
}
