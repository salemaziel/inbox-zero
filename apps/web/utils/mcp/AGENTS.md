# utils/mcp

**Parent context:** `../AGENTS.md`
**Generated:** 2026-10-23 · **Updated:** 2026-10-23

## Purpose

Everything about the Model Context Protocol, in two directions that share this folder:

- **Server:** Inbox Zero exposes mail and rule tools to outside MCP clients at `app/mcp/route.ts` and `app/api/mcp-server/route.ts`. Access is OAuth with scopes `mcp:read`, `mcp:write`, `mcp:send`, `offline_access`.
- **Client:** rule actions and the assistant call tools on connected third-party apps (Composio-hosted apps and user-registered custom servers). Rule-callable write tools are described declaratively in `tool-specs.ts`.

## Key Files

| File | Description |
| --- | --- |
| `config.ts` | `MCP_SCOPES`, docs URLs, `isMcpServerAvailable` (env `MCP_SERVER_ENABLED`), resource and metadata helpers. |
| `http.ts` | Server entry: CORS, IP rate limit, Bearer token check, then `handleMcpServerRequest`. Returns 404 when the server is disabled. |
| `server.ts` | `handleMcpServerRequest`: registers tools with read-only or write annotations and runs them for the verified principal. |
| `verify-token.ts` | `verifyMcpToken` against the Better Auth JWKS. |
| `oauth-provider.ts`, `oauth-registration.ts`, `rate-limit.ts` | Better Auth OAuth-provider plugins, dynamic client registration for native clients, per-IP and per-path rate limits. |
| `access.ts`, `connections.ts` | Per-user enablement (`user.mcpServerEnabled`) and listing, revoking, or narrowing granted client connections. |
| `account-selection.ts` | `resolveMcpEmailAccount`: which mailbox a tool call targets. |
| `email-tools.ts`, `mail-client*.ts` | Zod input shapes for server tools and the embedded mail-client UI (`mail-client-ui.ts` registers the UI resource; `mail-client-contract.ts` is the shared contract; `mail-client-bundle.ts` serves its HTML). |
| `integrations.ts` | `MCP_INTEGRATIONS` registry (display info, URLs, allowed tools, OAuth config), `getIntegration` (throws), `findIntegration` (for untrusted names). |
| `resolve-integration.ts` | Resolves a stored connection to a built-in or `custom_` integration. |
| `providers/` | `IntegrationProvider` interface, `composio.ts`, and `registry.ts`. A provider runs the third-party app's OAuth and exposes it as an MCP server. |
| `oauth.ts` | PKCE authorization URL, callback handling, and stored token lookup (`getAuthToken`) for directly connected integrations. |
| `call-tool.ts`, `list-tools.ts`, `sync-tools.ts` | Call a tool, list tools, and sync a connection's tool list to the database (marks read-only tools by name). |
| `tool-specs.ts` | Declarative specs for write tools used by rule actions: one definition drives the editor, AI argument filling, execution, validation, and history display. |
| `safe-fetch.ts` | SSRF-guarded fetch for user-registered servers; `getCustomMcpServerUrlError` is the URL policy. |
| `tier-access.ts` | `assertIntegrationsTierAccess`: plan gate for integrations. |

## Subdirectories

| Directory | Purpose |
| --- | --- |
| `providers/` | Third-party integration hosts (currently Composio only). |

## For AI Agents

### Working In This Directory

- Keep the two roles apart. Anything under server auth (`http.ts`, `verify-token.ts`, `oauth-*`, `connections.ts`) deals with outside clients acting for a user; `call-tool.ts` and friends deal with Inbox Zero acting on connected apps.
- Server tools check the token's scope through `assertMcpScope` (in the tool registration wrapper in `server.ts`). Reads need `mcp:read`, mutations `mcp:write`, sending `mcp:send` (see also `getMailPermissions` in `mail-client-ui.ts`). Sending is user-confirmed in the UI; do not auto-confirm.
- User-registered server URLs must go through `safe-fetch.ts` on every request, not only when saved. Never call them with the default `fetch`. Built-in integrations point at endpoints we control and use the default.
- Integration names from URLs or stored rows are untrusted: use `findIntegration`, not `getIntegration`.
- Adding a write tool for rule actions means adding a spec in `tool-specs.ts`; `buildPayload` is the only place that knows the wire format. Avoid special-casing in the executor, editor, or AI filling code.
- `Action.integrationArgs` has specific storage rules (empty value on an AI-prompt arg means "AI writes it"; `{{...}}` templates stay literal). Read the header comment in `tool-specs.ts` before changing it.
- Env: `MCP_SERVER_ENABLED`, `MCP_ALLOW_PRIVATE_IPS`. New vars follow the root env rule (`.env.example`, `env.ts`, `turbo.json`).

### Testing Requirements

- Co-located tests, for example `server.test.ts`, `http.test.ts`, `oauth*.test.ts`, `safe-fetch.test.ts`, `tool-specs.test.ts`, `sync-tools.test.ts`. Run from repo root: `pnpm test apps/web/utils/mcp` or one file.
- Provider tests: `providers/composio.test.ts`.
- Rule-action AI use of MCP tools is in `../ai/mcp/` (`mcp-tools.test.ts`).

### Common Patterns

- Zod shapes for tool inputs are exported as `*InputShape` or `*Schema` and reused by both the server tools and the UI.
- Handlers return `Response` objects with CORS headers added in one place (`withCors`).

## Dependencies

### Internal

- `../auth.ts` (`betterAuthConfig`), `../oauth/state.ts`, `../ai/mcp/`, `../actions/mcp.ts`, `../email/` (`EmailProvider`), `@inboxzero/network/safe-url`, `app/api/mcp/`, `app/mcp/`, `app/api/mcp-server/`.

### External

- `@modelcontextprotocol/sdk`, `@modelcontextprotocol/ext-apps`, `undici`, `jose`, Better Auth OAuth provider, Composio.

## Manual Notes

Notes under this heading are written by humans and preserved on regeneration.
