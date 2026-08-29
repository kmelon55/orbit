import path from "node:path";

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

/** Convert an absolute vault file path to a stable, POSIX-style object key. */
export function toVaultObjectKey(vaultRoot: string, filePath: string) {
	const root = path.resolve(vaultRoot);
	const target = path.resolve(filePath);
	const relativePath = path.relative(root, target);
	if (
		!relativePath ||
		relativePath === ".." ||
		relativePath.startsWith(`..${path.sep}`) ||
		path.isAbsolute(relativePath)
	) {
		throw new Error("Path is not a vault object");
	}

	return relativePath
		.split(path.sep)
		.map((segment) => segment.normalize("NFC"))
		.join("/");
}

export function splitVaultObjectKey(key: string) {
	return key.split("/").filter(Boolean);
}
