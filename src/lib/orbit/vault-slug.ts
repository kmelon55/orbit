function withoutControlCharacters(value: string) {
	return [...value]
		.filter((character) => {
			const codePoint = character.codePointAt(0) ?? 0;
			return codePoint > 31 && codePoint !== 127;
		})
		.join("");
}

/**
 * Produces one portable path segment for local files and future S3 object keys.
 * Unicode is kept readable, but normalized so macOS and object storage do not
 * create visually identical keys with different byte sequences.
 */
export function toVaultSlug(value: string, fallback = "untitled") {
	const slug = withoutControlCharacters(value.normalize("NFC"))
		.trim()
		.toLowerCase()
		.replace(/[\\/]+/g, "-")
		.replace(/[^\p{Letter}\p{Number}._-]+/gu, "-")
		.replace(/-+/g, "-")
		.replace(/^[.-]+|[.-]+$/g, "")
		.slice(0, 72);

	return slug || fallback;
}
