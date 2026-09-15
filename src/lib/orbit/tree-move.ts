import { indexFolderTree } from "./folder-tree";
import { folderOf } from "./para";
import type {
	MoveTreeInput,
	OrbitFolder,
	OrbitItem,
	TreeOrder,
} from "./schema";

export function remapTreeOrder(
	order: TreeOrder,
	from: string,
	to: string,
): TreeOrder {
	const remap = (value: string) =>
		value === from || value.startsWith(`${from}/`)
			? to + value.slice(from.length)
			: value;
	return Object.fromEntries(
		Object.entries(order).map(([parent, keys]) => [
			remap(parent),
			keys.map((key) =>
				key.startsWith("folder:") ? `folder:${remap(key.slice(7))}` : key,
			),
		]),
	);
}

export function treeMoveEntries(tree: ReturnType<typeof indexFolderTree>) {
	const entries = new Map<
		string,
		{ key: string; folder?: OrbitFolder; item?: OrbitItem }
	>();
	for (const children of tree.childrenByFolder.values())
		for (const entry of children) entries.set(entry.key, entry);
	return entries;
}
export function resolveTreeMove(
	entries: ReturnType<typeof treeMoveEntries>,
	input: MoveTreeInput,
) {
	const source = entries.get(input.key) as
		| { key: string; folder?: OrbitFolder; item?: OrbitItem }
		| undefined;
	const target = input.target
		? (entries.get(input.target) as typeof source)
		: undefined;
	if (!source || (input.target && !target))
		throw new Error("이동할 항목을 찾을 수 없습니다.");
	if (input.key === input.target)
		throw new Error("자기 자신으로 이동할 수 없습니다.");
	if (input.position === "inside" && target && !target.folder)
		throw new Error("폴더 안으로만 이동할 수 있습니다.");
	const parent = target
		? input.position === "inside"
			? (target.folder?.slug ?? "")
			: (target.folder?.parent ??
				(target.item ? folderOf(target.item) : undefined) ??
				"")
		: "";
	const oldParent =
		source.folder?.parent ??
		(source.item ? folderOf(source.item) : undefined) ??
		"";
	const from = source.folder?.slug;
	if (from && (parent === from || parent.startsWith(`${from}/`)))
		throw new Error("자신의 하위 폴더로 이동할 수 없습니다.");
	const to = from
		? [parent, source.folder?.name].filter(Boolean).join("/")
		: undefined;
	if (from !== to && to && entries.has(`folder:${to}`))
		throw new Error("같은 이름의 폴더가 이미 있습니다.");
	return { source, parent, oldParent, from, to };
}
export function planTreeMove(
	items: OrbitItem[],
	folders: OrbitFolder[],
	order: TreeOrder,
	input: MoveTreeInput,
) {
	const tree = indexFolderTree(items, folders, order);
	const { source, parent, oldParent, from, to } = resolveTreeMove(
		treeMoveEntries(tree),
		input,
	);
	const nextKey = to ? `folder:${to}` : input.key;
	const siblings = (tree.childrenByFolder.get(parent) ?? [])
		.map((entry) => entry.key)
		.filter((key) => key !== input.key);
	const at =
		input.position === "inside" || !input.target
			? siblings.length
			: siblings.indexOf(input.target) + (input.position === "after" ? 1 : 0);
	siblings.splice(at, 0, nextKey);
	let nextOrder = {
		...order,
		[oldParent]: (tree.childrenByFolder.get(oldParent) ?? [])
			.map((entry) => entry.key)
			.filter((key) => key !== input.key),
		[parent]: siblings,
	};
	if (from && to && from !== to)
		nextOrder = remapTreeOrder(nextOrder, from, to);
	const remap = (value: string) =>
		from && to && (value === from || value.startsWith(`${from}/`))
			? to + value.slice(from.length)
			: value;
	const nextFolders = folders.map((folder) => {
		const slug = remap(folder.slug);
		return {
			...folder,
			slug,
			parent: slug.split("/").slice(0, -1).join("/") || undefined,
			depth: slug.split("/").length - 1,
		};
	});
	const nextItems = items.map((item) => {
		const oldFolder = folderOf(item) ?? "";
		const folder = item.id === source.item?.id ? parent : remap(oldFolder);
		if (folder === oldFolder) return item;
		const root = item.path.split("/")[0];
		return {
			...item,
			folder: folder || undefined,
			path: [root, folder, item.path.split("/").at(-1)]
				.filter(Boolean)
				.join("/"),
		};
	});
	return {
		items: nextItems,
		folders: nextFolders,
		order: nextOrder,
		parent,
		from,
		to,
		item: source.item,
	};
}
