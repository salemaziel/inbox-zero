# Tasks: Shared integrations layer for rule actions

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · also read research.md, data-model.md, contracts/, quickstart.md

**Tests**: The owner asked for high-quality, co-located tests (`foo.ts` → `foo.test.ts`). They must be behaviour-focused and use the real logger (never mock `@/utils/logger`). Use Prisma via `@/utils/__mocks__/prisma`. No render tests, and no tests of static config values; the one exception is the spec-invariant check in T003. Read `.claude/skills/testing/SKILL.md` (plus `unit.md` and `write-tests.md`) before writing any test.

## Global Constraints (every task inherits these)

- **Numbers** (spec FR-008/008a, FR-011, data-model.md):
  - 15 s per attempt.
  - At most 3 attempts and at most 30 s in total.
  - Retry only `not_sent`, and `rate_limit` when the requested wait (1 s if none given) is ≤10 s and fits the remaining budget.
  - Read mode (options, test connection, revoke) = 1 attempt.
  - Provider message is trimmed to ≤500 chars.
  - `externalId` is 1–500 chars; `url` is ≤2000 chars and displayed only if `https:`.
  - Pasted token is 1–4096 chars after trimming.
  - Redirect state expires after 10 min.
- **Codes**:
  - `INTEGRATION_AUTH_FAILED`, `INTEGRATION_RATE_LIMITED`, `INTEGRATION_NOT_SENT`, `INTEGRATION_MAYBE_SENT`, `INTEGRATION_CALL_FAILED` (permanent and unexpected; existing code).
  - Skip reason: `INTEGRATION_ALREADY_CREATED`.
  - All existing pre-check codes in `actions.ts` keep their order and meaning.
- **Markers**: `[[subject]]`, `[[from]]`, `[[to]]`, `[[date]]`, `[[snippet]]`, `[[link]]`, `[[ruleName]]`.
  - Case-sensitive; inner spaces allowed; text args only.
  - Grammar is in contracts/placeholders.md.
- **Safety**:
  - The app's message never appears in a thrown error's `message` or in logs above trace.
  - Tokens are never logged or rendered.
  - `runIntegrationAction` never throws.
- **Placement**:
  - New logic goes in new files under `apps/web/utils/integrations/`. Existing files marked "seam" get the smallest delegating edit.
  - Browser-safe modules (`types.ts`, `result.ts`, `placeholders.ts`, `editor.ts`) import nothing server-only, and nothing from `utils/ai/choose-rule/choose-args.ts`.
- **Environment**:
  - The app `.env` is gitignored and absent in this worktree. No task needs it, because `apps/web/__tests__/test-env.ts` supplies placeholders.
  - Never print secret values.
  - Never apply the migration, push, or open a PR without asking the owner.
- **Checks**:
  - `pnpm test <paths relative to apps/web>` from the repo root.
  - A check passes when the summary shows the expected test-file count and 0 failures. Turbo prefixes lines with `inbox-zero-ai:test:`; for raw Vitest output use `pnpm --filter inbox-zero-ai exec vitest run <path>`.
  - Run the full suite, lint and the type/build check only in T027.

## Interfaces (names every task must use)

```text
// apps/web/utils/integrations/types.ts (browser-safe)
type IntegrationErrorKind = "auth" | "rate_limit" | "not_sent" | "maybe_sent" | "permanent"
class IntegrationError extends Error {
  constructor(opts: { kind: IntegrationErrorKind; message?: string; providerMessage?: string; retryAfterMs?: number; cause?: unknown })
  kind; providerMessage?; retryAfterMs?
}
type NativeConnection = { id: string; emailAccountId: string; accessToken: string }
type NativeIntegrationExecutor = {
  run(conn: NativeConnection, payload: Record<string, unknown>, o: { signal: AbortSignal }): Promise<unknown>
  parseResult(raw: unknown): IntegrationCallResult | null
  listOptions(conn: NativeConnection, argKey: string, parents: Record<string, string>, o: { signal: AbortSignal }): Promise<IntegrationArgOption[]>
  testConnection(cred: { accessToken: string }, o: { signal: AbortSignal }): Promise<void>
  revoke?(conn: NativeConnection, o: { signal: AbortSignal }): Promise<void>
  buildAuthorizeUrl?(o: { returnUrl: string }): string
}
// apps/web/utils/integrations/result.ts (browser-safe)
integrationCallResultSchema; type IntegrationCallResult = z.infer<…>
parseIntegrationCallResult(raw: unknown): IntegrationCallResult | null
getSafeIntegrationResultUrl(value: unknown): string | null
// apps/web/utils/integrations/call-policy.ts
runWithCallPolicy<T>(attempt: (signal: AbortSignal) => Promise<T>, o: { mode: "write" | "read" }): Promise<T>   // throws IntegrationError
// apps/web/utils/integrations/http.ts
integrationFetch(url: string, init: RequestInit & { signal: AbortSignal }): Promise<unknown>                // throws IntegrationError
// apps/web/utils/integrations/placeholders.ts (browser-safe)
PLACEHOLDER_NAMES: readonly ["subject","from","to","date","snippet","link","ruleName"]
type PlaceholderValues = Record<(typeof PLACEHOLDER_NAMES)[number], string>
findUnknownPlaceholders(text: string): string[]
buildPlaceholderValues(o: { message: Pick<ParsedMessage,"id"|"threadId"|"headers"|"snippet"|"internalDate"|"externalUrl">; emailAccount: { email: string; account: { provider: string } }; ruleName: string }): PlaceholderValues
renderIntegrationTextArg(o: { template: string; aiVars?: Record<`var${number}`, string>; values: PlaceholderValues }): string
// apps/web/utils/integrations/executors.server.ts
getNativeExecutor(name: string): NativeIntegrationExecutor | undefined
getMcpResultParser(name: string, tool: string): ((raw: unknown) => IntegrationCallResult | null) | undefined
// apps/web/utils/integrations/connection.server.ts
getActiveNativeConnection(o: { emailAccountId; integrationName }): Promise<NativeConnection | null>
deactivateIntegrationConnection(o: { emailAccountId; integrationName }): Promise<void>
connectWithToken(o: { userId; emailAccountId; integrationName; token; logger }): Promise<void>
createTokenRedirect(o: { userId; emailAccountId; integrationName; baseUrl; logger }): Promise<{ url: string; state: string; cookieName: string }>
completeTokenRedirect(o: { userId; emailAccountId; integrationName; state; cookieState: string | undefined; token; logger }): Promise<void>
// apps/web/utils/integrations/idempotency.server.ts
findPriorIntegrationResult(o: { emailAccountId; messageId; ruleId: string | null; integrationName; integrationToolName; currentExecutedRuleId }): Promise<(IntegrationCallResult & { externalId: string }) | null>
// apps/web/utils/integrations/run-integration-action.server.ts (never throws)
runIntegrationAction(o: { integrationName; toolName; integrationConfig; payload; emailAccountId; messageId; ruleId: string | null; executedRuleId; logger }):
  Promise<{ success: true; integrationResult: IntegrationCallResult | null }
        | { skipped: true; reason: "INTEGRATION_ALREADY_CREATED"; integrationResult: IntegrationCallResult }   // added in T017
        | { success: false; errorCode: string; errorMessage: string }>
// apps/web/utils/integrations/arg-options.server.ts
getIntegrationArgOptions(o: { emailAccountId; integration; tool; argKey; parents?: Record<string,string>; logger }): Promise<{ options: IntegrationArgOption[] }>
// apps/web/utils/integrations/editor.ts (browser-safe)
getIntegrationToolChoices(specs?: readonly IntegrationToolSpec[]): { integration: string; tool: string; label: string }[]
getArgsToClear(spec: IntegrationToolSpec, changedKey: string): string[]
getParentValues(arg: IntegrationArgSpec, storedArgs: Record<string, unknown> | null | undefined): Record<string, string> | null
// apps/web/utils/ai/executed-action-outcome.ts (seam)
getIntegrationResult(actionResult: unknown): IntegrationCallResult | null
persistExecutedActionOutcome({ …existing, integrationResult?: IntegrationCallResult | null })
```

