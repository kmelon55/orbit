# Data, migration and backup

Orbit stores application data in `<ORBIT_VAULT_DIR>/.orbit/orbit.sqlite`. Keep the entire data directory on persistent local storage. Legacy Markdown files are retained as migration originals; they stop receiving edits after conversion.

## Easy self-hosting

```bash
cp .env.example .env
# Edit .env: set ORBIT_AUTH_PASSWORD to a unique long password.
docker compose up -d --build
```

Compose builds the image from this checkout and persists data in the `orbit-data` named volume. It binds to `127.0.0.1:3000` by default. Use your existing HTTPS reverse proxy; set `ORBIT_PUBLIC_URL` to its public origin for Gmail/push. A reverse proxy in another container needs an appropriate shared Docker network or an explicitly reachable host binding. Set `ORBIT_BIND_ADDRESS`/`ORBIT_PORT` when needed. There is no PostgreSQL container to configure.

**Existing deployments:** keep your current `/vault` mount. Do not replace it with a new empty Compose volume. Back up that directory and stop old Orbit instances/external Markdown writers before starting this version. Only the new version should write application data after migration.

The first data load migrates the old vault automatically. For a manual migration/status check:

```bash
ORBIT_VAULT_DIR=/absolute/data/path pnpm storage migrate
ORBIT_VAULT_DIR=/absolute/data/path pnpm storage status
```

The report includes counts, source hashes, invalid-document warnings and any reassigned duplicate IDs. Failure rolls back the import and keeps all originals. First load is slower because it verifies the source; subsequent requests use SQLite. If `storage.json` exists but the database is missing, restore a backup. Never delete that marker to force old files to overwrite newer data.

## Portable Markdown export / import

```bash
ORBIT_VAULT_DIR=/absolute/data/path pnpm storage export /absolute/new-export
ORBIT_VAULT_DIR=/absolute/data/path pnpm storage import /absolute/source-export
pnpm migrate:obsidian -- /absolute/obsidian-vault --dry-run
pnpm migrate:obsidian -- /absolute/obsidian-vault
```

Exports must target a new directory outside the active data directory. The export includes current `.md`/Excalidraw sources, attachments, empty folders and `.orbit/folders.json`. Keep `.orbit/documents.json` to preserve original fallback timestamps and remapped IDs on reimport. It contains no mail credentials. Import does not overwrite different documents with the same path/ID. Rename or resolve conflicts deliberately, then retry.

The bundled CLI also runs inside the production container without installing development dependencies:

```bash
docker compose exec orbit node /app/.output/orbit-storage.cjs status
docker compose exec orbit node /app/.output/orbit-storage.cjs export /tmp/orbit-export
docker compose cp orbit:/tmp/orbit-export ./orbit-export
```

A portable content export is not a full backup: mail accounts, mail drafts and push state are intentionally excluded.

## Full backup

```bash
ORBIT_VAULT_DIR=/absolute/data/path pnpm storage backup /absolute/new-backup
# Or inside Docker; use a new name for each snapshot:
docker compose exec orbit node /app/.output/orbit-storage.cjs backup /tmp/orbit-backup
docker compose cp orbit:/tmp/orbit-backup ./orbit-backup
```

The command uses SQLite `VACUUM INTO` for consistent database snapshots, includes referenced attachments, and copies the optional mail SQLite database and `secret.key`. Core and mail snapshots are taken sequentially, not in one cross-database transaction. The directory is sensitive and should be stored privately. If `ORBIT_MAIL_ENCRYPTION_KEY` comes from the environment, preserve that exact secret separately, along with login and deployment configuration. A custom `ORBIT_MAIL_DIR` is collected under `.orbit/mail` in the backup; restore to the default layout or copy it back to the configured location.

Do not copy just `orbit.sqlite` or `mail.sqlite` while Orbit runs: committed changes may still be in their `-wal` files. A simple alternative is to stop Orbit and all MCP writers, then copy the **entire** data directory. Git or R2 uploads should use a completed export/backup directory, not the live SQLite files. Remote storage is a backup destination, not the application's writable filesystem.

## Restore

1. Stop Orbit and any MCP writers. Keep the old data directory until verification finishes.
2. Restore a full backup into a separate directory; retain `.orbit/storage.json`, the database, attachment paths and mail keys together.
3. Run `ORBIT_VAULT_DIR=/restored/path pnpm storage status`; confirm `quick_check: ok` and expected counts.
4. Point the existing `/vault` mount at that directory, restore environment secrets and start Orbit. Check notes, folder ordering, canvases and mail configuration.

Returning to a Markdown-based older Orbit release requires an export of current content into a separate directory. The untouched migration originals contain only the state from before conversion.
