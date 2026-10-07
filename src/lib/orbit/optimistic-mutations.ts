import { moveItemLocally } from "./item-move";
import {
	type FolderMutation,
	folderMutationObserved,
	isFolderMutation,
	projectFolderMutation,
} from "./optimistic-folders";
import {
	applyRoutineMutation,
	emptyRoutineData,
	type RoutineData,
	type RoutineMutation,
	routineDataSchema,
	routineMutationSchema,
} from "./routines";
import {
	DEFAULT_SCHEDULE_CATEGORIES,
	upsertScheduleCategory,
} from "./schedule-categories";
import {
	type OrbitItem,
	type OrbitMutation,
	type OrbitSnapshot,
	orbitItemSchema,
	type ScheduleCategory,
} from "./schema";
import { mergeSnapshotItems } from "./snapshot-overlay";

type RoutineWrite = {
	mutation: RoutineMutation;
	settled: boolean;
	result?: RoutineData;
	timerKeys?: string[];
};
function routineWriteKey(mutation: RoutineMutation) {
	if (mutation.action === "routine-timer") return "routine-timers";
	if (mutation.action === "move-routine") return "routine-order";
	if (mutation.action === "set-routine-status")
		return `${mutation.day}:${mutation.id}`;
	return `routine:${mutation.action === "save-routine" ? mutation.input.id : mutation.id}`;
}
function projectRoutineWrite(
	data: RoutineData,
	entry: RoutineWrite,
): RoutineData {
	if (!entry.result) return applyRoutineMutation(data, entry.mutation);
	const mutation = entry.mutation;
	const id =
		mutation.action === "save-routine" ? mutation.input.id : mutation.id;
	const timers = { ...data.timers };
	for (const key of entry.timerKeys ?? []) {
		const saved = entry.result.timers[key];
		if (saved) timers[key] = saved;
		else delete timers[key];
	}
	if (mutation.action === "routine-timer") return { ...data, timers };
	if (mutation.action === "move-routine") {
		const byId = new Map(data.routines.map((routine) => [routine.id, routine]));
		const order = entry.result.routines.map((routine) => routine.id);
		return {
			...data,
			routines: [
				...order.flatMap((id) => byId.get(id) ?? []),
				...data.routines.filter((routine) => !order.includes(routine.id)),
			],
		};
	}
	if (mutation.action === "set-routine-status") {
		const key = `${mutation.day}:${mutation.id}`,
			records = { ...data.records };
		const record = entry.result.records[key];
		if (record) records[key] = record;
		else delete records[key];
		return { ...data, records, timers };
	}
	const saved = entry.result.routines.find((routine) => routine.id === id);
	if (!saved) return data;
	return {
		...data,
		timers,
		routines: data.routines.some((routine) => routine.id === id)
			? data.routines.map((routine) => (routine.id === id ? saved : routine))
			: [...data.routines, saved],
	};
}

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
			return {
				...item,
				status: item.status === "done" ? "open" : "done",
				completedAt:
					item.status === "done" ? undefined : new Date().toISOString(),
			};
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
				"category",
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
			next.completedAt =
				next.status === "done"
					? item.status === "done"
						? item.completedAt
						: new Date().toISOString()
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
	private routineWrites = new Map<string, RoutineWrite>();
	private pendingCategories = new Map<string, ScheduleCategory>();
	private confirmedCategories = new Map<string, ScheduleCategory>();
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
		const routine = routineMutationSchema.safeParse(mutation);
		if (routine.success) {
			this.routineWrites.set(requestId, {
				mutation: routine.data,
				settled: false,
			});
		} else if (mutation.action === "save-schedule-category") {
			this.pendingCategories.set(requestId, mutation.input);
		} else if (isFolderMutation(mutation)) {
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
		const routine = this.routineWrites.get(event.requestId);
		if (routine) {
			if (event.phase === "success") {
				routine.settled = true;
				routine.result = routineDataSchema.safeParse(event.result).data;
				const mutation = routine.mutation;
				routine.timerKeys = Object.entries(
					routine.result?.timers ?? {},
				).flatMap(([key, timer]) => {
					if (mutation.action === "routine-timer") return [key];
					if (
						mutation.action === "set-routine-status" &&
						key === `${mutation.day}:${mutation.id}`
					)
						return [key];
					if (
						(mutation.action === "save-routine" ||
							mutation.action === "set-routine-enabled" ||
							mutation.action === "delete-routine") &&
						timer.routineId ===
							(mutation.action === "save-routine"
								? mutation.input.id
								: mutation.id)
					)
						return [key];
					return [];
				});
				// Later writes own overlapping timer fields independently of configuration/status patches.
				for (const entry of this.routineWrites.values()) {
					if (entry !== routine && entry.settled)
						entry.timerKeys = entry.timerKeys?.filter(
							(key) => !routine.timerKeys?.includes(key),
						);
				}
				for (const [id, entry] of this.routineWrites) {
					if (
						id !== event.requestId &&
						entry.settled &&
						routineWriteKey(entry.mutation) ===
							routineWriteKey(routine.mutation)
					)
						this.routineWrites.delete(id);
				}
			} else this.routineWrites.delete(event.requestId);
		}
		const category = this.pendingCategories.get(event.requestId);
		if (category) {
			this.pendingCategories.delete(event.requestId);
			if (event.phase === "success")
				this.confirmedCategories.set(category.id, category);
		}
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
		// Only drop confirmed patches when the corresponding server values arrive.
		const routineData = snapshot.routineData ?? emptyRoutineData();
		for (const [requestId, entry] of this.routineWrites) {
			if (!entry.settled) continue;
			try {
				if (
					JSON.stringify(projectRoutineWrite(routineData, entry)) ===
					JSON.stringify(routineData)
				)
					this.routineWrites.delete(requestId);
			} catch {
				/* Pending dependent writes can outlive a stale server snapshot. */
			}
		}
		for (const [id, category] of this.confirmedCategories) {
			if (
				(id === "uncategorized" &&
					(snapshot.uncategorizedScheduleName ?? "미분류") === category.name &&
					(snapshot.uncategorizedScheduleColor ?? "slate") ===
						category.color) ||
				snapshot.scheduleCategories?.some(
					(entry) =>
						entry.id === id &&
						entry.name === category.name &&
						entry.color === category.color,
				)
			)
				this.confirmedCategories.delete(id);
		}
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
		if (
			!this.routineWrites.size &&
			!this.confirmed.size &&
			!this.pending.size &&
			!this.folders.size &&
			!this.pendingCategories.size &&
			!this.confirmedCategories.size
		)
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
		if (this.pendingCategories.size || this.confirmedCategories.size) {
			let categories =
				projected.scheduleCategories ?? DEFAULT_SCHEDULE_CATEGORIES;
			for (const category of [
				...this.confirmedCategories.values(),
				...this.pendingCategories.values(),
			]) {
				if (category.id === "uncategorized")
					projected = {
						...projected,
						uncategorizedScheduleName: category.name,
						uncategorizedScheduleColor: category.color,
					};
				else categories = upsertScheduleCategory(categories, category);
			}
			projected = { ...projected, scheduleCategories: categories };
		}
		if (this.routineWrites.size) {
			let routineData = projected.routineData ?? emptyRoutineData();
			for (const entry of this.routineWrites.values()) {
				try {
					routineData = projectRoutineWrite(routineData, entry);
				} catch {
					/* A failed dependency is rolled back by the mutation lifecycle. */
				}
			}
			projected = { ...projected, routineData };
		}
		return projected;
	}
}