## Review Focus (failure modes each owning task must pin with a test)

- First run, two identical tool actions in one rule → both execute (T016, T017).
- Pre-send MCP failures (token missing, expired or refresh failed; provider setup error; 401 during connect) → `auth`/`not_sent`, never "may have been created" (T006).
- Connection reset after connect → `maybe_sent`, never retried (T005).
- An attempt that ignores its abort signal is abandoned at 15 s; the total stays ≤30 s (T005).
- A rate-limit wait over 10 s, or one that doesn't fit the budget → stop (T005).
- A mixed arg whose subject contains `[[from]]`, and AI output containing `[[subject]]` → no substitution (T014).
- `[[ subject ]]` resolves; `[[Subject]]` is rejected at save; an unknown marker at runtime stays literal (T013, T015).
- `parseResult` throws after a successful call → SUCCEEDED with no result. A DB error in the lookup → FAILED for that action only, and later actions still run (T009, T017).
- A pasted token with surrounding whitespace is trimmed before test and storage (T018).
- Rule status stays APPLIED after a rerun skip (T010).
- An app that hangs on test or revoke: timed out; disconnect still deletes (T020).
- Native apps are hidden when integration actions are off (T020); auth failure while loading options deactivates the connection (T022).

---

## Phase 1: Setup

- [x] T001 Install dependencies and confirm the targeted test form
  - **Files**: none edited (creates `node_modules/` and `apps/web/generated/prisma/` via `postinstall`).
  - **Does**: Run `bash scripts/pnpm-install-without-desktop.sh --frozen-lockfile` from the repo root (fallback `pnpm install --frozen-lockfile`). Confirm `pnpm-lock.yaml` is unchanged. Run one existing test with the planned form and confirm exactly one file ran. In `node_modules/@modelcontextprotocol/sdk`, confirm how `Client.connect` and `Client.callTool` accept a `signal`/`timeout` (research R3; the status field is `StreamableHTTPError.code`). Write the findings into the T006 entry as a note. No code edits.
  - **Check**: `git diff --quiet pnpm-lock.yaml && pnpm test utils/mcp/tool-specs.test.ts` → `Test Files  1 passed (1)`.
  - **After**: —

---

## Phase 2: Foundational (blocks all stories)

- [x] T002 [P] Add `ExecutedAction.integrationResult` and its migration
  - **Files**:
    - seam `apps/web/prisma/schema.prisma`: one line in `model ExecutedAction`, under "additional fields as a result of the action": `integrationResult Json? // { externalId?, url? } returned by an INTEGRATION action`.
    - NEW `apps/web/prisma/migrations/<UTC YYYYMMDDHHMMSS>_executed_action_integration_result/migration.sql`, containing exactly `-- AlterTable` and `ALTER TABLE "ExecutedAction" ADD COLUMN "integrationResult" JSONB;`. The timestamp must sort after the latest existing migration.
  - **Does**: Adds an additive nullable column and regenerates the client. Do **not** run `prisma migrate`. Applying it to a dev DB is additive and safe for other branches, but ask the owner first.
  - **Check**: `pnpm --filter inbox-zero-ai exec prisma generate && DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres pnpm --filter inbox-zero-ai exec prisma validate` (placeholder URL; validate does not connect).
  - **After**: T001

