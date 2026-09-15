# SQLite migration verification

Verified locally on 2026-09-15. This is local implementation evidence, not production deployment or real mail-provider/device verification.

## Data preservation

A separate copy of the existing vault was read with the pre-change Markdown implementation, then migrated with the new implementation:

- 991 notes/tasks/events, 11 Excalidraw documents, 35 logical folders and 244 attachments.
- All 1,002 document sources verified byte-for-byte by SHA-256; original files were not rewritten.
- One duplicate legacy note ID retained both documents, with a deterministic ID assigned to the later path and recorded in the migration report.
- Item/canvas values, folder metadata, tree ordering and counts matched after accounting for that ID mapping and normalization of duplicate NFD/NFC folder entries in the old filesystem view.
- The local development vault was subsequently migrated and browser-tested. The temporary verification note was deleted.

## Performance

Synthetic vault: 1,500 Markdown notes across 30 project folders, approximately 60 repeated sentences per note. Each warm operation was sampled 30 times, on Node 24.20.0, on the same local machine. Baseline was a saved copy of the working Markdown store before this change, including its existing parsed-file cache.

| Server-side operation | Markdown median | SQLite median |
| --- | ---: | ---: |
| Full workspace snapshot, unchanged data | 7.582 ms | 0.540 ms |
| Read one note | 0.140 ms | 0.062 ms |
| Save one changed note | 0.361 ms | 0.143 ms |

The initial SQLite load included migration and source verification: 330.572 ms, compared with 98.151 ms for the baseline initial read. This cost is paid once for a legacy vault. These measurements exclude network transfer, frontend rendering and autosave debounce; they are not whole-app speedup claims. Saves use SQLite WAL with `synchronous=FULL`; write latency remains dependent on the storage device.

Run `pnpm benchmark:storage` for the current implementation. To compare, pass the path to a preserved previous `store.ts` module with its original sibling modules and dependencies available: `pnpm benchmark:storage -- /absolute/baseline/store.ts`. The script uses and removes temporary synthetic vaults, never personal data.

## Checks

- 69 unit tests, TypeScript and Biome passed (one pre-existing sidebar cookie warning).
- Storage migration tests cover raw preservation, invalid sources, duplicate identities, export round trips, backup restore, atomic failure, parallel mutations, cross-process cache invalidation and Unicode folder metadata.
- Node 22.16 compatibility verified, including storage tests and the built production runtime.
- Built runtime verified authenticated Inbox rendering from a migrated fixture, Mail API access and rejection of unauthenticated/cross-origin requests.
- Bundled production CLI verified on Node 22.16: import, status, export, binary attachments, core/mail SQLite snapshots, key preservation and restored integrity.
- Existing Orca browser/dev server verified note creation, title/body autosave, reload persistence and cleanup. No external browser or replacement dev server was started.
- Docker CLI was unavailable (`docker: command not found`), so the image/Compose container itself was not run. The Dockerfile includes the tested bundled CLI through `.output`.
- No production deployment, Git commit or push was performed.
