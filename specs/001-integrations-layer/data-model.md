# Data model: Shared integrations layer

Only one persisted schema change: `ExecutedAction.integrationResult`. Everything else is either an existing table reused as-is or an in-code type.

## Persisted

### ExecutedAction (existing table, one new column)

| Field | Type | New? | Notes |
| --- | --- | --- | --- |
| `integrationResult` | `Json?` (Postgres `JSONB`, nullable) | **New** | `{ externalId?: string; url?: string }` validated by `integrationCallResultSchema` before write. Written on `SUCCEEDED` (from the call) and on rerun `SKIPPED` (copied from the earlier result). Null for every other action type and for MCP tools without a result parser. |
| `integrationName`, `integrationToolName`, `integrationArgs` | existing | — | `integrationArgs` now holds placeholder-resolved values (resolution happens before persistence). |
| `executionStatus`, `executionError` | existing | — | `executionError.code` gains the codes listed below; `executionError.message` carries the trimmed provider message (≤500 chars). |

Migration: `apps/web/prisma/migrations/<YYYYMMDDHHMMSS>_executed_action_integration_result/migration.sql`

```sql
-- AlterTable
ALTER TABLE "ExecutedAction" ADD COLUMN "integrationResult" JSONB;
```

Additive and nullable: no backfill, no lock-heavy rewrite, safe for other branches sharing a dev database. The implementer must confirm with the owner before applying it to any database.

### McpIntegration / McpConnection (existing tables, reused, no schema change)

- Native integrations get an `McpIntegration` row keyed by `name` (upserted on first connect; no OAuth client fields set).
- A native connection is an `McpConnection` row: `accessToken` = the app token (encrypted by the Prisma extension), `refreshToken`/`expiresAt` unused, `isActive` toggled to `false` on an `auth` failure, `name` = integration display name. `@@unique([emailAccountId, integrationId])` keeps one connection per app per mailbox.
- Native connections never get `McpTool` rows, so chat/agent tool loading never sees them.

### ExecutedRule (existing)

Unchanged. Rerun protection joins through `executedRule: { emailAccountId, messageId, ruleId }` (index `[emailAccountId, messageId]` exists).

## In-code entities

### Integration registry entry (`apps/web/utils/mcp/integrations.ts`, existing type extended)

| Field | Type | Default | Rule |
| --- | --- | --- | --- |
| `execution` | `"mcp" \| "native"` | `"mcp"` when absent | Integration-level, because MCP OAuth tokens are bound to the MCP server. |
| `connectKind` | `"api-token-paste" \| "token-redirect"` | — | Required when `execution === "native"`, enforced by a discriminated union on `execution`; absent otherwise. |
| `authType` | existing | — | Native entries set `"api-token"`; every MCP-only path branches on `execution` first. |
| `ruleActionWriteTools` | existing | — | Remains the allowlist of tools usable as rule actions, for both execution kinds. |

### Tool spec remote-select control (`apps/web/utils/mcp/tool-specs.ts`, existing type extended)

```text
remote-select (MCP, default):  { type: "remote-select"; source?: "mcp"; optionsTool: string;
                                 parseOptions(content): IntegrationArgOption[];
                                 buildOptionsArgs?(parents: Record<string,string>): Record<string, unknown>;
                                 dependsOn?: string[]; fallbackOptions? }
remote-select (native):        { type: "remote-select"; source: "native"; dependsOn?: string[]; fallbackOptions? }
```

Validation: every `dependsOn` key must be another arg key of the same spec (enforced by a unit test over `INTEGRATION_TOOL_SPECS` and the fixture specs); no cycles.

### NativeIntegrationExecutor (`apps/web/utils/integrations/types.ts`)

```text
run(connection, payload, { signal }) => Promise<unknown>        // raw app response; parsed by parseResult
parseResult(raw) => IntegrationCallResult | null                // shared shape, required for native
listOptions(connection, argKey, parentValues, { signal }) => Promise<IntegrationArgOption[]>
testConnection({ accessToken }, { signal }) => Promise<void>    // throws IntegrationError on failure
revoke?(connection, { signal }) => Promise<void>                // best-effort
buildAuthorizeUrl?({ returnUrl }) => string                     // required when connectKind = token-redirect; returnUrl already carries ?state=…
```

