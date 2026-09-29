import { folderOf } from "./para";
import type { OrbitItem } from "./schema";

export type SearchEntry = {
	item: OrbitItem;
	title: string;
	body: string;
	context: string;
	all: string;
};

const normalize = (value: string) =>
	value.normalize("NFKC").toLocaleLowerCase();

export function createSearchIndex(items: OrbitItem[]): SearchEntry[] {
	return items.map((item) => {
		const title = normalize(item.title);
		const body = normalize(item.body);
		const context = normalize(
			[item.project, folderOf(item), ...item.tags].filter(Boolean).join(" "),
		);
		return { item, title, body, context, all: `${title} ${context} ${body}` };
	});
}

export function searchItems(index: SearchEntry[], query: string, limit = 40) {
	const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
	if (!terms.length) return [];
	const matches: { entry: SearchEntry; score: number; snippet: string }[] = [];
	for (const entry of index) {
		if (!terms.every((term) => entry.all.includes(term))) continue;
		let score = 0;
		for (const term of terms) {
			if (entry.title === term) score += 100;
			else if (entry.title.startsWith(term)) score += 60;
			else if (entry.title.includes(term)) score += 40;
			if (entry.context.includes(term)) score += 16;
			if (entry.body.includes(term)) score += 5;
		}
		const bodyOffset = entry.body.indexOf(
			terms.find((term) => entry.body.includes(term)) ?? "",
		);
		const start = Math.max(0, bodyOffset - 55);
		const snippet = entry.item.body
			.slice(start, start + 160)
			.replace(/\s+/g, " ")
			.trim();
		matches.push({ entry, score, snippet });
	}
	return matches
		.sort(
			(a, b) =>
				b.score - a.score ||
				b.entry.item.updated.localeCompare(a.entry.item.updated),
		)
		.slice(0, limit);
}
