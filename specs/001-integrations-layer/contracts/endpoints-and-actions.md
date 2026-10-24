# Contract: endpoints, server actions and pages

## GET `/api/mcp/[integration]/arg-options` (existing route, extended)

Middleware: `withEmailAccount("mcp/arg-options")` (unchanged).

| Query param | Type | Rule |
| --- | --- | --- |
| `tool` | string | Must name a spec of `[integration]`. |
| `argKey` | string | Must be a `remote-select` arg of that spec. |
| `parents` | JSON object string, optional | Keys must be exactly the arg's `dependsOn` set (no extras); values non-empty strings ≤500 chars. Missing or empty parent → 400-class `SafeError`. |

Response (unchanged shape): `{ options: { value: string; label: string }[] }`.

Routing: native integration → `executor.listOptions(connection, argKey, parents)`; MCP → `callMcpTool(optionsTool, buildOptionsArgs?.(parents) ?? {})` then `parseOptions`. One attempt, 15 s timeout. Errors surface as today (the editor falls back to `fallbackOptions`). An `auth` failure deactivates native and direct-MCP connections.

Client: `useIntegrationArgOptions({ integration, tool, argKey, parents, enabled })`; the SWR key includes the serialized parents; `enabled` is false while any parent is empty.

## Server actions — `apps/web/utils/actions/integrations.ts`

All use `actionClient` (email-account scoped) from `@/utils/actions/safe-action`; inputs in `apps/web/utils/actions/integrations.validation.ts`.

| Action | Input | Behaviour | Errors (`SafeError` text) |
| --- | --- | --- | --- |
| `connectIntegrationWithTokenAction` | `{ integrationName: string; token: string (1–4096, trimmed) }` | tier check → entry is native + `api-token-paste` → `testConnection` → upsert integration + connection | tier message (existing); "This integration can't be connected with a token."; "That token didn't work. Check it and try again." |
| `startIntegrationTokenRedirectAction` | `{ integrationName: string }` | tier check → entry is native + `token-redirect` → signed state in cookie `native-integration-state-<name>` → returns `{ url }` from `buildAuthorizeUrl({ returnUrl })`, with `returnUrl` = `<base>/<emailAccountId>/integrations/connect/<name>?state=<state>` | tier message; kind mismatch message |
| `completeIntegrationTokenRedirectAction` | `{ integrationName: string; state: string; token: string }` | validate state vs cookie (10 min, same user + mailbox, type `native-integration:<name>`) → clear cookie → `testConnection` → upsert | "This connection link expired or doesn't match. Start again from the Integrations page."; token message |

Existing actions extended (`apps/web/utils/actions/mcp.ts`):

- `testMcpConnectionAction`: native → `executor.testConnection` through the read policy (15 s); result `{ toolsCount: 0 }` keeps the response shape; an `auth` error deactivates and returns the existing "Authorization expired or was revoked…" message.
- `disconnectMcpConnectionAction`: native → `executor.revoke?.()` through the read policy, best-effort (failure or timeout logged at warn, never thrown), then delete as today.

## GET `/api/mcp/integrations` (existing route, extended)

Each built-in item gains `execution` and `connectKind`. Native items are omitted when `isIntegrationActionEnabledForEmailAccountId` is false (spec Q3 default).

## Page — `app/(app)/[emailAccountId]/integrations/connect/[integration]/page.tsx` (new)

Client-side capture for `token-redirect`: reads `state` from the query string and `token` from `window.location.hash`, immediately replaces the URL without either (`history.replaceState`), calls `completeIntegrationTokenRedirectAction`, then routes to `/<emailAccountId>/integrations` with a success or error toast. Missing token/state → error message and a link back. No token value is ever logged or rendered.
