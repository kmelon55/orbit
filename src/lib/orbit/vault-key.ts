import path from "node:path";

export { toVaultSlug } from "./vault-slug";

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
