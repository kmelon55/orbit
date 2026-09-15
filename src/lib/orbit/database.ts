import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import {
	chmodSync,
	closeSync,
	existsSync,
	lstatSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	readSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
	normalizeFolderMetadata,
	parseCanvas,
	parseItem,
	withStableIdentity,
} from "./documents";
import type { OrbitCanvas, OrbitItem } from "./schema";

export type DocumentRecord = {
	path: string;
	raw: string;
	created: string;
	modified: string;
	item: OrbitItem | null;
	canvas: OrbitCanvas | null;
	error: string | null;
};
type Row = {
	path: string;
	raw: string;
	created: string;
	modified: string;
	item: string | null;
	canvas: string | null;
	error: string | null;
};
export type AssetRecord = { path: string; source: string; hash: string };
export type MigrationReport = {
	version: 1;
	completedAt: string;
	documents: number;
	folders: number;
	assets: number;
	warnings: { path: string; reason: string }[];
	hashes: Record<string, string>;
	reassignedIds: { path: string; originalId: string; id: string }[];
};
const ROOTS = [
	"inbox",
	"projects",
	"areas",
	"resources",
	"events",
	"archive",
	"whiteboards",
];
const scope = new AsyncLocalStorage<{
	root: string;
	database: OrbitDatabase;
}>();
const connections = new Map<string, OrbitDatabase>();
const queues = new Map<string, Promise<unknown>>();
export function getVaultRoot() {
	return (
		scope.getStore()?.root ??
		path.resolve(
			process.env.ORBIT_VAULT_DIR ?? process.env.ORBIT_DATA_DIR ?? "vault",
		)
	);
}
export function sha256(data: string | Buffer) {
	return createHash("sha256").update(data).digest("hex");
}
function failure(code: string, message: string): Error {
	return Object.assign(new Error(`${code}: ${message}`), { code });
}
function decode(row: Row): DocumentRecord {
	return {
		...row,
		item: row.item ? JSON.parse(row.item) : null,
		canvas: row.canvas ? JSON.parse(row.canvas) : null,
	};
}
export function documentKind(key: string) {
	return key.endsWith(".excalidraw") || key.endsWith(".excalidraw.md")
		? "canvas"
		: key.endsWith(".md")
			? "item"
			: null;
}

