# Orbit ↔ ChatGPT MCP

Updated 2026-10-12. ChatGPT is the conversation, research and briefing interface. Orbit remains the existing calendar/task/note application and authoritative store. No AI tab, dashboard or internal briefing generator is added.

## Implemented locally

- Streamable HTTP `/mcp` using the existing MCP SDK and TanStack server routes, stateless JSON responses. The trusted local `pnpm mcp` server is never registered on this public route.
- OAuth authorization code + mandatory S256 PKCE, using `@node-oauth/oauth2-server` 5.3.0 for the protocol. Existing Orbit login authenticates the owner. A consent page shows the requested read/save/apply capabilities. Login returns only to a validated local OAuth consent path.
- A single preconfigured public OAuth client, exact redirect allowlist, resource binding, issuer identification on successful/denied callbacks. No client secret or dynamic registration endpoint. Discovery advertises the preconfigured-client flow; no fake CIMD support.
- Access tokens expire after one hour. Refresh tokens rotate and are bounded by a 30-day grant. Replaying an old refresh token revokes that grant. Changing Orbit credentials invalidates existing grants. `/oauth/revoke` revokes a token's grant. Raw authorization codes/access tokens/refresh tokens are never persisted; records use hashed keys in existing private SQLite metadata.
- Explicit origin configuration and enabled Orbit login are required. Missing configuration fails closed. Cookies do not authenticate `/mcp`; only OAuth bearer tokens do. Host/Origin checks, input limits, no-store responses and a bounded process-local rate limit protect the entry point. The reverse proxy should also rate-limit public traffic and preserve the external Host.
- `orbit.read` exposes bounded search/fetch/context/record tools. `orbit.write` additionally saves explicitly requested new notes/tasks/events, briefings, findings and pending recommendations. `orbit.apply` additionally allows selected application, editing, deferral and rejection through `orbit_decide_recommendations`.
- Apply requires exact proposal IDs/revisions. Existing-item fingerprints detect intervening edits. All selected changes and applied receipts are one transaction; retries do not duplicate items. The audit identifies MCP mutations. No model-supplied `approved: true` is accepted.

**Confirmation boundary:** OAuth grants permission to the client; ChatGPT must still obtain the user's approval for each consequential change through its conversation and write-confirmation flow. The server validates permissions, exact changes, revisions and replay safety. It cannot independently prove the contents of a natural-language conversation. Real ChatGPT confirmation behavior is a deployment acceptance test; writes are disabled by default until verified. Do not label SDK tests as real ChatGPT approval proof.

## On-demand data access

All search runs inside Orbit, against the current vault. There is no bulk upload, external index, embedding job or external AI API call.

| Tool | Returned data |
| --- | --- |
| `orbit_assistant_search` | Default 20, max 100 results per page; title and 600-character excerpts. Optional query/type/folder/status/date filters; follow nextOffset for more. |
| `orbit_assistant_fetch` | One item with its full body by default. Optional offset/length for sections of long notes. |
| `orbit_assistant_context` | Today/week schedules, incomplete/overdue/completed tasks, all active goals, project folders and five suggested priorities. Note bodies and briefing history are fetched as needed. |
| `orbit_assistant_records` | Default 20, max 100 record titles/IDs/states per page, with nextOffset. |
| `orbit_assistant_record` | One full structured record, for goal details or reviewing exact recommendation actions; optional JSON text sections. |

Dates filter schedule overlap, with explicit timezone support. Search supports note/task/event/link, exact project folder, task completion state and explicit archived-item inclusion. Search currently scans local items using case-insensitive term matching; it is not semantic search. Pagination keeps search useful without uploading the vault; follow-up reads may fetch as much relevant information as the task needs.

Tags do not block assistant access. Authentication and read/write scopes remain enforced. Mail, raw frontmatter, filesystem paths and attachment binaries have no MCP retrieval tools.

### Requested saves versus existing changes

- Search and read what is relevant to the conversation, with additional reads as needed.
- An explicit request to save a new note, task or event uses `orbit_create_item`. A stable requestKey reuses the existing transaction/receipt mechanism; a retry never overwrites manual edits. Sourced Inbox findings and briefings use their dedicated tools.
- AI-suggested work remains a proposal until selected by the user. Before changing any existing schedule, note or task (including completion/cancellation), show the exact changes and ask for confirmation. A broad request to organize does not authorize arbitrary edits. Apply only the approved selections/revisions, following the host write confirmation.
- There is currently no delete or move tool. Never simulate deletion by clearing content or cancelling an item. Such operations must use the same explicit confirmation boundary if added later.
- No new assistant tab or approval dashboard is introduced. The user works in ChatGPT and sees saved items in the ordinary Orbit surfaces.

Saved ChatGPT briefings and sourced findings become ordinary Inbox notes. Deduplication preserves existing notes and manual edits. Assistant records remain separately stored for provenance, proposal state and audit. Their portable export/import is `.orbit/assistant.json`; OAuth records are not part of portable content exports. Full private database backups contain the hashed OAuth records as expected.

## Deployment and first connection

Implementation and isolated tests are complete; **production configuration, deployment and a real ChatGPT account connection have not been performed**.

1. Preserve the current `/vault` mount and existing Orbit credentials. Configure the existing Orbit deployment:

   ```dotenv
   ORBIT_MCP_ORIGIN=https://orbit.lab-42.xyz
   ORBIT_MCP_CLIENT_ID=orbit-chatgpt
   ORBIT_MCP_REDIRECT_URIS=https://chatgpt.com/connector_platform_oauth_redirect
   ORBIT_MCP_ALLOW_WRITES=false
   ```

   The origin must be the actual public HTTPS origin with no trailing slash. The callback must exactly match the one displayed by ChatGPT; the value above is the documented stable callback for issuers supporting RFC 9207. Update the allowlist if the account shows another callback. Do not use wildcard redirects or the Orbit password as an OAuth client secret.

