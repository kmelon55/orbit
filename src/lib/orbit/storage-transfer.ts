import { randomUUID } from "node:crypto";
import {
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
	databaseFor,
	getVaultRoot,
	hashFile,
	type MigrationReport,
	scanVault,
	sha256,
	verifiedAssetPath,
	withDatabase,
} from "./database";
import { normalizeFolderMetadata } from "./documents";

function separateDestination(destination: string, root: string) {
	const target = path.resolve(destination),
		source = realpathSync(root);
	// Resolve existing ancestors so a symlink cannot disguise an export into the live vault.
	let ancestor = target;
	while (!existsSync(ancestor)) ancestor = path.dirname(ancestor);
	const resolved = path.join(
		realpathSync(ancestor),
		path.relative(ancestor, target),
	);
	if (
		resolved === source ||
		resolved.startsWith(`${source}${path.sep}`) ||
		source.startsWith(`${resolved}${path.sep}`)
	)
		throw new Error(
			"Choose a destination outside the active Orbit data directory",
		);
	if (existsSync(target))
		throw new Error("Destination already exists; choose a new directory");
	return target;
}

/** Portable content export. Never exports mail credentials, mail drafts or authentication keys. */
export function exportOrbitDirectory(destination: string) {
	return withDatabase(() => {
		const database = databaseFor(),
			target = separateDestination(destination, database.root);
		const staging = `${target}.partial-${randomUUID()}`;
		mkdirSync(staging, { recursive: true, mode: 0o700 });
		try {
			const documents = database.documents(),
				assets = database.assets();
			const manifest: Record<
				string,
				{ hash: string; created: string; modified: string; identity?: string }
			> = {};
			for (const folder of database.folders(""))
				mkdirSync(path.join(staging, folder), { recursive: true });
			for (const document of documents) {
				const full = path.join(staging, document.path);
				mkdirSync(path.dirname(full), { recursive: true });
				writeFileSync(full, document.raw, { flag: "wx", mode: 0o600 });
				manifest[document.path] = {
					hash: sha256(document.raw),
					created: document.created,
					modified: document.modified,
					identity: document.item?.id,
				};
				if (hashFile(full) !== manifest[document.path].hash)
					throw new Error(`Export verification failed: ${document.path}`);
			}
			for (const asset of assets) {
				const full = path.join(staging, asset.path);
				mkdirSync(path.dirname(full), { recursive: true });
				const source = verifiedAssetPath(database, asset);
				copyFileSync(source, full);
				if (hashFile(full) !== hashFile(source))
					throw new Error(`Attachment changed during export: ${asset.path}`);
			}
			mkdirSync(path.join(staging, ".orbit"), { recursive: true });
			writeFileSync(
				path.join(staging, ".orbit", "folders.json"),
				JSON.stringify(
					database.metadata("folders") ?? { version: 1, folders: {} },
					null,
					2,
				),
			);
			writeFileSync(
				path.join(staging, ".orbit", "documents.json"),
				JSON.stringify(manifest, null, 2),
			);
			renameSync(staging, target);
			return {
				destination: target,
				documents: documents.length,
				assets: assets.length,
			};
		} catch (error) {
			rmSync(staging, { recursive: true, force: true });
			throw error;
		}
	});
}

