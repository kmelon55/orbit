# Orbit architecture

Orbit is a personal, self-hosted workspace. One Node process serves the web app and mail worker; a persistent data directory holds embedded SQLite databases and attachments. No separate database service is required.

## Storage contract

```text
Web UI / local MCP → store.ts transaction boundary → store-operations.ts
                                      ↓
                             database.ts (SQLite)
                                      ↓
ORBIT_VAULT_DIR/.orbit/orbit.sqlite + attachment files
```

`ORBIT_VAULT_DIR` takes precedence over the compatibility alias `ORBIT_DATA_DIR`. The default is `./vault`; production should use `/vault` or another persistent directory outside the application checkout.

- `documents`: complete Markdown/YAML or Excalidraw source text, stable identity, logical path, timestamps, and parsed item/canvas projections. Unknown frontmatter and invalid imported documents are retained in the original source text. Invalid documents remain exportable and appear in the migration report, but are excluded from the app's normal item list.
- `directories`: logical folders, including empty folders. Item paths are portable NFC/POSIX paths, not promises that a live Markdown file exists on disk.
- `metadata`: folder colors, mixed tree ordering, and the original migration manifest.
- `assets`: logical attachment paths and their physical source paths. Existing attachments remain untouched at their old disk locations. Explicit imports copy new attachments beneath `.orbit/assets/`. Folder moves change logical references, not original attachment bytes.
- `app_state`: persistent change counter. Parsed list caches are invalidated by transactions from the web process or a separate MCP process. Individual projections are refreshed by row revision, so a single save does not reparse every note.

Notes, tasks, and events remain one item model. A note body is still Markdown; the database also retains the complete Markdown/YAML document for lossless migration and export. Normal writes update raw text and projections in the same transaction. This is one authoritative store, not a bidirectional Markdown mirror.

## Atomicity and concurrency

Every public storage operation enters a SQLite transaction. Writes use `BEGIN IMMEDIATE`; nested operations, undo and folder moves share that transaction through AsyncLocalStorage. Failed operations roll back, and cache entries from failed transactions are discarded. WAL, a busy timeout, and `synchronous=FULL` are enabled. Prepared statements are reused for normal queries.

Run one application replica with the database on a local filesystem. Multiple browsers and local MCP processes access it through the storage API; do not mount the database over SMB/NFS or synchronize a live SQLite file between machines. High availability or multiple application replicas require a separate design.

Undo records remain bounded, process-local history. They do not survive a server restart. Changed-field conflict checks preserve subsequent edits; a failed undo never overwrites another item at the old path.

## Existing-vault migration

On first open, Orbit imports non-hidden Markdown, Excalidraw documents, all visible directories, attachments and `.orbit/folders.json` in one transaction. It verifies each stored document against the source SHA-256 and rescans the source before committing. Original documents and attachments are never rewritten or deleted.

Duplicate legacy note IDs are preserved as separate documents: the first keeps its original ID, later paths receive deterministic distinct IDs. The `reassignedIds` migration report records every mapping. Existing ambiguous links to the original ID still refer to the first item; no automatic guess is made about their intended target. Export metadata preserves remapped identities. Distinct source paths that normalize to the same Unicode path fail migration rather than overwrite each other.

Unreadable files, symlinks, non-UTF-8 documents or invalid folder metadata stop migration. Fix the source and retry. A committed migration is never repeated; `.orbit/storage.json` prevents silent reimport if the database is missing. After conversion, editing old `.md` files does not edit Orbit. Use the application, MCP or explicit imports.

The SQLite schema uses `PRAGMA user_version`. Newer schema versions are rejected by older applications. Data migrations must be explicit, transactional and tested against existing data.

## Portability, backup and AI

`pnpm storage export <new-directory>` exports current document sources, folders, attachments, colors, order and document timestamp/identity metadata. `pnpm storage import <directory>` imports a separate directory transactionally; identical contents are skipped and conflicting paths/IDs abort the batch. `pnpm migrate:obsidian` stages the existing Obsidian format conversion before importing into SQLite.

`pnpm storage backup <new-directory>` creates SQLite snapshots and copies attachments. It includes the mail database and key file when present, but environment-provided secrets must be backed up separately. See [vault and backup](./vault-and-backup.md).

The local stdio MCP server uses the same storage API and transactions as the web app. AI providers are optional. Direct raw SQL writes by external tools are unsupported because they can bypass projections and migration rules.

## Mail

Mail remains in `.orbit/mail/mail.sqlite` with its own encryption key and lifecycle. Provider mailbox content is fetched as needed; drafts, account credentials and notification state are durable application data, not disposable cache. The core database migration does not modify mail data. See [mail operations](./mail.md).