2. Commit and push through the existing Git deployment flow; do not create another service or manually run a separate deployment. The Compose template forwards these variables but does not enable MCP by default. Route `/mcp`, `/oauth/*` and `/.well-known/oauth-*` to Orbit, without a separate interactive proxy login wall or caching. Preserve the public Host header.
3. Check unauthenticated `/mcp` returns 401 with `WWW-Authenticate`; check both OAuth metadata endpoints return the configured public origin. Verify OAuth in MCP Inspector without exposing production tokens in logs.
4. Open [ChatGPT Plugins](https://chatgpt.com/plugins), select **+ → Add custom MCP server**, and name it **Orbit**. Under Connection, enter `https://orbit.lab-42.xyz/mcp`, choose OAuth and the preconfigured client ID `orbit-chatgpt` (no client secret; token endpoint auth method `none`). Account/workspace availability and the precise form must be checked in the actual account. If automatic setup expects DCR, use its manual/preconfigured-client option; this server deliberately has no DCR endpoint.
5. Select **Create as a plugin**, install the resulting Orbit plugin, and sign in with the existing Orbit account to approve read access. In a new conversation type `@` and select Orbit. Ask “와디즈 관련 메모를 찾아 요점만 알려줘.” Confirm the tool first searches and then fetches only relevant items. The returned content is sent to ChatGPT; keeping the DB local does not keep retrieved content out of the conversation.
6. After read behavior passes, enable `ORBIT_MCP_ALLOW_WRITES=true`, refresh the custom server's tool metadata and reauthorize with `orbit.read orbit.write orbit.apply`. Existing read-only tokens do not silently gain permissions. Check the write-confirmation prompt on a harmless new task, selected/edited application and a repeated request. Keep confirmation enabled for `orbit_decide_recommendations`; do not choose to remember approval for that tool. Disable the flag if the host does not provide the expected confirmation.

To disable all MCP access, unset `ORBIT_MCP_ORIGIN` and restart through the deployment's normal service management. To revoke credentials, use `/oauth/revoke` with the issued token/client ID or change the Orbit account password (which also invalidates web sessions). Tokens/grants cannot be managed via model tools.

Manual local stdio remains available with `ORBIT_VAULT_DIR=/absolute/vault pnpm mcp:assistant`; defaults to read only. `ORBIT_ASSISTANT_SCOPES=read,write` enables append/propose tools but no apply capability. These local flags are capability limits, not network authentication. Long-running development processes must use visible Orca terminals and reuse the existing server.

## Existing architecture reused

React 19, TanStack Start/Router, Vite/Nitro, Tailwind/shadcn; SQLite documents/directories/metadata/assets/app_state. Notes/tasks/events share OrbitItem; projects reuse PARA folders. Existing serialized transactions and nested transaction handling perform writes. No destructive migration, data deletion, new database or separate agent runtime.

Goals, briefings, findings, recommendations and audit are individually keyed `assistant.v1/...` metadata records. Goals have parent/horizon/project/item links and progress is linked-task completion, not a fabricated business KPI. The internal goal service exists; editing goals through MCP is still a later capability. Project folder renames currently require relinking goals. Tasks have completion timestamps but no historical postponement ledger or plan baseline.

## Next stages

- Verify the public deployment, actual Pro connection, metadata discovery and host confirmations. MCP Apps UI is optional and not needed for the plain conversation workflow.
- Schedule briefing reads only after successful manual runs. Test eligible ChatGPT scheduled tasks at 08:00, then evening/weekly/monthly prompts. Do not assume unattended custom MCP writes or briefing persistence are available: saving a briefing is also a write. If scheduling does not work in the account, consider server Cron plus a separately configured, minimally used AI API; neither is enabled here.
- GitHub, service metrics, Wadiz/news/research sources can be fetched by ChatGPT's existing connected tools. Persist relevant sourced findings to Orbit. An Orbit-side adapter interface exists for future read-only sources; no external accounts, production DBs or news providers have been connected.
- Add goal editing, project lifecycle relinking and historical planning data when the core conversation works. Metadata is sufficient for the personal vault; indexing/SQL filtering can improve larger-vault search without changing the MCP response limits.

## Verification and official references

Isolated-vault tests cover existing-item conflicts, atomic selected application, replay safety, export/import, paginated search, full reads regardless of tags, requested creation and retry safety, actual MCP SDK HTTP-client initialization against the request handler, OAuth PKCE/replay/rotation/revocation, scope enforcement and credential invalidation. The existing Orca browser/dev server proves routes are mounted and fail closed when unconfigured; it does not prove the configured production login or ChatGPT connection.

Official connection/authentication sources rechecked 2026-10-12 (scheduling sources checked 2026-10-11):

- [Custom MCP setup and write confirmations](https://developers.openai.com/api/docs/guides/custom-mcp-server)
- [ChatGPT custom connection](https://developers.openai.com/plugins/deploy/connect-chatgpt)
- [OAuth and scopes](https://developers.openai.com/plugins/build/auth)
- [MCP tools and confirmation](https://developers.openai.com/api/docs/mcp)
- [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
- [Scheduled tasks](https://learn.chatgpt.com/docs/automations)
- [OAuth library PKCE](https://node-oauth.github.io/node-oauth2-server/guide/pkce.html)

Current SDK 1.x puts OAuth extension metadata under `_meta`; the HTTP adapter mirrors `securitySchemes` to the top-level tool descriptor expected by ChatGPT. Tools remain authenticated at the HTTP boundary regardless of their annotations.
