# Research: Shared integrations layer

All items below resolve points the approved design (`docs/integrations/00-current-state.md` §6) left to planning. Contract shape and numeric limits come from the design and are not revisited.

## R1. How the fixture integration reaches product code without entering the production registry

- **Decision**: Keep `MCP_INTEGRATIONS`, `INTEGRATION_TOOL_SPECS` and the executor tables static. The fixture lives in `apps/web/__tests__/fixtures/integrations/fixture-integration.ts`. Server-side tests inject it by mocking lookup modules: `vi.mock("@/utils/integrations/executors.server", …)` for `getNativeExecutor` / `getMcpResultParser`, and, where a test enters through `actions.ts` or the options service, `vi.mock("@/utils/mcp/integrations", async (importOriginal) => …)` / `vi.mock("@/utils/mcp/tool-specs", async (importOriginal) => …)` overriding only `findIntegration` / `getIntegrationToolSpec` / `getRemoteSelectArg` to return fixture entries for the fixture name and delegate otherwise. Browser-safe helpers in `editor.ts` take the spec list as a parameter (default `INTEGRATION_TOOL_SPECS`).
- **Rationale**: No test-only branch in product code (spec SC-001), no `NODE_ENV` checks, and `IntegrationKey` is `string` so fixture objects type-check. ESM module mocks only affect importers, which is exactly the boundary we want.
- **Alternatives considered**: Registering the fixture behind `NODE_ENV === "test"` (pollutes production code and types). A mutable registry with `register()` (a plugin loader the design rejects). Dependency-injecting every lookup through every function (spreads test concerns into hot files).

## R2. Remote-select control for native fields and dependent fields

- **Decision**: Extend the existing control variant rather than replace it: `{ type: "remote-select"; source?: "mcp" | "native"; optionsTool?; parseOptions?; buildOptionsArgs?; dependsOn?; fallbackOptions? }`, modelled as a discriminated union on `source` (MCP variant keeps `optionsTool` and `parseOptions` required; `source` omitted means MCP). `getIntegrationRemoteSelectTools` skips native fields. Options for native fields come from `executor.listOptions(connection, argKey, parentValues)`.
- **Rationale**: Todoist's spec needs no edit (lower merge risk in `tool-specs.ts`); the MCP allowlist in `call-tool.ts` stays derived from specs.
- **Alternatives considered**: A separate `native-select` control type (duplicates editor branches).

## R3. Error classification for MCP calls

- **Decision**: `callMcpTool` throws `IntegrationError` instead of a bare `Error`, keeping today's generic message text. Check the HTTP status first: `StreamableHTTPError.code` (the field `isAuthRejection` in `utils/actions/mcp.ts` already reads) 401/403 → `auth`, 429 → `rate_limit`, at any stage. Then by stage: setup (allowlist → `permanent`; `getMcpServerConnection` failures: connection now inactive or token missing/expired/refresh failed → `auth`, anything else → `not_sent`), connect (`client.connect`) → `not_sent`, call: tool `isError` → `permanent` with the tool's text content trimmed into `providerMessage` (never into `message`), abort or any other failure → `maybe_sent`. Accept an optional `signal`; pass it to `client.connect` and `client.callTool` request options.
- **Rationale**: The shared policy can only make the "never retry a write that may have landed" call if the stage is known. The options route also benefits.
- **Alternatives considered**: Classifying by parsing the generic message (brittle); leaving MCP outside the policy (design says one shared wrapper).
- **Note**: the status field is `.code` (already relied on by `isAuthRejection`). The request-options signature of `connect`/`callTool` (signal, timeout) must be confirmed against the installed SDK after T001.

## R4. Call policy numbers and timing

- **Decision**: `PER_ATTEMPT_TIMEOUT_MS = 15_000`, `MAX_ATTEMPTS = 3`, `TOTAL_BUDGET_MS = 30_000`, `MAX_RETRY_AFTER_MS = 10_000`, default rate-limit wait 1 s when the response gives none. Each attempt's timeout is `min(15 s, remaining budget)`, enforced by racing the attempt against a timer and aborting its signal, so an attempt that ignores the signal is still abandoned. A requested wait over 10 s, or one that does not fit in the remaining budget, ends the loop with the `rate_limit` error (retrying early mostly earns another 429). Read mode (option listing, connection test, revoke) uses one attempt with the 15 s timeout. `not_sent` from HTTP is limited to `ENOTFOUND`, `EAI_AGAIN`, `ECONNREFUSED` and `UND_ERR_CONNECT_TIMEOUT`; a reset or any other socket error after connect is `maybe_sent`.
- **Rationale**: From design §6.3; keeps a message's actions within the 300 s `after()` budget.

## R5. Placeholder syntax and resolution point