- [x] T003 [P] Contract types, registry fields and remote-select shape
  - **Files**:
    - NEW `apps/web/utils/integrations/types.ts`.
    - seam `apps/web/utils/mcp/integrations.ts`: `McpIntegrationConfig` gains a discriminated union, `{ execution?: "mcp" } | { execution: "native"; connectKind: "api-token-paste" | "token-redirect" }` (spec FR-002). Nothing else.
    - seam `apps/web/utils/mcp/tool-specs.ts`: the remote-select control becomes a union on `source`. The MCP variant is unchanged apart from optional `buildOptionsArgs(parents)` and `dependsOn`. The native variant is `{ type: "remote-select"; source: "native"; dependsOn?; fallbackOptions? }`. `getIntegrationRemoteSelectTools` skips native fields; `getRemoteSelectArg` returns both.
    - `apps/web/utils/mcp/tool-specs.test.ts`.
  - **Does**: `types.ts` exactly per Interfaces. Browser-safe. Todoist's spec is not edited.
  - **Tests**: a native remote-select contributes no MCP-callable tool; spec invariant: every `dependsOn` key across `INTEGRATION_TOOL_SPECS` names another arg of the same spec (the one static check allowed, because it catches typos in future specs).
  - **Check**: `pnpm test utils/mcp/tool-specs.test.ts`
  - **After**: T001

- [x] T004 [P] Call result schema and https-only URL guard
  - **Files**: NEW `apps/web/utils/integrations/result.ts`, NEW `apps/web/utils/integrations/result.test.ts`.
  - **Does**: Per Interfaces, with schema `z.object({ externalId: z.string().min(1).max(500).optional(), url: z.string().url().max(2000).optional() })`. `parseIntegrationCallResult` returns null for invalid input or an empty `{}`. Browser-safe.
  - **Tests**: `javascript:`, `http:` and malformed URLs are not displayable; a valid id is kept when the URL is invalid; an over-long id is rejected; `{}` → null.
  - **Check**: `pnpm test utils/integrations/result.test.ts`
  - **After**: T001