export class OrbitDatabase {
	readonly sql: DatabaseSync;
	readonly filename: string;
	private statements = new Map<string, ReturnType<DatabaseSync["prepare"]>>();
	private prepare(query: string) {
		let statement = this.statements.get(query);
		if (!statement) {
			statement = this.sql.prepare(query);
			this.statements.set(query, statement);
		}
		return statement;
	}
	constructor(readonly root: string) {
		mkdirSync(root, { recursive: true });
		const directory = path.join(root, ".orbit");
		if (existsSync(directory) && lstatSync(directory).isSymbolicLink())
			throw new Error("Orbit metadata directory must not be a symlink");
		mkdirSync(directory, { recursive: true, mode: 0o700 });
		this.filename = path.join(directory, "orbit.sqlite");
		const marker = path.join(directory, "storage.json");
		if (!existsSync(this.filename) && existsSync(marker))
			throw new Error(
				"Orbit database is missing. Restore the database backup; refusing to reimport stale Markdown files.",
			);
		if (existsSync(this.filename) && lstatSync(this.filename).isSymbolicLink())
			throw new Error("Orbit database must not be a symlink");
		this.sql = new DatabaseSync(this.filename);
		chmodSync(this.filename, 0o600);
		this.sql.exec(
			"PRAGMA busy_timeout=10000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;",
		);
		try {
			this.sql.exec("BEGIN IMMEDIATE");
			const version = (
				this.prepare("PRAGMA user_version").get() as {
					user_version: number;
				}
			).user_version;
			if (version > 1)
				throw new Error(
					"Orbit database was created by a newer version. Upgrade Orbit before opening it.",
				);
			this.sql.exec(`CREATE TABLE IF NOT EXISTS documents (
    path TEXT PRIMARY KEY, kind TEXT NOT NULL, raw TEXT NOT NULL, id TEXT UNIQUE,
    item TEXT, canvas TEXT, updated TEXT NOT NULL, created TEXT NOT NULL, modified TEXT NOT NULL, error TEXT, revision INTEGER NOT NULL DEFAULT 0
   );
   CREATE INDEX IF NOT EXISTS documents_kind_updated ON documents(kind, updated DESC);
   CREATE TABLE IF NOT EXISTS directories (path TEXT PRIMARY KEY);
   CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS assets (path TEXT PRIMARY KEY, source TEXT NOT NULL, hash TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS app_state (singleton INTEGER PRIMARY KEY CHECK(singleton=1),revision INTEGER NOT NULL);
   INSERT OR IGNORE INTO app_state VALUES (1,0);`);
			if (
				!(
					this.sql.prepare("PRAGMA table_info(documents)").all() as {
						name: string;
					}[]
				).some((column) => column.name === "revision")
			)
				this.sql.exec(
					"ALTER TABLE documents ADD COLUMN revision INTEGER NOT NULL DEFAULT 0",
				);
			for (const table of ["documents", "directories", "metadata", "assets"])
				for (const operation of ["INSERT", "UPDATE", "DELETE"])
					this.sql.exec(
						`CREATE TRIGGER IF NOT EXISTS revision_${table}_${operation} AFTER ${operation} ON ${table} BEGIN UPDATE app_state SET revision=revision+1 WHERE singleton=1; END;`,
					);

			if (!this.metadata("migration")) {
				if (existsSync(marker))
					throw new Error(
						"Database has no migration record; restore a complete backup.",
					);
				this.migrate();
			}
			for (const key of ROOTS) this.mkdir(key);
			this.sql.exec("PRAGMA user_version=1; COMMIT");
			if (!existsSync(marker))
				writeFileSync(
					marker,
					`${JSON.stringify({ version: 1, database: "orbit.sqlite", source: "sqlite" })}\n`,
					{ flag: "wx", mode: 0o600 },
				);
		} catch (error) {
			if (this.sql.isTransaction) this.sql.exec("ROLLBACK");
			this.sql.close();
			throw error;
		}
	}
	key(value: string) {
		const relative = path.isAbsolute(value)
			? path.relative(this.root, value)
			: value;
		if (relative === "") return "";
		if (
			relative.includes("\\") ||
			relative.includes("\0") ||
			relative.split("/").some((p) => p === "." || p === ".." || p === "") ||
			path.isAbsolute(relative)
		)
			throw new Error("Path escapes the Orbit data directory");
		return relative.normalize("NFC");
	}
	metadata<T>(key: string): T | null {
		const row = this.prepare("SELECT value FROM metadata WHERE key=?").get(
			key,
		) as { value: string } | undefined;
		return row ? JSON.parse(row.value) : null;
	}
	setMetadata(key: string, value: unknown) {
		this.prepare(
			"INSERT INTO metadata VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
		).run(key, JSON.stringify(value));
	}
	read(value: string): DocumentRecord {
		const row = this.prepare("SELECT * FROM documents WHERE path=?").get(
			this.key(value),
		) as Row | undefined;
		if (!row) throw failure("ENOENT", `Document not found: ${this.key(value)}`);
		return decode(row);
	}
	byId(id: string): DocumentRecord | null {
		const row = this.prepare("SELECT * FROM documents WHERE id=?").get(id) as
			| Row
			| undefined;
		return row ? decode(row) : null;
	}
	private projectionCache = new Map<
		string,
		{ revision: number; value: OrbitItem | OrbitCanvas }
	>();
	private lists = new Map<
		string,
		{ revision: number; values: (OrbitItem | OrbitCanvas)[] }
	>();
	private projections(kind: "item" | "canvas") {
		const revision = (
			this.prepare(
				"SELECT revision FROM app_state WHERE singleton=1",
			).get() as { revision: number }
		).revision;
		const cached = this.lists.get(kind);
		if (cached?.revision === revision) return cached.values.slice();
		const rows = this.prepare(
			`SELECT path,revision FROM documents WHERE kind=? AND ${kind} IS NOT NULL ORDER BY updated DESC,path`,
		).all(kind) as { path: string; revision: number }[];
		const existing = new Set<string>();
		const values = rows.map((row) => {
			const key = `${kind}:${row.path}`;
			existing.add(key);
			const found = this.projectionCache.get(key);
			if (found?.revision === row.revision) return found.value;
			const result = this.prepare(
				`SELECT ${kind} AS value FROM documents WHERE path=?`,
			).get(row.path) as { value: string };
			const value = JSON.parse(result.value) as OrbitItem | OrbitCanvas;
			if ("tags" in value) Object.freeze(value.tags);
			Object.freeze(value);
			this.projectionCache.set(key, { revision: row.revision, value });
			return value;
		});
		for (const key of this.projectionCache.keys())
			if (key.startsWith(`${kind}:`) && !existing.has(key))
				this.projectionCache.delete(key);
		this.lists.set(kind, { revision, values });
		return values.slice();
	}
	items(): OrbitItem[] {
		return this.projections("item") as OrbitItem[];
	}
	canvases(): OrbitCanvas[] {
		return this.projections("canvas") as OrbitCanvas[];
	}
	paths(kind: string): string[] {
		return (
			this.prepare("SELECT path FROM documents WHERE kind=? ORDER BY path").all(
				kind,
			) as { path: string }[]
		).map((r) => path.join(this.root, r.path));
	}
	documents(): DocumentRecord[] {
		return (
			this.prepare("SELECT * FROM documents ORDER BY path").all() as Row[]
		).map(decode);
	}
	assets(): AssetRecord[] {
		return this.prepare(
			"SELECT * FROM assets ORDER BY path",
		).all() as AssetRecord[];
	}
	folders(value: string): string[] {
		const prefix = this.key(value);
		const start = prefix ? `${prefix}/` : "";
		return (
			this.prepare(
				"SELECT path FROM directories WHERE substr(path,1,?)=? ORDER BY path",
			).all(start.length, start) as { path: string }[]
		)
			.map((r) => r.path.slice(start.length))
			.filter(Boolean);
	}
	info(value: string) {
		const key = this.key(value);
		const directory =
			key === "" ||
			!!this.prepare("SELECT 1 FROM directories WHERE path=?").get(key);
		if (
			!directory &&
			!this.prepare(
				"SELECT 1 FROM documents WHERE path=? UNION ALL SELECT 1 FROM assets WHERE path=?",
			).get(key, key)
		)
			throw failure("ENOENT", `Path not found: ${key}`);
		return { isDirectory: () => directory };
	}
	mkdir(value: string) {
		const key = this.key(value);
		if (!key) return;
		const parts = key.split("/");
		for (let i = 1; i <= parts.length; i++) {
			const parent = parts.slice(0, i).join("/");
			if (
				this.prepare(
					"SELECT 1 FROM documents WHERE path=? UNION ALL SELECT 1 FROM assets WHERE path=?",
				).get(parent, parent)
			)
				throw failure("ENOTDIR", `Document occupies directory: ${parent}`);
			this.prepare("INSERT OR IGNORE INTO directories VALUES (?)").run(parent);
		}
	}
	write(
		value: string,
		raw: string,
		exclusive = false,
		dates?: { created: string; modified: string; identity?: string },
	) {
		const key = this.key(value);
		const kind = documentKind(key);
		if (!kind) throw new Error(`Unsupported document: ${key}`);
		const existing = this.prepare(
			"SELECT created,id FROM documents WHERE path=?",
		).get(key) as { created: string; id: string | null } | undefined;
		if (
			this.prepare(
				"SELECT 1 FROM directories WHERE path=? UNION ALL SELECT 1 FROM assets WHERE path=?",
			).get(key, key) ||
			(exclusive && existing)
		)
			throw failure("EEXIST", `Path already exists: ${key}`);
		const created =
			dates?.created ?? existing?.created ?? new Date().toISOString();
		const modified = dates?.modified ?? new Date().toISOString();
		let item: OrbitItem | null = null;
		let canvas: OrbitCanvas | null = null;
		let error: string | null = null;
		try {
			if (kind === "item") {
				item = parseItem(
					raw,
					key,
					created,
					modified,
					existing?.id ?? undefined,
				);
				if (!item) error = "Invalid note metadata";
			} else canvas = parseCanvas(raw, key, created, modified);
		} catch {
			error = "Invalid document syntax";
		}
		if (item && dates?.identity) item.id = dates.identity;
		const parent = path.posix.dirname(key);
		if (parent !== ".") this.mkdir(parent);
		try {
			this.prepare(`INSERT INTO documents(path,kind,raw,id,item,canvas,updated,created,modified,error,revision) VALUES (?,?,?,?,?,?,?,?,?,?,(SELECT revision+1 FROM app_state WHERE singleton=1))
    ON CONFLICT(path) DO UPDATE SET kind=excluded.kind,raw=excluded.raw,id=excluded.id,item=excluded.item,canvas=excluded.canvas,updated=excluded.updated,modified=excluded.modified,error=excluded.error,revision=excluded.revision`).run(
				key,
				kind,
				raw,
				item?.id ?? null,
				item ? JSON.stringify(item) : null,
				canvas ? JSON.stringify(canvas) : null,
				item?.updated ?? canvas?.updated ?? modified,
				created,
				modified,
				error,
			);
		} catch (cause) {
			throw new Error(
				`Cannot store ${key}: duplicate note ID or invalid database state`,
				{ cause },
			);
		}
	}
	remove(value: string) {
		if (
			!this.prepare("DELETE FROM documents WHERE path=?").run(this.key(value))
				.changes
		)
			throw failure("ENOENT", "Document not found");
	}
	rmdir(value: string) {
		const key = this.key(value);
		if (ROOTS.includes(key) || !key)
			throw new Error("Cannot remove a root folder");
		const prefix = `${key}/`;
		if (
			this.prepare(
				"SELECT 1 FROM directories WHERE substr(path,1,?)=? UNION ALL SELECT 1 FROM documents WHERE substr(path,1,?)=? UNION ALL SELECT 1 FROM assets WHERE substr(path,1,?)=?",
			).get(prefix.length, prefix, prefix.length, prefix, prefix.length, prefix)
		)
			throw failure("ENOTEMPTY", "Folder is not empty");
		if (!this.prepare("DELETE FROM directories WHERE path=?").run(key).changes)
			throw failure("ENOENT", "Folder not found");
	}
	move(from: string, to: string) {
		const source = this.key(from),
			destination = this.key(to);
		if (source === destination) return;
		this.info(source);
		try {
			this.info(destination);
			throw failure("EEXIST", "Destination already exists");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		if (!source || destination.startsWith(`${source}/`))
			throw new Error("Cannot move a folder inside itself");
		const prefix = `${source}/`;
		const docs = (
			this.prepare(
				"SELECT * FROM documents WHERE path=? OR substr(path,1,?)=?",
			).all(source, prefix.length, prefix) as Row[]
		).map(decode);
		const dirs = this.prepare(
			"SELECT path FROM directories WHERE path=? OR substr(path,1,?)=? ORDER BY length(path)",
		).all(source, prefix.length, prefix) as { path: string }[];
		const assets = this.assets().filter(
			(r) => r.path === source || r.path.startsWith(prefix),
		);
		for (const doc of docs) this.remove(doc.path);
		for (const dir of dirs)
			this.prepare("DELETE FROM directories WHERE path=?").run(dir.path);
		for (const asset of assets)
			this.prepare("DELETE FROM assets WHERE path=?").run(asset.path);
		for (const dir of dirs)
			this.mkdir(destination + dir.path.slice(source.length));
		for (const doc of docs) {
			const moved = destination + doc.path.slice(source.length);
			this.write(
				moved,
				doc.item ? withStableIdentity(doc.raw, doc.item) : doc.raw,
				true,
				{
					created: doc.created,
					modified: doc.modified,
				},
			);
			// Legacy notes without an explicit ID keep their original identity after a move.
			if (doc.item) {
				const item = this.read(moved).item;
				if (item) {
					item.id = doc.item.id;
					this.prepare("UPDATE documents SET id=?,item=? WHERE path=?").run(
						item.id,
						JSON.stringify(item),
						moved,
					);
				}
			}
		}
		for (const asset of assets)
			this.prepare("INSERT INTO assets VALUES (?,?,?)").run(
				destination + asset.path.slice(source.length),
				asset.source,
				asset.hash,
			);
	}
	clearProjectionCache() {
		this.projectionCache.clear();
		this.lists.clear();
	}
	private migrate() {
		const report: MigrationReport = {
			version: 1,
			completedAt: new Date().toISOString(),
			documents: 0,
			folders: 0,
			assets: 0,
			warnings: [],
			hashes: {},
			reassignedIds: [],
		};
		const { files: inventory, directories } = scanVault(this.root);
		for (const dir of directories) this.mkdir(dir);
		for (const entry of inventory) {
			const hash = entry.hash;
			report.hashes[entry.key] = hash;
			if (entry.raw !== undefined) {
				const raw = entry.raw;
				let identity = entry.identity;
				let originalId: string | undefined;
				try {
					originalId =
						identity ??
						parseItem(raw, entry.key, entry.created, entry.modified)?.id;
				} catch {
					/* Preserve invalid raw documents as well. */
				}
				if (originalId && this.byId(originalId)) {
					let attempt = 0;
					do {
						identity = `${originalId}~${sha256(`${entry.key}:${attempt++}`).slice(0, 16)}`;
					} while (this.byId(identity));
					report.reassignedIds.push({
						path: entry.key,
						originalId,
						id: identity,
					});
				}
				this.write(entry.key, raw, true, { ...entry, identity });
				report.documents++;
				const stored = this.read(entry.key);
				if (sha256(stored.raw) !== hash)
					throw new Error(`Migration verification failed: ${entry.key}`);
				if (stored.error)
					report.warnings.push({ path: entry.key, reason: stored.error });
			} else {
				this.prepare("INSERT INTO assets VALUES (?,?,?)").run(
					this.key(entry.key),
					entry.key,
					hash,
				);
				report.assets++;
			}
		}
		const metadataPath = path.join(this.root, ".orbit", "folders.json");
		let metadataBytes: Buffer | undefined;
		if (existsSync(metadataPath)) {
			if (lstatSync(metadataPath).isSymbolicLink())
				throw new Error("Folder metadata must not be a symlink");
			metadataBytes = readFileSync(metadataPath);
			const metadata = JSON.parse(metadataBytes.toString("utf8")) as {
				version?: number;
				folders?: unknown;
			};
			if (metadata.version !== 1 || !metadata.folders)
				throw new Error(
					"Invalid folders.json; migration stopped without changing original files",
				);
			this.setMetadata(
				"folders",
				normalizeFolderMetadata(
					metadata as { version: number; folders: Record<string, unknown> },
				),
			);
			report.hashes[".orbit/folders.json"] = sha256(metadataBytes);
		}
		// A changing source must never yield a silently partial migration.
		const verified = scanVault(this.root);
		if (
			JSON.stringify(inventory.map((e) => [e.key, e.hash])) !==
				JSON.stringify(verified.files.map((e) => [e.key, e.hash])) ||
			JSON.stringify(directories) !== JSON.stringify(verified.directories) ||
			(metadataBytes &&
				sha256(readFileSync(metadataPath)) !== sha256(metadataBytes)) ||
			(!metadataBytes && existsSync(metadataPath))
		)
			throw new Error(
				"Vault changed during migration. Stop external writers and retry.",
			);
		report.folders = directories.length;
		this.setMetadata("migration", report);
	}
}

export function databaseFor(root = getVaultRoot()) {
	const active = scope.getStore();
	if (active?.root === root) return active.database;
	let database = connections.get(root);
	if (!database) {
		database = new OrbitDatabase(root);
		connections.set(root, database);
	}
	return database;
}
// Hold one SQL transaction across each public operation, including folder moves/undo.
// AsyncLocalStorage lets nested business operations participate without deadlocking.
export function withDatabase<T>(
	work: () => Promise<T> | T,
	write: boolean | "none" = false,
): Promise<T> {
	if (scope.getStore()) return Promise.resolve().then(work);
	const root = getVaultRoot();
	const result = (queues.get(root) ?? Promise.resolve())
		.catch(() => {})
		.then(async () => {
			const database = databaseFor(root);
			if (write !== "none")
				database.sql.exec(write ? "BEGIN IMMEDIATE" : "BEGIN");
			try {
				const value = await scope.run({ root, database }, work);
				if (write !== "none") database.sql.exec("COMMIT");
				return value;
			} catch (error) {
				if (database.sql.isTransaction) database.sql.exec("ROLLBACK");
				database.clearProjectionCache();
				throw error;
			}
		});
	queues.set(root, result);
	return result;
}
export function closeOrbitDatabases() {
	for (const database of connections.values()) database.sql.close();
	connections.clear();
	queues.clear();
}
export function verifiedAssetPath(database: OrbitDatabase, asset: AssetRecord) {
	database.key(asset.source);
	const full = path.join(database.root, asset.source);
	const real = realpathSync(full),
		root = realpathSync(database.root);
	if (!real.startsWith(`${root}${path.sep}`))
		throw new Error("Attachment escapes the data directory");
	return full;
}

export type VaultEntry = {
	identity?: string;
	key: string;
	raw?: string;
	hash: string;
	created: string;
	modified: string;
};
export function hashFile(filename: string) {
	const hash = createHash("sha256"),
		fd = openSync(filename, "r"),
		buffer = Buffer.allocUnsafe(1024 * 1024);
	try {
		while (true) {
			const count = readSync(fd, buffer, 0, buffer.length, null);
			if (count === 0) break;
			hash.update(buffer.subarray(0, count));
		}
		return hash.digest("hex");
	} finally {
		closeSync(fd);
	}
}
export function scanVault(root: string) {
	const files: VaultEntry[] = [],
		directories: string[] = [];
	const walk = (directory: string) => {
		for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
			(a, b) => a.name.localeCompare(b.name),
		)) {
			if (entry.name.startsWith(".")) continue;
			const full = path.join(directory, entry.name),
				key = path.relative(root, full).split(path.sep).join("/");
			if (entry.isSymbolicLink())
				throw new Error(
					`Migration refuses symlinks: ${key}. Copy the target into the vault first.`,
				);
			if (entry.isDirectory()) {
				directories.push(key);
				walk(full);
			} else if (entry.isFile()) {
				const stats = lstatSync(full);
				let raw: string | undefined;
				if (documentKind(key)) {
					const bytes = readFileSync(full);
					raw = bytes.toString("utf8");
					if (!Buffer.from(raw).equals(bytes))
						throw new Error(`Document is not UTF-8: ${key}`);
				}
				files.push({
					key,
					raw,
					hash: raw === undefined ? hashFile(full) : sha256(raw),
					created: stats.birthtime.toISOString(),
					modified: stats.mtime.toISOString(),
				});
			}
		}
	};
	walk(root);
	const normalized = new Map<string, string>();
	for (const key of [...directories, ...files.map((file) => file.key)]) {
		const canonical = key.normalize("NFC");
		const previous = normalized.get(canonical);
		if (previous && previous !== key)
			throw new Error(`Unicode path collision: ${previous} and ${key}`);
		normalized.set(canonical, key);
	}

	const manifest = path.join(root, ".orbit", "documents.json");
	if (existsSync(manifest)) {
		if (lstatSync(manifest).isSymbolicLink())
			throw new Error("Export manifest must not be a symlink");
		const saved = JSON.parse(readFileSync(manifest, "utf8")) as Record<
			string,
			{ hash: string; created: string; modified: string; identity?: string }
		>;
		for (const file of files) {
			const old = saved[file.key];
			if (old && old.hash === file.hash) {
				if (
					!Number.isFinite(Date.parse(old.created)) ||
					!Number.isFinite(Date.parse(old.modified))
				)
					throw new Error("Invalid exported document dates");
				file.created = old.created;
				file.modified = old.modified;
				if (old.identity !== undefined) {
					if (typeof old.identity !== "string" || !old.identity)
						throw new Error("Invalid exported identity");
					file.identity = old.identity;
				}
			}
		}
	}
	return { files, directories };
}
