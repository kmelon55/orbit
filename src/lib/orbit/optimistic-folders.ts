import { moveItemLocally } from "./item-move";
import type { OrbitMutation, OrbitSnapshot } from "./schema";
import { remapTreeOrder } from "./tree-move";
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
		mutation.input.parent ?? parts.slice(0, -1).join("/"),
		mutation.input.name ? toVaultSlug(mutation.input.name) : parts.at(-1),
	]
		.filter(Boolean)
		.join("/");
}
export function folderMutationObserved(
	snapshot: OrbitSnapshot,
	mutation: FolderMutation,
) {
	const folders = snapshot.folders[mutation.input.space];
	const next = destination(mutation);
	if (mutation.action === "delete-folder")
		return !folders.some((folder) => folder.slug === next);
	const folder = folders.find((folder) => folder.slug === next);
	return Boolean(
		folder &&
			(!mutation.input.color || folder.color === mutation.input.color) &&
			(mutation.action !== "update-folder" ||
				next === mutation.input.path ||
				!folders.some((entry) => entry.slug === mutation.input.path)),
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
	if (!source) return snapshot;
	const inside = (path: string) =>
		path === oldPath || path.startsWith(`${oldPath}/`);
	if (mutation.action === "delete-folder") {
		if (
			source.descendantCount ||
			folders.some((folder) => folder.slug.startsWith(`${oldPath}/`))
		)
			return snapshot;
		return {
			...snapshot,
			folders: {
				...snapshot.folders,
				[space]: folders.filter((folder) => folder.slug !== oldPath),
			},
		};
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