- [x] T005 Shared call policy and classified HTTP helper
  - **Files**: NEW `apps/web/utils/integrations/call-policy.ts`, `call-policy.test.ts`, `http.ts`, `http.test.ts` (all under `apps/web/utils/integrations/`).
  - **Does**:
    - `runWithCallPolicy` per Global Constraints. Each attempt races its own timer: on timeout it aborts the signal and abandons the attempt even if the attempt never settles.
    - Write mode: a timeout → `maybe_sent`; any non-`IntegrationError` → `maybe_sent`.
    - Read mode: one attempt; a timeout → `not_sent`.
    - `integrationFetch` error mapping:
      - `not_sent` only for the error codes `ENOTFOUND`, `EAI_AGAIN`, `ECONNREFUSED` and `UND_ERR_CONNECT_TIMEOUT` (read from the error's `cause.code`).
      - Any other network error (including `ECONNRESET` and `UND_ERR_SOCKET`) → `maybe_sent`.
      - 401/403 → `auth`.
      - 429 → `rate_limit`, with `Retry-After` parsed as seconds or as an HTTP date.
      - 5xx → `maybe_sent`; any other 4xx → `permanent`.
    - `integrationFetch` sets `providerMessage` from the response body text, trimmed to 500 chars. Bodies are logged only via `logger.trace`.
  - **Tests** (fake timers, stubbed `fetch`):
    - `not_sent` then success = 2 attempts.
    - `Retry-After: 3` → waits 3 s, then retries; `Retry-After: 60` → stops with `rate_limit` after 1 attempt; three 429s → `rate_limit`.
    - A wait that doesn't fit the remaining budget → stops.
    - A timeout is never retried; a 500 is never retried.
    - A never-settling attempt is abandoned at 15 s; the total never exceeds 30 s.
    - Read mode never retries.
    - One case per network error code above, plus the status mapping.
  - **Check**: `pnpm test utils/integrations/call-policy.test.ts utils/integrations/http.test.ts`
  - **After**: T003

- [x] T006 [P] Classified errors and abort signal for MCP calls
  - **Files**: seam `apps/web/utils/mcp/call-tool.ts`; `apps/web/utils/mcp/call-tool.test.ts`.
  - **Does**:
    - Add optional `signal?: AbortSignal` and pass it to `client.connect` and `client.callTool` (per T001 note).
    - Wrap the whole body, setup included. Throw `IntegrationError` with the generic message `Failed to call <integration> tool <tool>` plus `cause`, classified in this order:
      1. `StreamableHTTPError.code` 401/403 → `auth`, 429 → `rate_limit` (any stage).
      2. Allowlist rejection → `permanent`.
      3. `getMcpServerConnection` failure → `auth` if the connection is now inactive or the token is missing, expired or failed to refresh; otherwise `not_sent`.
      4. `client.connect` failure → `not_sent`.
      5. `result.isError` → `permanent`, with the tool's text trimmed to 500 chars in `providerMessage` only.
      6. Anything else (including abort) → `maybe_sent`.
    - Keep the `logger.trace` for details.
  - **Note (from T001, `@modelcontextprotocol/sdk` 1.32.1)**: `Client.connect(transport, options?: RequestOptions)` and `Client.callTool(params, resultSchema?, options?: RequestOptions)` both take `RequestOptions` with `signal?: AbortSignal`, `timeout?: number`, `resetTimeoutOnProgress?` and `maxTotalTimeout?`. For `callTool`, pass `undefined` as the second argument to keep the default schema. `StreamableHTTPError` has `readonly code: number | undefined` (HTTP status).
  - **Tests**: rewrite the existing "does not expose remote tool error content" test. It must still assert the generic message and assert that `message` does not contain the tool text; `providerMessage` carries the text. New cases: setup throw → `not_sent`; refresh failure / inactive connection → `auth`; 401 during connect → `auth`; connect failure → `not_sent`. Other existing tests stay green.
  - **Check**: `pnpm test utils/mcp/call-tool.test.ts`
  - **After**: T003

- [x] T007 Test-only fixture integration
  - **Files**: NEW `apps/web/__tests__/fixtures/integrations/fixture-integration.ts`.
  - **Does**: Never imported by product code. Exports:
    - Registry entries:
      - `FIXTURE_NATIVE` = `{ name: "fixture", execution: "native", connectKind: "api-token-paste", authType: "api-token", ruleActionWriteTools: ["create-item"] }`
      - `FIXTURE_REDIRECT` = `{ name: "fixture-redirect", connectKind: "token-redirect" }`
      - `FIXTURE_MCP` = `{ name: "fixture-mcp", MCP execution, ruleActionWriteTools: ["create-item"] }`
    - Specs:
      - `fixtureCreateItemSpec`: text `title` (required, `aiPrompt`) and `notes`; native remote-selects `boardId`, and `listId` with `dependsOn: ["boardId"]`.
      - `fixtureMcpCreateItemSpec`.
    - `createFixtureExecutor()`: a `NativeIntegrationExecutor` with a scripted queue of responses or `IntegrationError`s, the calls it recorded, an option to never settle, and `buildAuthorizeUrl` returning `https://fixture.invalid/authorize?return=<encoded returnUrl>`.
    - `fixtureMcpResultParser`.
  - **Check**: `pnpm exec biome check apps/web/__tests__/fixtures/integrations` (exercised by T009, T017, T018, T020, T022, T023).
  - **After**: T003, T004

- [x] T008 Server-only executor table and native connection primitives
  - **Files**: NEW `apps/web/utils/integrations/executors.server.ts`, NEW `apps/web/utils/integrations/connection.server.ts`.
  - **Does**:
    - `executors.server.ts` (`import "server-only"`): `NATIVE_EXECUTORS = {}` and `MCP_RESULT_PARSERS = {}` (both empty in this phase), plus the lookups from Interfaces, using `Object.hasOwn`.
    - `connection.server.ts`: `getActiveNativeConnection` (null if missing, inactive or without a token) and `deactivateIntegrationConnection` (`updateMany` on `isActive: false` scoped to mailbox and integration name; the same effect as the private OAuth helper, per spec design note 5).
  - **Check**: `pnpm exec biome check apps/web/utils/integrations/executors.server.ts apps/web/utils/integrations/connection.server.ts` (behaviour covered by T009, T018).
  - **After**: T003, T004

---

## Phase 3: User Story 1 — matched rule creates an object and history links to it (P1) MVP

**Independent test**: `pnpm test utils/integrations/run-integration-action.server.test.ts utils/ai/actions.test.ts utils/ai/choose-rule/execute.test.ts`

- [x] T009 [US1] Execution core
  - **Files**: NEW `apps/web/utils/integrations/run-integration-action.server.ts`, NEW `run-integration-action.server.test.ts`.
  - **Does**: `runIntegrationAction` per Interfaces (success and failure variants; T017 adds skip). Everything is inside one try/catch, so it never throws.
    - **Native**: `getActiveNativeConnection` (null → `INTEGRATION_NOT_CONNECTED`), then `getNativeExecutor` (undefined → `UNSUPPORTED_INTEGRATION_TOOL`), then `runWithCallPolicy(s => executor.run(conn, payload, { signal: s }), { mode: "write" })`, then `executor.parseResult`.
    - **MCP**: `runWithCallPolicy(s => callMcpTool({ …, signal: s }), { mode: "write" })`, then `getMcpResultParser(...)?.(raw) ?? null`.
    - **Parsing**: all parsed values pass through `parseIntegrationCallResult`. A throw while parsing → success with `integrationResult: null` (logged at warn).
    - **Error mapping**: `IntegrationError.kind` → codes per Global Constraints. `errorMessage` = owner copy for the kind, plus the trimmed `providerMessage`. The `maybe_sent` copy says "may have been created".
    - **Auth**: deactivates native and direct-MCP connections, but not when `integrationConfig.provider` is set.
    - **Unexpected errors** → `INTEGRATION_CALL_FAILED`.
    - **Logging**: log `{ integration, toolName, kind }` at error level and the error itself at trace only.
  - **Tests** (`vi.mock("@/utils/integrations/executors.server")`, `vi.mock("@/utils/mcp/call-tool")`, Prisma mock, fixture):
    - Native success → id and url.
    - MCP with a parser; MCP without a parser → null.
    - Each kind → its code.
    - `auth` deactivates native and direct MCP but not provider.
    - `maybe_sent` makes exactly one call.
    - `parseResult` throws → success with null.
    - A connection lookup that throws → failed result, no throw.
  - **Check**: `pnpm test utils/integrations/run-integration-action.server.test.ts`
  - **After**: T005, T006, T007, T008

- [x] T010 [P] [US1] Persist `integrationResult` on the executed action
  - **Files**:
    - seam `apps/web/utils/ai/executed-action-outcome.ts`: add the optional `integrationResult` param, written when non-null, and add `getIntegrationResult`.
    - seam `apps/web/utils/ai/choose-rule/execute.ts`: pass it on the SUCCEEDED and SKIPPED branches.
    - `apps/web/utils/ai/choose-rule/execute.test.ts`.
  - **Does**: Same pattern as `sentMessageIds`.
  - **Tests**:
    - Success with a result → the update includes `integrationResult`.
    - Skipped with a result → SKIPPED plus `integrationResult`, and the rule status is APPLIED.
    - No result → field not written.
  - **Check**: `pnpm test utils/ai/choose-rule/execute.test.ts`
  - **After**: T002, T004

- [x] T011 [US1] Delegate the `integration()` action to the execution core
  - **Files**: seam `apps/web/utils/ai/actions.ts`; `apps/web/utils/ai/actions.test.ts`.
  - **Does**: Inside `integration` only, keep every existing pre-check and code in order. Replace the `try { await callMcpTool… }` block with `return runIntegrationAction({ …, messageId: email.id, ruleId: executedRule.ruleId, executedRuleId: executedRule.id })`.
  - **Tests**:
    - Existing INTEGRATION tests pass (mock `@/utils/integrations/run-integration-action.server` where they asserted `callMcpTool`).
    - Gate off → skipped, with no call to the core.
    - Missing required arg → `MISSING_INTEGRATION_ARGS` before any call.
  - **Check**: `pnpm test utils/ai/actions.test.ts`
  - **After**: T009, T010

- [x] T012 [P] [US1] History: link, failure copy and the app's message
  - **Files**: seam `apps/web/app/(app)/[emailAccountId]/assistant/ResultDisplay.tsx`.
  - **Does**: For INTEGRATION `actionItems`:
    - If `getSafeIntegrationResultUrl(action.integrationResult)` returns a URL, render an "Open in <displayName>" link (`target="_blank"`, `rel="noopener noreferrer"`).
    - When `executionStatus === "FAILED"`, render `executionError.message` as plain text (never HTML).
    - Add copy to `ACTION_FAILURE_MESSAGES` for:
      - `INTEGRATION_AUTH_FAILED`: "…reconnect it on the Integrations page"
      - `INTEGRATION_RATE_LIMITED`
      - `INTEGRATION_NOT_SENT`
      - `INTEGRATION_MAYBE_SENT`: "…may have been created; check the app before re-running"
    - The history route already selects all `actionItems` columns, so no API change.
  - **Check**: `pnpm exec biome check "apps/web/app/(app)/[emailAccountId]/assistant/ResultDisplay.tsx" && pnpm test utils/integrations/result.test.ts`
  - **After**: T004, T010

---

## Phase 4: User Story 2 — fill fields from the email without AI (P1)

**Independent test**: `pnpm test utils/integrations/placeholders.test.ts utils/ai/choose-rule/choose-args.test.ts utils/ai/choose-rule/choose-args.security.test.ts utils/actions/rule.validation.test.ts`

- [x] T013 [P] [US2] Placeholder grammar, values and literal-only rendering
  - **Files**: NEW `apps/web/utils/integrations/placeholders.ts`, NEW `placeholders.test.ts`.
  - **Does**: Per Interfaces and contracts/placeholders.md.
    - Templates are split with `TEMPLATE_VARIABLE_PATTERN` from `@/utils/template`. Never import `choose-args.ts`.
    - `link` = `getEmailUrlForOptionalMessage({ messageId, threadId, emailAddress, provider, externalUrl })`.
    - `date` = ISO 8601 UTC from `internalDate`, falling back to the Date header, else `""`.
    - `renderIntegrationTextArg`: no `{{…}}` in the template → replace across the whole value; otherwise replace only in the literal parts and insert `aiVars` in order.
  - **Tests**:
    - Each name resolves; `[[ subject ]]` resolves; `[[Subject]]` and `[[unknown]]` are reported by `findUnknownPlaceholders` and left literal by rendering.
    - Mixed literal + `{{…}}` + marker.
    - A value containing `[[from]]` or `{{x}}` is inserted literally; an AI var containing `[[subject]]` is not substituted.
    - Missing values → `""`.
    - Microsoft link uses `externalUrl`.
  - **Check**: `pnpm test utils/integrations/placeholders.test.ts`
  - **After**: T001

- [x] T014 [US2] Resolve placeholders once, from the original templates
  - **Files**: seam `apps/web/utils/ai/choose-rule/choose-args.ts`; `apps/web/utils/ai/choose-rule/choose-args.test.ts`; `apps/web/utils/ai/choose-rule/choose-args.security.test.ts`.
  - **Does**: Add one helper at the bottom of `choose-args.ts`: `applyIntegrationPlaceholders({ original: selectedRule.actions, actions, aiArgs, values })`. Call it on all three exits of `getActionItemsWithAiArgs`: the no-AI early return, the draft-only path where `aiArgs` is undefined, and the AI path. `combineActionsWithAiArgs` is not changed.
    - For each INTEGRATION action, decide per text arg from the **original** value.
    - AI-wholesale-filled args (`isAiFilledArgValue`) keep the merged AI output untouched.
    - Every other text arg is set to `renderIntegrationTextArg({ template: original value, aiVars: aiArgs?.[`${type}-${id}`]?.[`integrationArgs.${key}`], values })`.
    - Values are built once with `buildPlaceholderValues`. Select and remote-select args are untouched.
  - **Tests**:
    - Marker-only args resolve without calling `aiGenerateArgs`.
    - A mixed arg resolves both parts.
    - Security: a subject `{{ignore…}} [[from]]` used via `[[subject]]` is stored literally and never appears in an AI schema; in a mixed arg whose subject contains `[[from]]`, the inner marker stays literal; AI wholesale output containing `[[subject]]` is not substituted.
    - The draft-only path resolves markers too.
  - **Check**: `pnpm test utils/ai/choose-rule/choose-args.test.ts utils/ai/choose-rule/choose-args.security.test.ts`
  - **After**: T013

- [x] T015 [P] [US2] Reject unknown placeholders at save
  - **Files**: seam `apps/web/utils/actions/rule.validation.ts`; `apps/web/utils/actions/rule.validation.test.ts`.
  - **Does**: In `addIntegrationActionIssues`, for text args only, add an issue per `findUnknownPlaceholders` name at `["integrationArgs", key]`, using the contracts/placeholders.md message. `placeholders.ts` is browser-safe, so client bundles importing `rule.validation.ts` are unaffected.
  - **Tests**: an unknown marker is rejected with its name; `[[Subject]]` is rejected; known markers are accepted; marker-like text in a select arg is ignored.
  - **Check**: `pnpm test utils/actions/rule.validation.test.ts`
  - **After**: T013

(The editor hint listing markers ships in T024.)

---

## Phase 5: User Story 3 — classified, safely retried, explained failures (P2)

No separate tasks; every call path needs the policy. It is delivered by:
- T005: policy and HTTP mapping.
- T006: MCP classification.
- T009: code mapping and auth deactivation.
- T012: copy and the app's message in history.

**Independent test**: `pnpm test utils/integrations/call-policy.test.ts utils/integrations/http.test.ts utils/mcp/call-tool.test.ts utils/integrations/run-integration-action.server.test.ts`

---

## Phase 6: User Story 4 — rerun does not duplicate (P2)

**Independent test**: `pnpm test utils/integrations/idempotency.server.test.ts utils/integrations/run-integration-action.server.test.ts`

- [x] T016 [P] [US4] Prior-result lookup
  - **Files**: NEW `apps/web/utils/integrations/idempotency.server.ts`, NEW `idempotency.server.test.ts`.
  - **Does**: `findPriorIntegrationResult` per research R6:
    - `findMany`, newest first, `take: 20`.
    - Filters: `executionStatus: SUCCEEDED`, `integrationResult: { not: Prisma.DbNull }`, `executedRuleId: { not: currentExecutedRuleId }`, the tuple, and type INTEGRATION.
    - Return the first row with a parsed `externalId`. `ruleId` null → null, with no query.
  - **Tests**:
    - A row with an id is returned; a row without an id is skipped in favour of an older one with an id.
    - The `where` excludes the current ExecutedRule and covers mailbox, message, rule, integration, tool and SUCCEEDED.
    - `ruleId` null → no query.
  - **Check**: `pnpm test utils/integrations/idempotency.server.test.ts`
  - **After**: T002, T004

- [x] T017 [US4] Skip already-created items on rerun
  - **Files**: seam `apps/web/utils/integrations/run-integration-action.server.ts` and its test; seam `apps/web/utils/ai/actions.ts` (only if T011 did not already pass `executedRuleId`).
  - **Does**: Before executing, call `findPriorIntegrationResult`. If it finds a result, return the skip variant from Interfaces. If the lookup throws, return `INTEGRATION_CALL_FAILED` without calling the app.
  - **Tests**:
    - A prior result → zero fixture calls and a skip carrying the prior link.
    - No prior result → normal run.
    - Two identical actions in one ExecutedRule both run.
    - A lookup that throws → failed result, no call, no throw.
  - **Check**: `pnpm test utils/integrations/run-integration-action.server.test.ts utils/ai/actions.test.ts`
  - **After**: T011, T016

---

## Phase 7: User Story 5 — connect, test, disconnect a native app (P2)

**Independent test**: `pnpm test utils/integrations/connection.server.test.ts utils/actions/mcp.test.ts app/api/mcp/integrations/route.test.ts`

- [x] T018 [US5] Paste and redirect connect flows
  - **Files**: seam `apps/web/utils/integrations/connection.server.ts` (add `connectWithToken`, `createTokenRedirect`, `completeTokenRedirect` per Interfaces); NEW `apps/web/utils/integrations/connection.server.test.ts`.
  - **Does**: Per research R7 and contracts/endpoints-and-actions.md.
    - Order: trim the token → tier check (`assertIntegrationsTierAccess`) → registry kind check → `testConnection` through the read policy → `mcpIntegration.upsert({ where: { name } })` → `mcpConnection.upsert` (`emailAccountId_integrationId`) with `accessToken`, `isActive: true`, `name: displayName`.
    - `createTokenRedirect` returns the state, the cookie name `native-integration-state-<name>` and the URL; `returnUrl` carries `?state=`.
    - `completeTokenRedirect` validates `state` against `cookieState` with `validateSignedOAuthState` (10 min), checking user, mailbox and type.
    - No cookie API is used here; the T019 actions own `cookies()`. Never writes `McpTool` rows.
  - **Tests** (fixture executor, Prisma mock):
    - Tier too low → refused, nothing written. Rejected token → nothing written.
    - Whitespace-padded token is trimmed before test and storage. Valid paste → upserts.
    - Missing, tampered, expired or cross-mailbox state → refused. Valid completion → stored.
    - The redirect URL's return address carries the state.
    - No `mcpTool` writes.
  - **Check**: `pnpm test utils/integrations/connection.server.test.ts`
  - **After**: T005, T007, T008

- [x] T019 [US5] Server actions for connecting
  - **Files**: NEW `apps/web/utils/actions/integrations.ts`, NEW `apps/web/utils/actions/integrations.validation.ts`.
  - **Does**: `connectIntegrationWithTokenAction`, `startIntegrationTokenRedirectAction` and `completeIntegrationTokenRedirectAction`, built on `actionClient` from `@/utils/actions/safe-action`, with inputs per contracts/endpoints-and-actions.md.
    - They read and write the state cookie with `cookies()` from `next/headers` (`oauthStateCookieOptions`; cleared on completion) and delegate to T018.
    - `SafeError` texts as in the contract.
  - **Check**: `pnpm konsistent && pnpm --filter inbox-zero-ai check-server-actions && pnpm exec biome check apps/web/utils/actions/integrations.ts apps/web/utils/actions/integrations.validation.ts`
  - **After**: T018

- [x] T020 [P] [US5] Branch test, disconnect and listing on execution kind
  - **Files**: seam `apps/web/utils/actions/mcp.ts`; `apps/web/utils/actions/mcp.test.ts`; seam `apps/web/app/api/mcp/integrations/route.ts`; NEW `apps/web/app/api/mcp/integrations/route.test.ts`.
  - **Does**:
    - `testMcpConnectionAction`, native path: executor missing → `SafeError`. Otherwise `runWithCallPolicy(s => executor.testConnection({ accessToken }, { signal: s }), { mode: "read" })` → `{ toolsCount: 0 }`. `auth` → deactivate plus the existing "Authorization expired…" message.
    - `disconnectMcpConnectionAction`, native path: `revoke` through the read policy; a failure or timeout is warn-logged; then delete.
    - Route: built-in items gain `execution` and `connectKind`. Native items are omitted when `isIntegrationActionEnabledForEmailAccountId` is false (spec Q3/FR-032).
  - **Tests**:
    - Native test calls the executor, never `syncMcpTools`.
    - Native auth failure deactivates.
    - Disconnect revokes, then deletes; a revoke failure or hang still deletes.
    - Route: a native item is hidden when the gate is off and listed when it is on; MCP items are unchanged.
  - **Check**: `pnpm test utils/actions/mcp.test.ts app/api/mcp/integrations/route.test.ts && pnpm --filter inbox-zero-ai check-server-actions`
  - **After**: T005, T007, T008

- [x] T021 [US5] Connect UI for native apps
  - **Files**:
    - seam `apps/web/app/(app)/[emailAccountId]/integrations/IntegrationRow.tsx`. Before the `api-token` "not supported" branch: native + paste → open the dialog; native + redirect → start action, then `window.location.assign(url)`. For native rows, hide the tool count and "Manage tools", and show "Reconnect" when the connection is inactive.
    - NEW `apps/web/app/(app)/[emailAccountId]/integrations/NativeTokenPasteDialog.tsx`.
    - NEW `apps/web/app/(app)/[emailAccountId]/integrations/connect/[integration]/page.tsx`.
    - NEW `apps/web/app/(app)/[emailAccountId]/integrations/connect/[integration]/TokenRedirectCapture.tsx` (client): reads `state` from the query and `token` from the hash, clears both with `history.replaceState`, calls the complete action, shows a toast, routes back.
  - **Does**: Uses shadcn/ui, `useAction` + `getActionErrorMessage`, and `mutate()` on the integrations SWR after success. Never logs or renders the token.
  - **Check**: `pnpm exec biome check "apps/web/app/(app)/[emailAccountId]/integrations"` then `grep -rn "API token connections are not supported\|Manage tools\|tools available" apps/web/__tests__/playwright` (read the full output, no `head`; update any spec that depends on a changed label).
  - **After**: T019, T020

---

## Phase 8: User Story 6 — pick among tools, dependent choices (P2)

**Independent test**: `pnpm test utils/integrations/editor.test.ts utils/integrations/arg-options.server.test.ts utils/mcp/tool-specs.test.ts`

- [x] T022 [P] [US6] Dependent remote-select options service, route and hook
  - **Files**:
    - NEW `apps/web/utils/integrations/arg-options.server.ts`, NEW `arg-options.server.test.ts`.
    - seam `apps/web/app/api/mcp/[integration]/arg-options/route.ts`: parse the optional `parents` JSON query param and delegate.
    - seam `apps/web/hooks/useIntegrationArgOptions.ts`: optional `parents`, included in the SWR key; disabled while a declared parent is empty. Optional, so `ActionSteps.tsx` compiles until T024.
  - **Does**: `getIntegrationArgOptions` per Interfaces and the contract.
    - Parent keys must equal `dependsOn` (extra, missing or empty → `SafeError`); values ≤500 chars.
    - Native → read policy around `listOptions`; MCP → `callMcpTool(optionsTool, buildOptionsArgs?.(parents) ?? {})` then `parseOptions`.
    - `auth` → deactivate native and direct-MCP connections.
  - **Tests** (fixture):
    - Child options are requested with the parent value.
    - Undeclared or missing parent → refused.
    - MCP builds args from parents; an MCP field without `dependsOn` still calls with `{}` (Todoist unchanged).
    - Native auth failure deactivates.
  - **Check**: `pnpm test utils/integrations/arg-options.server.test.ts`
  - **After**: T005, T006, T007, T008

- [x] T023 [P] [US6] Editor helpers: tool choices and dependent clearing
  - **Files**: NEW `apps/web/utils/integrations/editor.ts`, NEW `editor.test.ts`.
  - **Does**: Per Interfaces. Browser-safe. `getArgsToClear` returns the transitive dependents of the changed arg, including their `displayValueKey`s.
  - **Tests** (fixture specs plus Todoist):
    - One spec → one choice; two specs → two.
    - Changing `boardId` clears `listId` and its display key.
    - Todoist `projectId` has no dependents.
    - A missing parent → null.
  - **Check**: `pnpm test utils/integrations/editor.test.ts`
  - **After**: T003, T007

- [x] T024 [US6] Rule editor: tool picker, dependent selects, marker hint
  - **Files**:
    - NEW `apps/web/app/(app)/[emailAccountId]/assistant/IntegrationToolPicker.tsx`, exporting the picker and a small `IntegrationPlaceholderHint`. All new JSX lives here.
    - seam `apps/web/app/(app)/[emailAccountId]/assistant/ActionSteps.tsx`, wiring only:
      - Replace both editor uses of `getOnlyIntegrationToolSpec()`: preselect when exactly one choice exists; otherwise leave it unset and render the picker.
      - On pick, set name, tool and `buildDefaultIntegrationArgs`.
      - Pass `getParentValues` into `useIntegrationArgOptions`.
      - On a remote-select change, clear `getArgsToClear`.
      - Render the hint under text args.
  - **Does**: With one production spec the flow is unchanged (spec US6 scenario 1), so `apps/web/__tests__/playwright/emulated/automation/integration-action.spec.ts` stays valid.
  - **Check**: `pnpm exec biome check "apps/web/app/(app)/[emailAccountId]/assistant/ActionSteps.tsx" "apps/web/app/(app)/[emailAccountId]/assistant/IntegrationToolPicker.tsx" && pnpm test utils/integrations/editor.test.ts`, then `grep -rn "getByRole\|getByText\|getByLabel" apps/web/__tests__/playwright/emulated/automation/integration-action.spec.ts` (full output) and confirm every selected name still exists.
  - **After**: T013, T022, T023

---

## Phase 9: User Story 7 — hosted-provider write tools (P3)

- [x] T025 [P] [US7] Allow rule write tools on hosted-provider servers
  - **Files**: seam `apps/web/utils/mcp/server-connection.ts` (`allowedTools: [...(integration.allowedTools ?? []), ...(integration.ruleActionWriteTools ?? [])]`); NEW `apps/web/utils/mcp/server-connection.test.ts`.
  - **Tests**:
    - The provider's `getMcpServer` receives read and write tools.
    - The direct path is unchanged.
    - Chat stays read-only: assert that the `utils/ai/mcp/mcp-tools.ts` query still filters on `isWrite: false`, or add that assertion to its existing test if one exists.
  - **Check**: `pnpm test utils/mcp/server-connection.test.ts`
  - **After**: T001

---

## Phase 10: User Story 8 — AI rule writer names integration and tool (P3, OWNER-GATED)

**Do not start without the owner's explicit approval of spec Q1. If not approved, mark this task dropped with the reason; nothing depends on it.**

- [ ] T026 [US8] Per-tool INTEGRATION options in the rule-writer schema — **DROPPED: owner did not approve Q1 (2026-10-23); revisit before a second tool ships**
  - **Files**:
    - seam `apps/web/utils/ai/rule/create-rule-schema.ts`:
      - One union member per spec: `{ type: literal INTEGRATION, integrationName: literal, integrationToolName: literal, fields: createIntegrationFieldsSchema(spec), delayInMinutes }`, described by `spec.llmDescription`.
      - `RuleAction` gains optional `integrationName` and `integrationToolName`.
    - seam `apps/web/utils/ai/assistant/tools/rules/shared.ts`: carry both fields.
    - seam `apps/web/utils/rule/rule.ts`: remove the `getOnlyIntegrationToolSpec` fallbacks in `getIntegrationCreateFields` and `assertIntegrationActionsConnected`.
    - Tests: `apps/web/utils/ai/rule/create-rule-schema.test.ts`, `apps/web/utils/rule/rule.test.ts`.
  - **Does**:
    - Prompt text unchanged.
    - **Keep** `getOnlyIntegrationToolSpec`: the no-argument action label (`utils/action-display.tsx`, `AvailableActionsPanel.tsx`) and the Playwright option "Add Todoist task" depend on it.
    - Disclose the model-facing change in the PR description.
    - Adding an eval under `apps/web/__tests__/eval/` is the owner's call; it needs LLM credentials.
  - **Check**: `pnpm test utils/ai/rule/create-rule-schema.test.ts utils/rule/rule.test.ts` then `grep -rn "Add Todoist task" apps/web/__tests__/playwright` (full output; label must still resolve).
  - **After**: T024

---

## Phase 11: Polish & end-of-phase verification

- [ ] T027 Full verification (once)
  - **Files**: none edited unless a check fails.
  - **Does**:
    - Run every command in quickstart.md "End-of-phase verification": full `pnpm test`, `pnpm lint`, `pnpm konsistent`, `check-server-actions`, `check-enums`, and `build:ci` with CI's placeholder env (in the background, bounded).
    - Scan changed files for TODO placeholders, `.skip`/`.only` and stub tests.
    - Confirm there are no private names, local paths or infrastructure details.
    - Confirm the migration was not applied without approval.
    - List all changes with `git status --porcelain` (includes untracked files) and check them against this file. `.omc/`, `apps/web/.omc/` and `.specify/` must never be staged. `docs/integrations/` and `specs/001-integrations-layer/` follow spec Q4 (default: commit).
    - Report each command's summary line.
    - Hand the diff to a separate reviewer agent for approval (owner's Phase 4 rule).
  - **Check**: all commands exit 0; every path in `git status --porcelain` is listed in this file or allowed by spec Q4.
  - **After**: all other non-dropped tasks

---

## Dependencies & parallel groups

```text
T001
 └─ G1 [P]: T002, T003, T004, T013, T025
     ├─ G2 [P]: T005 (T003), T006 (T003), T007 (T003,T004), T008 (T003,T004), T010 (T002,T004), T014 (T013), T015 (T013), T016 (T002,T004)
     │   └─ G3: T009 (T005–T008); T012 [P] (T004,T010); T018 (T005,T007,T008); T020 [P] (T005,T007,T008); T022 [P] (T005–T008); T023 [P] (T003,T007)
     │       └─ G4: T011 (T009,T010); T019 (T018); T024 (T013,T022,T023)
     │           └─ G5: T017 (T011,T016); T021 (T019,T020)
     │               └─ G6 (owner-gated): T026 (T024)
     └─ T027 last
```

Same-file chains (never concurrent): `run-integration-action.server.ts` T009 → T017; `actions.ts` T011 → T017; `connection.server.ts` T008 → T018; `tool-specs.ts` T003 only (T026 no longer edits it); `ActionSteps.tsx` T024 only; `mcp.ts` T020 only.

## Parallel examples

- After T001: T002, T003, T004, T013 and T025 together.
- After G1: T005, T006, T010, T014, T015 and T016 together, then T007 and T008.
- US6: T022 and T023 together, then T024.

## Implementation strategy

1. MVP = Setup + Foundational + US1 (T001–T012): native and MCP execution, result capture, classified errors and history, all provable with the fixture.
2. US2 (placeholders) and US4 (rerun protection).
3. US5 (connect) and US6 (editor).
4. US7 any time after T001.
5. US8 only after the owner approves Q1.
6. T027 once at the end; no full-suite runs per task.
