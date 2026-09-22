<div align="center">
  <img src="./public/orbit.png" width="72" alt="Orbit logo" />
  <h1>Orbit</h1>
  <p><strong>A small personal workspace for notes, tasks, and time.</strong></p>
  <p>Capture first. Organize only when it helps. Keep your data on your own server.</p>
  <p><a href="./README.ko.md">한국어</a></p>
</div>

Orbit is a lightweight, self-hosted personal knowledge and planning tool.

It is built for people who like the idea of a personal knowledge system but do not want to maintain a complex collection of databases, properties, plugins, and separate apps. Orbit keeps the loop intentionally small: write something down, turn it into a task or event when needed, and file it with PARA when it becomes useful.

Notes, tasks, and calendar events live in embedded SQLite, with portable Markdown import and export. The core works without an AI provider, and the next major layer is optional AI that helps you find and organize your own information without silently rewriting it.

## What works today

| Area | Current behavior |
| --- | --- |
| Capture | Create notes, tasks, and events from Today, Inbox, or the mobile quick-capture flow. Supported browsers can also use speech input. |
| Notes | Edit Markdown with background autosave, GFM preview, tags, internal note links, optional Vim mode, and archive/delete actions. |
| Tasks | See open and completed tasks, grouped as overdue, today, upcoming, or unscheduled. Complete, edit, file, or drag tasks to today or tomorrow. |
| Calendar | Day, week, and month views for tasks and events, including timed and multi-day events. Create, move, and resize scheduled items. |
| Today | See today's tasks and events together, alongside active project folders and quick capture. |
| PARA | File items into Projects, Areas, Resources, or Archive. Create and manage nested folders without inventing a database schema first. |
| Whiteboards | Create, rename, edit, and autosave Excalidraw-compatible whiteboard files. Notes can link to whiteboards. |
| Mobile | Responsive navigation, a dedicated capture route, install guidance, and a PWA manifest. Private pages and note data are not cached for offline use. |
| Self-hosting | One Docker container, one persistent vault directory, and built-in single-user password authentication. SQLite is embedded; no separate database service is required. |
| MCP | A working local stdio server exposes nine tools against the same vault used by the web app. |

Not implemented yet: built-in AI, AI-assisted organization, a review screen for AI changes, calendar sync, automatic backups, multi-user collaboration, or a remote HTTP MCP endpoint.

## The workflow

```text
Capture -> Today / Tasks / Calendar -> PARA when useful -> Archive
                  |
           SQLite + attachments
                  |
             Web UI and MCP
```

PARA is a filing policy, not a structure you must maintain before you can write. Inbox holds unprocessed notes and links. Confirming an item as a task or event removes it from Inbox; manage it in Tasks or Calendar. Tasks do not require a project or date. When an item gains a clear context, move it into a Project, Area, or Resource. The organize tray and task location picker share folder search, expandable folders, and recent destinations. Clicking a folder only browses; use the explicit move button after checking the path, or drop an item on its destination. Holding a dragged item over a folder expands it; list edges scroll automatically. Undo item creation, deletion, archiving, moves, completion, type conversion, date changes, and color changes from their notifications or with Cmd+Z / Ctrl+Z outside text editors. The current session retains up to 200 item actions; undo restores only values changed by that action. Text editing uses the editor’s own undo history.

## Quick start

Requirements: Node.js 22 or later and pnpm 10 or later.

```bash
git clone https://github.com/kmelon55/orbit.git
cd orbit
pnpm install
cp .env.example .env
pnpm dev
```

By default, Orbit stores private data in `./vault`, which is excluded from Git and Docker build context. For real use, point Orbit to a directory outside the source repository:

```dotenv
ORBIT_VAULT_DIR=/absolute/path/to/orbit-vault
ORBIT_AUTH_USERNAME=orbit
ORBIT_AUTH_PASSWORD=replace-with-a-long-random-password
```

`ORBIT_DATA_DIR` remains available for backward compatibility. Authentication may be omitted during local development. Initial production setup requires both authentication variables. `ORBIT_AUTH_SESSION_DAYS` can change the default 180-day session lifetime to a value from 1 to 365.

Sign in with the initial server-configured password, then open **Settings → Account → Change password**. Enter your current password and a new password of at least 12 characters. This device stays signed in; sessions on other devices are invalidated. Password changes require an authenticated session.