`connection` = `NativeConnection { id, emailAccountId, accessToken }`. `buildAuthorizeUrl` is the concrete form of the design's "redirects to the app's authorize page" (§6.3, Connect row). `run` returning raw output plus a separate `parseResult` keeps native and MCP result handling on one path.

### IntegrationCallResult (`apps/web/utils/integrations/result.ts`)

`z.object({ externalId: z.string().min(1).max(500).optional(), url: z.string().url().max(2000).optional() })`. Display guard: `getSafeIntegrationResultUrl(value)` returns the URL only if it parses and its protocol is `https:`.

### IntegrationError (`apps/web/utils/integrations/types.ts`)

| Field | Type | Notes |
| --- | --- | --- |
| `kind` | `"auth" \| "rate_limit" \| "not_sent" \| "maybe_sent" \| "permanent"` | |
| `providerMessage` | `string \| undefined` | Trimmed to 500 chars when stored. |
| `retryAfterMs` | `number \| undefined` | Only for `rate_limit`. |
| `cause` | `unknown` | Original error; logged at trace level only. |

Constructor: `new IntegrationError({ kind, message?, providerMessage?, retryAfterMs?, cause? })`; `message` defaults to a generic text and never contains `providerMessage`.

Kind → stored code → retry:

| Kind | `executionError.code` | Retried by policy | Side effect |
| --- | --- | --- | --- |
| `not_sent` | `INTEGRATION_NOT_SENT` | yes | — |
| `rate_limit` | `INTEGRATION_RATE_LIMITED` | yes, after `retryAfterMs ?? 1 s`, only if that is ≤10 s and fits the remaining budget | — |
| `maybe_sent` | `INTEGRATION_MAYBE_SENT` | never | copy says "may have been created" |
| `auth` | `INTEGRATION_AUTH_FAILED` | never | native and direct-MCP connection `isActive = false`; hosted-provider connections untouched |
| `permanent` | `INTEGRATION_CALL_FAILED` (existing) | never | — |

Rerun skip: `{ skipped: true, reason: "INTEGRATION_ALREADY_CREATED", integrationResult }`.

Failure result returned to `execute.ts`: `{ success: false, errorCode, errorMessage }` where `errorMessage` = owner copy for the kind, followed by the trimmed `providerMessage` when present. `getActionResultError` stores it as `executionError.message`, and history renders it for INTEGRATION items.

### Placeholder values (`apps/web/utils/integrations/placeholders.ts`)

`Record<"subject" | "from" | "to" | "date" | "snippet" | "link" | "ruleName", string>`, built once per rule run; missing values are `""`. Grammar in [contracts/placeholders.md](./contracts/placeholders.md).

## State transitions

### ExecutedAction for an INTEGRATION action

```text
(created, status null)
  ├─ gate off ─────────────────────────────→ SKIPPED (unchanged behaviour)
  ├─ pre-check fails ──────────────────────→ FAILED  (existing codes)
  ├─ prior result found (earlier run only) ─→ SKIPPED + integrationResult (copied)
  └─ call via policy
       ├─ success ─────────────────────────→ SUCCEEDED + integrationResult (or null)
       ├─ IntegrationError(kind) ──────────→ FAILED + executionError{code by kind, message}
       ├─ result parsing throws ───────────→ SUCCEEDED, integrationResult null
       └─ any other throw in the layer ────→ FAILED (INTEGRATION_CALL_FAILED); later actions still run
```

### McpConnection for a native integration

```text
(none) ─connect (paste or redirect, token verified)→ active
active ─auth failure during run, options load or test→ inactive ("Reconnect")
active|inactive ─reconnect→ active (upsert)
active|inactive ─disconnect→ revoke (best-effort) → deleted
```