- **Decision**: `[[name]]` with optional inner spaces; names `subject`, `from`, `to`, `date`, `snippet`, `link`, `ruleName` (case-sensitive). Values: `subject`/`from`/`to` from parsed headers, `date` as ISO 8601 UTC from the message's internal date (falls back to the Date header), `snippet` from the message snippet, `link` from `getEmailUrlForOptionalMessage({ messageId, threadId, emailAddress, provider, externalUrl })` (Outlook uses the provider's own URL), `ruleName` from the matched rule. Resolution is one post-processing call in `getActionItemsWithAiArgs`, applied on all three exits (no-AI early return, draft-only, AI path). For each integration **text** arg it decides from the **original** stored value (from `selectedRule.actions`), never from the merged value: AI-wholesale-filled (empty with `aiPrompt`) → leave the AI output untouched; otherwise render once from the original template, replacing markers only in its literal parts and inserting the AI vars for its `{{…}}` parts. `placeholders.ts` splits templates with `TEMPLATE_VARIABLE_PATTERN` from `@/utils/template` (same pattern as `parseTemplate`), because `choose-args.ts` imports server-only modules and `placeholders.ts` must stay browser-safe for the editor and validation. Unknown markers that reach execution are left as literal text. Spec Q2 holds the owner question.
- **Rationale**: `[[` cannot collide with `{{`, so `extractActionsNeedingAiGeneration` does not trigger an AI call for markers. Reusing `parseTemplate` gives "literal text only, never re-parsed" for free.
- **Alternatives considered**: Resolving before AI merge (a subject containing `{{…}}` would become a prompt). Resolving on the merged string (AI output containing `[[from]]` would be substituted).

## R6. Rerun protection query

- **Decision**: `prisma.executedAction.findMany({ where: { type: INTEGRATION, integrationName, integrationToolName, executionStatus: SUCCEEDED, integrationResult: { not: Prisma.DbNull }, executedRuleId: { not: currentExecutedRuleId }, executedRule: { emailAccountId, messageId, ruleId } }, orderBy: { createdAt: "desc" }, take: 20, select: { integrationResult: true } })`, then return the first row whose result parses with an `externalId`. No JSON-path filter, so the mock-based test cannot hide a Postgres-only behaviour.
- **Rationale**: Excluding the current ExecutedRule matters because `execute.ts` persists each action's SUCCEEDED outcome before the next action runs; without it, a second identical action in the same rule would be skipped on its first run. `ExecutedRule @@index([emailAccountId, messageId])` covers the join; no new index. Concurrent reruns of the same message are not locked (accepted limit, spec edge cases).

## R7. Native connect flows

- **Decision**:
  - Paste: server action validates input, runs `assertIntegrationsTierAccess`, checks the registry entry is `native` + `api-token-paste`, calls `executor.testConnection({ accessToken })`, then `mcpIntegration.upsert({ where: { name } })` and `mcpConnection.upsert({ where: { emailAccountId_integrationId } })` with `accessToken`, `isActive: true`, `name`.
  - Redirect start: server action checks tier and kind, creates a signed state with `generateSignedOAuthState({ userId, emailAccountId, type: "native-integration:<name>" })`, sets it in an httpOnly cookie named `native-integration-state-<name>` (`oauthStateCookieOptions`), and returns `executor.buildAuthorizeUrl({ returnUrl })`, where `returnUrl` is `${NEXT_PUBLIC_BASE_URL}/<emailAccountId>/integrations/connect/<name>?state=<state>`.
  - Redirect complete: the client page reads `state` from `location.search` and `token` from `location.hash`, immediately removes both from the address bar, and calls a server action that validates the state against the cookie (`validateSignedOAuthState`, 10-minute expiry), checks user and mailbox match, clears the cookie, then follows the paste path from `testConnection` on. Cookies are read and written inside the server actions (`cookies()` from `next/headers`) and passed to `connection.server.ts` functions as values, so those functions stay testable.
- **Rationale**: Mirrors existing MCP OAuth state handling; the fragment never reaches a server route (design §6.3).
- **Open detail**: the token's fragment key is app-specific; the page reads a fixed `token` key, which matches common practice. Phase 5 confirms the exact key for its app.

## R8. Hosted-provider write tools

- **Decision**: `getMcpServerConnection` passes `allowedTools: [...(allowedTools ?? []), ...(ruleActionWriteTools ?? [])]` to the provider. Chat stays safe because `utils/ai/mcp/mcp-tools.ts` loads only `isWrite: false` tools.
- **Rationale**: Design §6.4; one-line seam.

## R9. Running tests without `.env`

- **Decision**: Nothing extra. `apps/web/__tests__/test-env.ts` sets placeholder values before `@/env` evaluates, and `vitest.config.mts` loads `.env.test` only if present. Tests mock Prisma and never open a DB connection.

## R10. Type/build check without `.env`

- **Decision**: Final check uses `pnpm --filter inbox-zero-ai build:ci` with the same non-secret placeholder env values CI uses (`.github/workflows/build-check.yml`). Listed in quickstart.md. AGENTS.md allows `build:ci` "only when explicitly asked"; the owner's Phase 4 completion criterion (typecheck must pass) is that request.
