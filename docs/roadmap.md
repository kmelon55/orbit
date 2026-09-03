# Orbit roadmap

Orbit's roadmap is organized around a small personal loop, not feature parity with larger note-taking or project-management products.

## v0.1 — The personal loop (current)

- [x] Markdown/YAML vault as the source of truth
- [x] Quick capture for notes, tasks, and events
- [x] Today view for tasks, events, and active projects
- [x] Task views, completion, editing, and lightweight rescheduling
- [x] Day, week, and month calendar views
- [x] Timed and multi-day events with drag-to-move and resize
- [x] Inbox and PARA filing with nested folders
- [x] Markdown editing, tags, internal links, autosave, and optional Vim mode
- [x] Excalidraw-compatible whiteboards
- [x] Mobile navigation, dedicated capture, and installable PWA shell
- [x] Built-in single-user authentication for self-hosting
- [x] Docker deployment with a persistent filesystem vault
- [x] Local stdio MCP tools for capture, reading, search, calendar, and PARA filing

The browser UI, MCP server, and Markdown files now share one working storage contract. The PWA does not currently cache private data for offline access, and MCP is local stdio rather than a hosted endpoint.

## v0.2 — Useful AI, under user control

- [ ] Bring-your-own-key provider configuration
- [ ] Ask questions across notes, tasks, and events
- [ ] Search and summarize related material with links back to source files
- [ ] Turn natural-language input into proposed notes, tasks, and events
- [ ] Suggest titles, tags, dates, and PARA destinations
- [ ] Review changes as a diff before applying them
- [ ] Detect stale proposals and conflicting file changes
- [ ] Provide a rules-only organizer when AI is disabled

Completion boundary: Orbit remains fully useful without AI, and AI never changes or moves an existing file without a visible user decision.

## v0.3 — Dependable personal infrastructure

- [ ] Filesystem watcher and live refresh
- [ ] Search ranking and filters across the vault
- [ ] Snapshot history, restore UI, and verifiable backup jobs
- [ ] Attachment handling with stable paths
- [ ] iCalendar import and export
- [ ] CalDAV adapter with explicit timezone, recurrence, and conflict rules
- [ ] Scoped credentials for non-local integrations

Completion boundary: local writes, backup state, and external sync state are independently observable and recoverable.

## v0.4 — A safer agent boundary

- [ ] MCP resources and reusable prompts
- [ ] Tools for creating, reading, approving, and rejecting AI proposals
- [ ] Least-privilege tokens for any future remote transport
- [ ] File-change and task/event webhooks
- [ ] Compatibility fixtures for supported agent clients

Completion boundary: an external agent can retrieve context and suggest useful actions without receiving unrestricted, invisible mutation authority.

## Deliberate non-goals

- A general-purpose database builder
- A plugin ecosystem
- Team workspaces and complex role management
- A general-purpose project-management suite
- A required cloud service or hosted AI model
- Continuous autonomous rewriting of the vault

These boundaries can change only when real personal use shows that the added complexity earns its place.
