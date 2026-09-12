import { folderOf } from "./para";
import type { OrbitFolder, OrbitItem, TreeOrder } from "./schema";

export type FolderRow = {
	kind: "folder";
	key: string;
	folder: OrbitFolder;
	depth: number;
	hasChildren: boolean;
	expanded: boolean;
};
export type TreeRow =
	| FolderRow
	| {
			kind: "item";
			key: string;
			item: OrbitItem;
			depth: number;
	  };

export function folderAncestors(folder: string) {
	const parts = folder.split("/");
	return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
}

// Built once for a snapshot, independently of expansion and selection.
export function indexFolderTree(
	items: OrbitItem[],
	folders: OrbitFolder[],
	order: TreeOrder = {},
) {
	const itemsByFolder = new Map<string, OrbitItem[]>();
	const childFolders = new Map<string, OrbitFolder[]>();
	for (const item of items) {
		const key = folderOf(item) ?? "";
		const children = itemsByFolder.get(key) ?? [];
		children.push(item);
		itemsByFolder.set(key, children);
	}
	for (const folder of folders) {
		const key = folder.parent ?? "";
		const children = childFolders.get(key) ?? [];
		children.push(folder);
		childFolders.set(key, children);
	}
	const collator = new Intl.Collator("ko");
	for (const children of itemsByFolder.values()) {
		children.sort((a, b) => collator.compare(a.title, b.title));
	}
	for (const children of childFolders.values()) {
		children.sort((a, b) => collator.compare(a.name, b.name));
	}
	const childrenByFolder = new Map<
		string,
		Array<{ key: string; folder?: OrbitFolder; item?: OrbitItem }>
	>();
	for (const parent of new Set([
		...childFolders.keys(),
		...itemsByFolder.keys(),
	])) {
		const children = [
			...(childFolders.get(parent) ?? []).map((folder) => ({
				key: `folder:${folder.slug}`,
				folder,
			})),
			...(itemsByFolder.get(parent) ?? []).map((item) => ({
				key: `item:${item.id}`,
				item,
			})),
		];
		const ranks = new Map((order[parent] ?? []).map((key, i) => [key, i]));
		children.sort(
			(a, b) => (ranks.get(a.key) ?? Infinity) - (ranks.get(b.key) ?? Infinity),
		);
		childrenByFolder.set(parent, children);
	}
	return { itemsByFolder, childFolders, childrenByFolder, items, folders };
}

export function flattenFolderTree(
	tree: ReturnType<typeof indexFolderTree>,
	collapsed: ReadonlySet<string>,
	query: string,
): TreeRow[] {
	const needle = query.trim().toLocaleLowerCase("ko");
	const matches = new Set<string>();
	const matchingFolders = new Set<string>();
	if (needle) {
		for (const item of tree.items) {
			if (
				![
					item.title,
					item.body,
					item.tags.join(" "),
					folderOf(item) ?? "",
				].some((text) => text.toLocaleLowerCase("ko").includes(needle))
			)
				continue;
			matches.add(item.id);
			for (const ancestor of folderAncestors(folderOf(item) ?? ""))
				matchingFolders.add(ancestor);
		}
		for (const folder of tree.folders) {
			if (folder.slug.toLocaleLowerCase("ko").includes(needle)) {
				for (const ancestor of folderAncestors(folder.slug))
					matchingFolders.add(ancestor);
			}
		}
	}
	const rows: TreeRow[] = [];
	function visit(parent: string, depth: number) {
		for (const entry of tree.childrenByFolder.get(parent) ?? []) {
			const { folder, item } = entry;
			if (item) {
				if (!needle || matches.has(item.id))
					rows.push({ kind: "item", key: entry.key, item, depth });
				continue;
			}
			if (!folder) continue;
			if (needle && !matchingFolders.has(folder.slug)) continue;
			const expanded = Boolean(needle) || !collapsed.has(folder.slug);
			rows.push({
				kind: "folder",
				key: `folder:${folder.slug}`,
				folder,
				depth,
				expanded,
				hasChildren: Boolean(
					tree.childFolders.get(folder.slug)?.length ||
						tree.itemsByFolder.get(folder.slug)?.length,
				),
			});
			if (expanded) visit(folder.slug, depth + 1);
		}
	}
	visit("", 0);
	return rows;
}

export function visibleRowRange(
	count: number,
	scrollTop: number,
	height: number,
	rowHeight: number,
) {
	const start = Math.max(
		0,
		Math.min(count - 1, Math.floor(scrollTop / rowHeight)) - 8,
	);
	const end = Math.min(
		count,
		Math.max(start + 1, Math.ceil((scrollTop + height) / rowHeight)) + 8,
	);
	return { start, end };
}