The new credential is stored as a scrypt hash with a separate session key in `<ORBIT_VAULT_DIR>/.orbit/auth.json` (0600 permissions). It survives redeployment on the persistent volume and takes precedence over the bootstrap `ORBIT_AUTH_PASSWORD`; keep `ORBIT_AUTH_USERNAME` configured. Include this file in private volume backups; note exports do not include it. Corrupt credentials fail closed instead of restoring the initial password.

For administrator recovery, stop the service, move `auth.json` to a secure backup location, set a new `ORBIT_AUTH_PASSWORD`, and restart. Sign in and change it again through account settings. Routine password changes require no restart.

## Your data

`<ORBIT_VAULT_DIR>/.orbit/orbit.sqlite` is the authoritative store. Note bodies remain Markdown; attachments remain separate files. Existing vaults migrate automatically on first open, with source verification and no changes to the original files. Those original `.md` files stop receiving edits after conversion.

```bash
pnpm storage status
pnpm storage export /absolute/new-export
pnpm storage import /absolute/source-export
pnpm storage backup /absolute/new-backup
```

Set the same `ORBIT_VAULT_DIR` for every command. Folder colors/order, whiteboards and unknown frontmatter are preserved. See [data operations](./docs/vault-and-backup.md) for migration, Docker and restore instructions, and [architecture](./docs/architecture.md) for the storage contract.

## MCP

Orbit includes a local stdio MCP server. It is a real adapter over the same vault as the web application; it is not a hosted endpoint and does not use the web login session.

```bash
ORBIT_VAULT_DIR=/absolute/path/to/orbit-vault pnpm mcp
```

Example client configuration:

```json
{
  "mcpServers": {
    "orbit": {
      "command": "pnpm",
      "args": ["--dir", "/absolute/path/to/orbit", "mcp"],
      "env": {
        "ORBIT_VAULT_DIR": "/absolute/path/to/orbit-vault"
      }
    }
  }
}
```

Available tools:

- `orbit_capture`
- `orbit_today`
- `orbit_inbox`
- `orbit_list`
- `orbit_read`
- `orbit_file`
- `orbit_create_folder`
- `orbit_calendar`
- `orbit_search`

The MCP process has direct read/write access to the configured vault. Run it only from a client and machine you trust.

## Docker

For easy installation use the included `compose.yaml` and [operations guide](./docs/vault-and-backup.md). Existing deployments should retain their `/vault` mount.

```bash
docker build -t orbit .
docker run --rm -p 3000:3000 \
  -e ORBIT_VAULT_DIR=/vault \
  -e ORBIT_AUTH_USERNAME=orbit \
  -e ORBIT_AUTH_PASSWORD='replace-with-a-long-random-password' \
  -v orbit-vault:/vault \
  orbit
```

The application directory is disposable; `/vault` is the persistent data boundary. Put TLS in front of the container for any network deployment.

## Roadmap

The next milestone is not more workspace machinery. It is a small, reviewable AI layer on top of the working personal system:

1. Add bring-your-own-key AI provider settings.
2. Search, summarize, and ask questions across notes, tasks, and events.
3. Suggest titles, tags, dates, and PARA destinations.
4. Show every proposed file change before it is applied.
5. Improve the backup and restore experience.
6. Add calendar import/export and sync only after the local calendar contract is stable.

See the [detailed roadmap](./docs/roadmap.md).

Orbit is deliberately not trying to become a team wiki, a database builder, a plugin marketplace, or an autonomous agent that continuously reorganizes your files.

## Development

```bash
pnpm test       # Biome, TypeScript, and unit tests
pnpm build      # production build
pnpm mcp        # local stdio MCP server
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a change.

## Principles

- Data stays on your server and remains portable through Markdown import/export.
- Notes, tasks, and time belong in one small personal loop.
- Capture should require less effort than organizing.
- AI is optional and proposes changes for review.
- Self-hosting should remain understandable: one app, one data directory, no separate database service.

## License

[MIT](./LICENSE)

## Mail

Orbit Mail supports Gmail (OAuth/API), iCloud and Naver (IMAP/SMTP), with unified inboxes, search, replies, forwarding, attachments and Web Push. Mail uses a separate SQLite store; notes, tasks and events use the core SQLite store. Provider credentials and HTTPS/push setup are required before live use. See the [mail setup and operations guide](./docs/mail.md). Requires Node.js 22.16 or later.
