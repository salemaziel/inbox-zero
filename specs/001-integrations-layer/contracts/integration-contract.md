# Contract: what a new integration provides

This is the interface a later phase (for example Trello) implements. Field-level types are in [../data-model.md](../data-model.md).

## 1. Registry entry (browser-safe) — `apps/web/utils/mcp/integrations.ts`

An entry in `MCP_INTEGRATIONS`:

- MCP integration: as today; `execution` omitted or `"mcp"`.
- Native integration: `execution: "native"`, `connectKind: "api-token-paste" | "token-redirect"`, `authType: "api-token"`, `ruleActionWriteTools: [<tool names>]`, `scopes: []`, plus the display fields (`displayName`, `url`, optional `description`).

## 2. Tool specs (browser-safe) — one `IntegrationToolSpec` per action

Unchanged contract (`integration`, `tool`, `actionLabel`, `llmDescription`, `args`, `buildPayload`), plus:

- Remote-select args may set `dependsOn: [<parent arg keys>]`.
- Native remote-select args set `source: "native"` and omit `optionsTool`/`parseOptions`.
- MCP remote-select args with parents provide `buildOptionsArgs(parents)`.
- Text args may contain `[[field]]` markers (see [placeholders.md](./placeholders.md)); `buildPayload` receives resolved strings and never sees markers.
- `buildPayload(resolved, { timeZone })` also gets the account's IANA time zone (`EmailAccount.timezone`, UTC when unset or invalid), for args such as due dates that depend on the user's day.
- A required arg with no `aiPrompt` (for example a Trello board) can only be picked in the rule editor. An AI-written rule that leaves one empty (chat, the confirmation card, mobile prompt-to-rule) is saved turned off, and the user is told in plain words which choices to pick before turning it on. Chat edits that resend an action with the same app and tool keep the stored values of the args the rule writer cannot set.

Specs are added to `INTEGRATION_TOOL_SPECS`. App-specific spec files may live in `apps/web/utils/integrations/<app>/` and be listed there (Phase 5 decides).

## 3. Server executor (server-only) — `apps/web/utils/integrations/executors.server.ts`

- Native: an entry in `NATIVE_EXECUTORS[<integration>]` implementing `NativeIntegrationExecutor` (`run`, `parseResult`, `listOptions`, `testConnection`, optional `revoke`, `buildAuthorizeUrl` when `connectKind = "token-redirect"`, optional `isConfigured`). `run` and `parseResult` receive the tool name.
- MCP: optionally an entry in `MCP_RESULT_PARSERS[<integration>][<tool>]` with `parseResult(raw)`; nothing else.

Executor rules:

- Must throw `IntegrationError` (from `apps/web/utils/integrations/types.ts`) for every failure. `apps/web/utils/integrations/http.ts` does this for HTTP calls.
- Must honour the passed `AbortSignal`.
- Must not retry internally; the shared call policy owns retries.
- Must not log tokens; PII only via `logger.trace`.
- Any user-supplied base URL must go through `@inboxzero/network/safe-url` (design §4.1).
- App-level keys come from env (`.env.example`, `env.ts`, `turbo.json`), never from the spec.

## 4. Call result

`run` returns the raw response; `parseResult(raw, tool)` returns `{ externalId?, url? } | null`. Only an `externalId` enables rerun protection. The URL is shown in history only if `https:`.

## 5. Error kinds the layer understands

`auth`, `rate_limit` (optional `retryAfterMs`), `not_sent`, `maybe_sent`, `permanent`. Mapping to codes, retries and side effects: data-model.md "IntegrationError".

## 6. What an integration author does NOT write

Validation, AI fill, risk labels, history display, import/export, editor rendering, connect/disconnect/test UI, retries, timeouts, rerun protection, result storage. All come from the shared layer (spec SC-001).