/** Explicit import after migration; identical documents are skipped, conflicting IDs/paths reject the batch. */
export function importOrbitDirectory(source: string) {
	return withDatabase(() => {
		const database = databaseFor(),
			root = realpathSync(path.resolve(source));
		if (
			root === realpathSync(database.root) ||
			root.startsWith(`${realpathSync(database.root)}${path.sep}`)
		)
			throw new Error(
				"Import from a separate directory, not the active data directory",
			);
		const inventory = scanVault(root);
		const counts = { documents: 0, assets: 0, skipped: 0 };
		const assetDirectory = path.join(
			database.root,
			".orbit",
			"assets",
			randomUUID(),
		);
		try {
			for (const folder of inventory.directories) database.mkdir(folder);
			for (const entry of inventory.files) {
				if (entry.raw !== undefined) {
					let current: ReturnType<typeof database.read> | undefined;
					try {
						current = database.read(entry.key);
					} catch (error) {
						if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
					}
					if (current) {
						if (sha256(current.raw) !== entry.hash)
							throw new Error(
								`Import conflicts with existing document: ${entry.key}`,
							);
						counts.skipped++;
						continue;
					}
					database.write(entry.key, entry.raw, true, entry);
					counts.documents++;
				} else {
					const existing = database
						.assets()
						.find((asset) => asset.path === entry.key);
					if (existing) {
						if (hashFile(verifiedAssetPath(database, existing)) !== entry.hash)
							throw new Error(`Import conflicts with attachment: ${entry.key}`);
						counts.skipped++;
						continue;
					}
					// Attachments are immutable copies, not dependencies on the import directory.
					const destination = path.join(assetDirectory, entry.key);
					mkdirSync(path.dirname(destination), { recursive: true });
					copyFileSync(path.join(root, entry.key), destination);
					if (hashFile(destination) !== entry.hash)
						throw new Error(`Attachment changed during import: ${entry.key}`);
					database.sql
						.prepare("INSERT INTO assets VALUES (?,?,?)")
						.run(
							entry.key,
							path
								.relative(database.root, destination)
								.split(path.sep)
								.join("/"),
							entry.hash,
						);
					counts.assets++;
				}
			}
			const folderFile = path.join(root, ".orbit", "folders.json");
			if (existsSync(folderFile)) {
				if (lstatSync(folderFile).isSymbolicLink())
					throw new Error("Folder metadata must not be a symlink");
				const incomingRaw = JSON.parse(readFileSync(folderFile, "utf8")) as {
					version: number;
					folders: Record<string, Record<string, unknown>>;
					treeOrder?: Record<string, Record<string, string[]>>;
				};
				if (incomingRaw.version !== 1 || !incomingRaw.folders)
					throw new Error("Invalid folder metadata");
				const incoming = normalizeFolderMetadata(incomingRaw);
				const current = database.metadata<typeof incoming>("folders") ?? {
					version: 1,
					folders: {},
				};
				for (const [space, folders] of Object.entries(incoming.folders))
					current.folders[space] = { ...folders, ...current.folders[space] };
				for (const [space, order] of Object.entries(incoming.treeOrder ?? {})) {
					current.treeOrder ??= {};
					current.treeOrder[space] = { ...order, ...current.treeOrder[space] };
				}
				database.setMetadata("folders", current);
			}
			return counts;
		} catch (error) {
			rmSync(assetDirectory, { recursive: true, force: true });
			throw error;
		}
	}, true);
}

export function storageStatus() {
	return withDatabase(() => {
		const database = databaseFor();
		return {
			database: database.filename,
			integrity: database.sql.prepare("PRAGMA quick_check").all(),
			migration: database.metadata<MigrationReport>("migration"),
			documents: database.documents().length,
			assets: database.assets().length,
		};
	});
}

/** Live SQLite snapshot plus referenced assets. Auth environment variables must be backed up separately. */
export function backupOrbitDirectory(destination: string) {
	return withDatabase(() => {
		const database = databaseFor(),
			target = separateDestination(destination, database.root),
			staging = `${target}.partial-${randomUUID()}`;
		mkdirSync(path.join(staging, ".orbit"), { recursive: true, mode: 0o700 });
		try {
			database.sql
				.prepare("VACUUM INTO ?")
				.run(path.join(staging, ".orbit", "orbit.sqlite"));
			const snapshot = new DatabaseSync(
				path.join(staging, ".orbit", "orbit.sqlite"),
				{ readOnly: true },
			);
			try {
				const assets = snapshot
					.prepare("SELECT path,source,hash FROM assets")
					.all() as { path: string; source: string; hash: string }[];
				for (const asset of assets) {
					const full = path.join(staging, asset.source);
					mkdirSync(path.dirname(full), { recursive: true });
					copyFileSync(verifiedAssetPath(database, asset), full);
					if (hashFile(full) !== asset.hash)
						throw new Error(`Attachment changed since import: ${asset.path}`);
				}
			} finally {
				snapshot.close();
			}
			writeFileSync(
				path.join(staging, ".orbit", "storage.json"),
				JSON.stringify({
					version: 1,
					database: "orbit.sqlite",
					source: "sqlite",
				}),
			);
			const mailRoot = path.resolve(
				process.env.ORBIT_MAIL_DIR ??
					path.join(getVaultRoot(), ".orbit", "mail"),
			);
			const mailDatabase = path.join(mailRoot, "mail.sqlite");
			if (existsSync(mailDatabase)) {
				const output = path.join(staging, ".orbit", "mail");
				mkdirSync(output, { recursive: true, mode: 0o700 });
				const mail = new DatabaseSync(mailDatabase, { readOnly: true });
				try {
					mail.exec("PRAGMA busy_timeout=10000");
					mail.prepare("VACUUM INTO ?").run(path.join(output, "mail.sqlite"));
				} finally {
					mail.close();
				}
				const key = path.join(mailRoot, "secret.key");
				if (existsSync(key)) copyFileSync(key, path.join(output, "secret.key"));
			}
			renameSync(staging, target);
			return { destination: target, mailIncluded: existsSync(mailDatabase) };
		} catch (error) {
			rmSync(staging, { recursive: true, force: true });
			throw error;
		}
	}, "none");
}
