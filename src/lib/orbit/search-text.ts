/** Shared by notes, cached mail and assistant retrieval. Keep field boundaries. */
export function normalizeSearchText(value: string) {
	return value.normalize("NFKC").toLowerCase().replace(/\s+/gu, "");
}

export function searchTerms(query: string) {
	return query
		.normalize("NFKC")
		.toLowerCase()
		.trim()
		.split(/\s+/u)
		.filter(Boolean);
}

export function matchesSearch(fields: string[], query: string) {
	const text = fields.map(normalizeSearchText).join("\0");
	return searchTerms(query).every((term) => text.includes(term));
}

/** Convert a compact-text match back to the original text before excerpting. */
export function searchSnippet(text: string, terms: string[], length = 160) {
	const compact = normalizeSearchText(text);
	const term = terms.find((value) => compact.includes(value));
	const hit = term ? compact.indexOf(term) : 0;
	let offset = 0;
	if (hit > 0) {
		let normalizedOffset = 0;
		for (const segment of new Intl.Segmenter(undefined, {
			granularity: "grapheme",
		}).segment(text)) {
			const size = normalizeSearchText(segment.segment).length;
			if (normalizedOffset + size > hit) {
				offset = segment.index;
				break;
			}
			normalizedOffset += size;
		}
	}
	const start = Math.max(0, offset - 55);
	return text
		.slice(start, start + length)
		.replace(/\s+/gu, " ")
		.trim();
}
