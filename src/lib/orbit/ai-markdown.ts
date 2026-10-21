import type { AiSource } from "./ai-types";

export function aiSourceHref(source: AiSource) {
	return source.kind === "item"
		? `/search?note=${encodeURIComponent(source.id)}`
		: `/mail?message=${encodeURIComponent(source.id)}&folder=${encodeURIComponent(source.folder || "inbox")}`;
}

type MarkdownNode = {
	type: string;
	value?: string;
	url?: string;
	children?: MarkdownNode[];
};

/** Link only citations backed by this message's sources; leave code and links alone. */
export function remarkSourceCitations(sources: AiSource[]) {
	const byIndex = new Map(sources.map((source) => [source.index, source]));
	return () => (tree: MarkdownNode) => {
		function visit(node: MarkdownNode) {
			if (
				!node.children ||
				["link", "linkReference", "code", "inlineCode"].includes(node.type)
			)
				return;
			node.children = node.children.flatMap((child) => {
				if (child.type !== "text" || !child.value) {
					visit(child);
					return [child];
				}
				const result: MarkdownNode[] = [];
				let cursor = 0;
				for (const match of child.value.matchAll(/\[(\d+)\]/g)) {
					const source = byIndex.get(Number(match[1]));
					if (!source) continue;
					if (match.index > cursor)
						result.push({
							type: "text",
							value: child.value.slice(cursor, match.index),
						});
					result.push({
						type: "link",
						url: aiSourceHref(source),
						children: [{ type: "text", value: match[0] }],
					});
					cursor = match.index + match[0].length;
				}
				if (cursor < child.value.length)
					result.push({ type: "text", value: child.value.slice(cursor) });
				return result;
			});
		}
		visit(tree);
	};
}
