import { moveItemLocally } from "./item-move";
import { folderOf, spaceConfig } from "./para";
import type { OrbitMutation, OrbitSnapshot } from "./schema";
import { mergeSnapshotItems } from "./snapshot-overlay";
import {
	remapTreeOrder,
	removeFolderTreeOrder,
	transferFolderTreeOrder,
} from "./tree-move";
import { toVaultSlug } from "./vault-slug";

export type FolderMutation = Extract<
	OrbitMutation,
	{ action: "create-folder" | "update-folder" | "delete-folder" }
>;
export function isFolderMutation(
	mutation: OrbitMutation,
): mutation is FolderMutation {
	return ["create-folder", "update-folder", "delete-folder"].includes(
		mutation.action,
	);
}
function destination(mutation: FolderMutation) {
	if (mutation.action === "create-folder")
		return [mutation.input.parent, toVaultSlug(mutation.input.name)]
			.filter(Boolean)
			.join("/");
	if (mutation.action === "delete-folder") return mutation.input.path;
	const parts = mutation.input.path.split("/");
	return [
		mutation.input.parent ??
			(mutation.input.destinationSpace &&
			mutation.input.destinationSpace !== mutation.input.space
				? ""
				: parts.slice(0, -1).join("/")),
		mutation.input.name ? toVaultSlug(mutation.input.name) : parts.at(-1),
	]
		.filter(Boolean)
		.join("/");
}
export function folderMutationObserved(
	snapshot: OrbitSnapshot,
	mutation: FolderMutation,
) {
	const destinationSpace =
		mutation.action === "update-folder"
			? (mutation.input.destinationSpace ?? mutation.input.space)
			: mutation.input.space;
	const folders = snapshot.folders[destinationSpace];
	const next = destination(mutation);
	if (mutation.action === "delete-folder") {
		const inside = (value: string) =>
			value === next || value.startsWith(`${next}/`);
		return (
			!folders.some((folder) => inside(folder.slug)) &&
			!snapshot.items.some(
				(item) =>
					item.space === mutation.input.space &&
					item.folder &&
					inside(item.folder),
			)
		);
	}
	const folder = folders.find((folder) => folder.slug === next);
	return Boolean(
		folder &&
			(!mutation.input.color || folder.color === mutation.input.color) &&
			(mutation.action !== "update-folder" ||
				(destinationSpace === mutation.input.space &&
					next === mutation.input.path) ||
				!snapshot.folders[mutation.input.space].some(
					(entry) => entry.slug === mutation.input.path,
				)),
	);
}
export function projectFolderMutation(
	snapshot: OrbitSnapshot,
	mutation: FolderMutation,
): OrbitSnapshot {
	const { space } = mutation.input;
	const folders = snapshot.folders[space];
	const nextPath = destination(mutation);
	if (mutation.action === "create-folder") {
		if (folders.some((folder) => folder.slug === nextPath)) return snapshot;
		const parts = nextPath.split("/");
		return {
			...snapshot,
			folders: {
				...snapshot.folders,
				[space]: [
					...folders,
					{
						space,
						slug: nextPath,
						name: parts.at(-1) ?? nextPath,
						parent: parts.slice(0, -1).join("/") || undefined,
						depth: parts.length - 1,
						color: mutation.input.color ?? "lime",
						count: 0,
						descendantCount: 0,
					},
				],
			},
		};
	}
	const oldPath = mutation.input.path;
	const source = folders.find((folder) => folder.slug === oldPath);
	const inside = (path: string) =>
		path === oldPath || path.startsWith(`${oldPath}/`);
	if (mutation.action === "delete-folder") {
		if (
			!mutation.input.deleteContents &&
			(source?.descendantCount ||
				folders.some((folder) => folder.slug.startsWith(`${oldPath}/`)))
		)
			return snapshot;
		const removed = snapshot.items.filter(
			(item) => item.space === space && item.folder && inside(item.folder),
		);
		const removedIds = new Set(removed.map((item) => item.id));
		if (!mutation.input.deleteContents && removed.length) return snapshot;
		const prefix = `${spaceConfig(space)?.vault}/${oldPath}/`;
		return {
			...mergeSnapshotItems(
				{
					...snapshot,
					items: snapshot.items.filter((item) => !removedIds.has(item.id)),
				},
				[],
				true,
			),
			canvases: snapshot.canvases.filter(
				(canvas) => !canvas.path.startsWith(prefix),
			),
			treeOrder: {
				...snapshot.treeOrder,
				[space]: removeFolderTreeOrder(
					snapshot.treeOrder?.[space] ?? {},
					oldPath,
					removedIds,
				),
			},
			folders: {
				...snapshot.folders,
				[space]: folders
					.filter((folder) => !inside(folder.slug))
					.map((folder) => ({
						...folder,
						descendantCount: snapshot.items.filter(
							(item) =>
								item.space === space &&
								!removedIds.has(item.id) &&
								(item.folder === folder.slug ||
									item.folder?.startsWith(`${folder.slug}/`)),
						).length,
					})),
			},
		};
	}
	if (!source) return snapshot;
	const nextSpace = mutation.input.destinationSpace ?? space;
	if (nextSpace !== space) {
		if (snapshot.folders[nextSpace].some((folder) => folder.slug === nextPath))
			return snapshot;
		const moved = snapshot.items.filter(
			(item) => item.space === space && inside(folderOf(item) ?? ""),
		);
		const ids = new Set(moved.map((item) => item.id));
		const order = transferFolderTreeOrder(
			snapshot.treeOrder?.[space] ?? {},
			snapshot.treeOrder?.[nextSpace] ?? {},
			oldPath,
			nextPath,
			ids,
		);
		const movedFolders = folders
			.filter((folder) => inside(folder.slug))
			.map((folder) => {
				const slug = nextPath + folder.slug.slice(oldPath.length);
				const parts = slug.split("/");
				return {
					...folder,
					space: nextSpace,
					slug,
					name: parts.at(-1) ?? slug,
					parent: parts.slice(0, -1).join("/") || undefined,
					depth: parts.length - 1,
					color:
						folder.slug === oldPath
							? (mutation.input.color ?? folder.color)
							: folder.color,
				};
			});
		const nextItems = snapshot.items.map((item) => {
			if (!ids.has(item.id)) return item;
			const folder = nextPath + (folderOf(item) ?? "").slice(oldPath.length);
			return {
				...item,
				space: nextSpace,
				folder,
				path: `${spaceConfig(nextSpace)?.vault}/${folder}/${item.path.split("/").at(-1)}`,
			};
		});
		const countFolders = (entries: typeof folders, target: typeof space) =>
			entries.map((folder) => ({
				...folder,
				count: nextItems.filter(
					(item) => item.space === target && folderOf(item) === folder.slug,
				).length,
				descendantCount: nextItems.filter(
					(item) =>
						item.space === target &&
						(folderOf(item) === folder.slug ||
							folderOf(item)?.startsWith(`${folder.slug}/`)),
				).length,
			}));
		const prefix = `${spaceConfig(space)?.vault}/${oldPath}/`;
		return mergeSnapshotItems(
			{
				...snapshot,
				items: nextItems,
				canvases: snapshot.canvases.map((canvas) =>
					canvas.path.startsWith(prefix)
						? {
								...canvas,
								path: `${spaceConfig(nextSpace)?.vault}/${nextPath}/${canvas.path.slice(prefix.length)}`,
							}
						: canvas,
				),
				folders: {
					...snapshot.folders,
					[space]: countFolders(
						folders.filter((folder) => !inside(folder.slug)),
						space,
					),
					[nextSpace]: countFolders(
						[...snapshot.folders[nextSpace], ...movedFolders],
						nextSpace,
					),
				},
				treeOrder: {
					...snapshot.treeOrder,
					[space]: order.source,
					[nextSpace]: order.destination,
				},
			},
			[],
			true,
		);
	}

	if (
		nextPath !== oldPath &&
		(inside(nextPath) || folders.some((folder) => folder.slug === nextPath))
	)
		return snapshot;
	return {
		...snapshot,
		treeOrder: {
			...snapshot.treeOrder,
			[space]: remapTreeOrder(
				snapshot.treeOrder?.[space] ?? {},
				oldPath,
				nextPath,
			),
		},
		folders: {
			...snapshot.folders,
			[space]: folders.map((folder) => {
				if (!inside(folder.slug)) return folder;
				const slug = nextPath + folder.slug.slice(oldPath.length);
				const parts = slug.split("/");
				return {
					...folder,
					slug,
					name: parts.at(-1) ?? slug,
					parent: parts.slice(0, -1).join("/") || undefined,
					depth: parts.length - 1,
					color:
						folder.slug === oldPath
							? (mutation.input.color ?? folder.color)
							: folder.color,
				};
			}),
		},
		items: snapshot.items.map((item) =>
			item.space === space && item.folder && inside(item.folder)
				? moveItemLocally(
						item,
						space,
						nextPath + item.folder.slice(oldPath.length),
					)
				: item,
		),
	};
}
