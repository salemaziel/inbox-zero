# Integrations: current state

How a matched rule becomes an executed action today, how far the existing `INTEGRATION` action and MCP registry go toward "a rule result drives a reliable action in a third-party app", and whether to extend that path or build alongside it.

Snapshot: branch `feat/integrations`, upstream HEAD `109e216e6` (2026-10-23). All paths are repo-relative. `apps/web/` is abbreviated as `web/` in tables where space is tight. Line numbers are approximate anchors and will drift with upstream.

---

## 1. Execution flow

### 1.1 Incoming email to rule match

| Step | What happens | Where |
| --- | --- | --- |
| 1 | Gmail Pub/Sub POST is verified, acknowledged immediately, and history is processed inside Next.js `after()`. Route `maxDuration = 300`. Outlook has the same shape. | `apps/web/app/api/google/webhook/route.ts:19,121-124`; `apps/web/app/api/outlook/webhook/route.ts:24` |
| 2 | Per-message Redis lock wraps processing. | `apps/web/utils/webhook/google/process-history-item.ts:8,49` (`withMessageProcessingLock`) |
| 3 | Skip if an `ExecutedRule` already exists for `(emailAccountId, threadId, messageId)`; run rules only if `!hasExistingRule && hasAutomationRules && hasAiAccess`. | `apps/web/utils/webhook/process-history-item.ts:93-106,236` |
| 4 | `runRules` finds matching rules (static + AI), then calls `executeMatchedRule` per match. | `apps/web/utils/ai/choose-rule/run-rules.ts:90,359`; `match-rules.ts` |

Because Pub/Sub is acked before processing (step 1), a processing failure is not redelivered by the platform. This is inferred from the ack-first design; no redelivery path was found.

### 1.2 Argument filling (before anything is persisted)

`getActionItemsWithAiArgs` (`apps/web/utils/ai/choose-rule/choose-args.ts:57`):

- Builds a zod field per value needing AI (`getParameterFieldsForAction`, `choose-args.ts:354`).
  - Plain fields that may hold `{{...}}` templates: `label, subject, content, to, cc, bcc, url` (`choose-args.ts:366-373`). So a `CALL_WEBHOOK` URL can contain AI prompts.
  - `INTEGRATION` args come from the tool spec. An empty text arg with `aiPrompt`, or a select arg set to its `aiValue`, is AI-filled wholesale. A `{{...}}` value is a template. Anything else is used literally (`isAiFilledArgValue`, `apps/web/utils/mcp/tool-specs.ts:265-274`; storage rules in the header comment, `tool-specs.ts:8-22`).
- `{{...}}` is always an AI prompt, never a deterministic variable such as "subject" (`parseTemplate`, `choose-args.ts:475-497`). No placeholder substitution from email fields exists.
- If no field needs AI and there is no draft, it returns early with no LLM call (`choose-args.ts:131-133`).
- Otherwise there is one `aiGenerateArgs` call for all actions of the rule. The schema is keyed `${type}-${actionId}`, and the call is wrapped in `withRetry` (`apps/web/utils/ai/choose-rule/ai-choose-args.ts:60,112-121`).
- Results are merged back (`combineActionsWithAiArgs`, `choose-args.ts:211-231` for integration args).

### 1.3 Persist and dispatch

| Step | What happens | Where |
| --- | --- | --- |
| 5 | Action types blocked for low-trust static `from` rules are removed. `skipArchive` and unconfigured messaging-channel actions are filtered. | `run-rules.ts:373-406` |
| 6 | Split into immediate and delayed by `delayInMinutes`. Neither `INTEGRATION` nor `CALL_WEBHOOK` is delayable (`SUPPORTED_DELAYED_ACTIONS` excludes both), and `ScheduledAction` has no integration columns. | `run-rules.ts:446`; `apps/web/utils/delayed-actions.ts:4-17`; `apps/web/prisma/schema.prisma` `model ScheduledAction` |
| 7 | Test runs return here, before persistence. | `run-rules.ts:452` |
| 8 | `ExecutedRule` is created with status `APPLYING` and nested `ExecutedAction` rows, including resolved `integrationArgs`, under `withPrismaRetry`. | `run-rules.ts:465-513` |
| 9 | `executeAct` loops actions **sequentially** and calls `runActionFunction`, which switches on type. | `apps/web/utils/ai/choose-rule/execute.ts:38,61-95`; `apps/web/utils/ai/actions.ts:57-128` |

### 1.4 `INTEGRATION` branch (`integration`, `apps/web/utils/ai/actions.ts:605-699`)

1. Feature flag check. If off, returns `{ skipped: true, reason: "INTEGRATION_ACTION_DISABLED" }` and the action is recorded `SKIPPED` (`actions.ts:610-616`; `apps/web/utils/integration-action.server.ts:12`).
2. Missing `integrationName`/`integrationToolName` gives `MISSING_INTEGRATION_CONFIG` (`actions.ts:617-625`).
3. Registry allowlist: the tool must be in `MCP_INTEGRATIONS[name].ruleActionWriteTools`, otherwise `UNSUPPORTED_INTEGRATION_TOOL` (`actions.ts:626-637`). `findIntegration` only knows built-ins (`apps/web/utils/mcp/integrations.ts:363-369`).
4. An active `McpConnection` must exist for this email account, otherwise `INTEGRATION_NOT_CONNECTED` (`actions.ts:639-653`).
5. A tool spec must exist (`getIntegrationToolSpec`) and its required args must be non-empty, otherwise `MISSING_INTEGRATION_ARGS` (`actions.ts:655-674`).
6. `spec.buildPayload(resolvedArgs)` produces the wire payload (`actions.ts:676`).
7. `callMcpTool` (`apps/web/utils/mcp/call-tool.ts:10-67`):
   - re-checks the allowlist: write tools plus spec-declared remote-select read tools (`call-tool.ts:25-31`);
   - `getMcpServerConnection` either delegates to a hosted provider (Composio) or returns the direct server URL plus `Authorization: Bearer` from `getAuthToken`, which refreshes expired OAuth tokens (`apps/web/utils/mcp/server-connection.ts:14-38`; `apps/web/utils/mcp/oauth.ts:175,213-257`);
   - opens a **new MCP client per call** over Streamable HTTP, runs `callTool`, then closes it (`call-tool.ts:33-67`; `apps/web/utils/mcp/transport.ts`);
   - `result.isError` throws a generic `"MCP tool returned an error"`. Any failure is rethrown as `Failed to call <integration> tool <tool>`, and the tool's own error text goes only to `logger.trace` (`call-tool.ts:49-63`).
8. Success returns `{ success: true }`. **The tool result content is discarded** (`actions.ts:685`). A failure returns `{ success: false, errorCode: "INTEGRATION_CALL_FAILED" }` (`actions.ts:686-698`).

### 1.5 `CALL_WEBHOOK` branch (`call_webhook`, `actions.ts:482-510`; `apps/web/utils/outbound-webhook/call-webhook.ts`)

1. Empty `url` returns without sending, and the action is recorded `SUCCEEDED` (`actions.ts:488`).
2. Fixed payload: `email.{threadId, messageId, subject, from, cc, bcc, headerMessageId}` and `executedRule.{id, ruleId, reason, automated, createdAt}`. No body, snippet, labels, rule name or AI-filled fields (`actions.ts:490-507`; type `call-webhook.ts:20-34`).
3. If disabled by env, it logs and returns silently (`call-webhook.ts:41-55`; `apps/web/utils/outbound-webhook/action.ts:10-12`).
4. `validateWebhookUrl`: HTTPS only in production, blocked hostnames, DNS resolution with private-IP rejection unless `WEBHOOK_ALLOW_PRIVATE_IPS` is set. An invalid URL **throws** `SafeError` (`call-webhook.ts:60-67`; `apps/web/utils/outbound-webhook/url-validation.ts:77-200`).
5. POST JSON with a pinned DNS lookup via `resolveSafeExternalHttpUrl` (DNS-rebinding guard), header `X-Webhook-Secret: <user.webhookSecret>`, and a **1 s timeout** (`call-webhook.ts:18,105-160`).
6. Non-2xx, timeouts and network errors are logged and **swallowed** (`call-webhook.ts:84-102`).

### 1.6 Outcome to `ExecutedAction`

| Result of the action function | `ExecutedAction.executionStatus` | `ExecutedRule` | Later actions in the rule | Where |
| --- | --- | --- | --- | --- |
| `{ skipped: true }` | `SKIPPED` | unchanged | run | `execute.ts:97-105` |
| `{ success: false, ... }` for a type in `ACTION_RESULT_FAILURE_TYPES` (includes `INTEGRATION`, **not** `CALL_WEBHOOK`) | `FAILED`, `executionError = {code, message}` | `ERROR`, reason gets `Action failures: TYPE:CODE` appended | run | `execute.ts:107-119,178-193`; `apps/web/utils/ai/executed-action-outcome.ts:18-23,67-107` |
| anything else (including a webhook that 500'd or timed out) | `SUCCEEDED` | `APPLIED` if there were no failures | run | `execute.ts:120-128,196-204` |
| thrown error (e.g. invalid webhook URL, unknown action) | `FAILED` with normalized error | `ERROR` | **aborted**: the error is rethrown | `execute.ts:146-174` |

Persistence is `persistExecutedActionOutcome`, which writes `executionStatus`, `executedAt` and `executionError`. A persistence failure is logged, not thrown (`executed-action-outcome.ts:25-55`). Execution order follows the stored action order. `apps/web/utils/action-sort.ts` (which lists `CALL_WEBHOOK`, `INTEGRATION` last) is used only by UI code (`apps/web/app/(app)/[emailAccountId]/assistant/ruleFormActions.ts`, `apps/web/utils/action-display.tsx`).

### 1.7 Retries, timeouts, errors at a glance

| Stage | Retry | Timeout | Where |
| --- | --- | --- | --- |
| AI arg filling | `withRetry` | model default | `ai-choose-args.ts:112` |
| `ExecutedRule` create | `withPrismaRetry` | n/a | `run-rules.ts:465` |
| MCP tool call | **none** | **none set** in `call-tool.ts`. MCP SDK default applies (not verified: deps not installed in this worktree). | `call-tool.ts` |
| Composio REST (connect, server setup) | none | 15 s | `apps/web/utils/mcp/providers/composio.ts:9,179` |
| Webhook POST | **none** | 1 s | `call-webhook.ts:18` |
| Delayed actions (not applicable to either type) | QStash `retries: 3` | n/a | `apps/web/utils/upstash/index.ts:46,84` |
| Manual rerun | Re-executes all actions of the rule | n/a | `apps/web/utils/actions/ai-rule.ts:38-40` |

---

## 2. Existing extension points

### 2.1 What a new integration must add today

| Piece | File / symbol | Generic or per-app |
| --- | --- | --- |
| Registry entry: `name, displayName, url`, `serverUrl` **or** `provider: { id, app }`, `authType`, `scopes`, `allowedTools` (read tools for chat/agents), `ruleActionWriteTools` (rule-only write tools), `skipResourceParam`, `filterWriteTools`, `oauthConfig` endpoint fallback, `comingSoon` | `apps/web/utils/mcp/integrations.ts:3-31` `MCP_INTEGRATIONS` | Per-app data, generic consumers |
| Write tool spec: `args[]` (`text` / `select` / `remote-select`), `aiPrompt`, `aiValue`, `required`, `llmDescription`, `displayValueKey`, `buildPayload`, and `parseOptions` for remote selects | `apps/web/utils/mcp/tool-specs.ts:27-68` `IntegrationToolSpec`; register in `INTEGRATION_TOOL_SPECS` (`:163`) | Per-app. This is the de facto integration module contract. |
| Auth via the MCP server's OAuth: discovery (RFC 8414/9728) plus dynamic client registration (RFC 7591), client stored in `McpIntegration` | `apps/web/utils/mcp/oauth.ts:37,83,358,490-568` | Generic, but **requires** the app's MCP server to support DCR (`oauth.ts` throws "Dynamic registration not supported ... configure static OAuth credentials", yet no env/static client-credential path exists) |
| Auth via a hosted provider (`IntegrationProvider`: `isConfigured`, `getConnectUrl`, `completeConnection`, `disconnect`, `getMcpServer`) | `apps/web/utils/mcp/providers/types.ts:4-20`; `registry.ts`; `composio.ts` | Generic seam. Composio is the only implementation (`IntegrationProviderId = "composio"`). |
| Connect / callback routes | `apps/web/app/api/mcp/[integration]/auth-url/route.ts`, `callback/route.ts` (runs `syncMcpTools`, `:213`), `provider-callback/route.ts` | Generic |
| Tool sync: write tools stored with `McpTool.isWrite = true`, read tools narrowed to `allowedTools` | `apps/web/utils/mcp/sync-tools.ts` `buildBuiltInTools` | Generic |
| Integrations page (list, connect, disconnect, tools) | `apps/web/app/(app)/[emailAccountId]/integrations/` (`Integrations.tsx`, `IntegrationRow.tsx`); data from `apps/web/app/api/mcp/integrations/route.ts` (hides provider apps whose provider is unconfigured, `:46-49`) | Generic |
| Rule editor fields for the action | `IntegrationArgFields` / `IntegrationArgField` in `apps/web/app/(app)/[emailAccountId]/assistant/ActionSteps.tsx:1085,1172` | Generic, rendered from the spec |
| Remote-select options | `apps/web/app/api/mcp/[integration]/arg-options/route.ts`, which calls `callMcpTool(optionsTool, args: {})` | Generic, MCP-only |
| Env | `NEXT_PUBLIC_INTEGRATION_ACTION_ENABLED` (`apps/web/env.ts:513`) or PostHog flag `integration-actions`; `COMPOSIO_API_KEY` (`env.ts:348`); `MCP_SERVER_URL_OVERRIDES` (`:342`); `MCP_ALLOW_PRIVATE_IPS` (`:347`); `EMAIL_ENCRYPT_SECRET`/`_SALT` for token encryption (`:112-113`) | Global. No per-app env pattern exists. |

### 2.2 What follows automatically from a spec

These read the spec, so a new spec gets them without per-app code:

- Rule validation, covering unknown tool, unknown arg keys and required args (`apps/web/utils/actions/rule.validation.ts:476-545` `addIntegrationActionIssues`).
- AI arg filling (`choose-args.ts:383-401`).
- Risk messaging. `INTEGRATION` is always high risk (`apps/web/utils/risk.ts:43,97-101,186`).
- Labels and history display (`tool-specs.ts:195-229`; `apps/web/components/PlanBadge.tsx:127`; `apps/web/app/(app)/[emailAccountId]/assistant/ResultDisplay.tsx:410`).
- Import/export and the v1 API (`apps/web/app/(app)/[emailAccountId]/assistant/settings/RuleImportExportSetting.tsx:56`; `apps/web/app/api/v1/rules/serializers.ts:28,68`; `apps/web/app/api/v1/rules/validation.ts:142,159`).
- Rule save checks: feature enabled and integration connected (`apps/web/utils/rule/rule.ts:872-921`).

### 2.3 Gating that exists

| Gate | Where | When checked |
| --- | --- | --- |
| Env flag, or per-user PostHog flag `integration-actions` | `apps/web/utils/integration-action.ts`; `integration-action.server.ts:12-71`; client `apps/web/hooks/useFeatureFlags.ts:34-37` | Editor, rule save, **and every execution** |
| `INTEGRATION` hidden in the editor unless flag on or already present | `apps/web/utils/ai/rule/action-availability.ts:37-54` | Editor |
| Plus tier or higher to connect | `apps/web/utils/mcp/tier-access.ts:10-30`, used in `auth-url/route.ts:30` and `apps/web/utils/actions/mcp.ts:128` | Connect only |
| AI access required to run any automation | `process-history-item.ts:236` | Execution |

### 2.4 Precedent for native per-app code

Messaging actions (`NOTIFY_MESSAGING_CHANNEL`, `DRAFT_MESSAGING_CHANNEL`) are implemented natively per provider: Slack, Teams, Telegram (`apps/web/utils/messaging/providers/`; `enum MessagingProvider` in `schema.prisma`). Their own `MessagingChannel` table has encrypted tokens. Dispatch is via `switch (provider)` inside a 2,600+ line `apps/web/utils/messaging/rule-notifications.ts` (`:562,2403`). This shows upstream accepts native integrations, but not through a modular interface. Microsoft Teams notifications already exist on this path.

---

## 3. What's missing for the goal

| # | Gap | Evidence | Why it matters for the goal |
| --- | --- | --- | --- |
| 1 | **Single-spec assumption.** The editor, the AI rule writer and flat-field fallbacks call `getOnlyIntegrationToolSpec()`, which returns `undefined` once a second spec exists. There is no integration/tool picker. | `tool-specs.ts:177-187`; `ActionSteps.tsx:1110,1454`; `apps/web/utils/ai/rule/create-rule-schema.ts:187`; `rule.ts:796-812,882` | Adding any second tool (e.g. a Trello action) breaks the editor default and drops `INTEGRATION` from AI-authored rules until a picker and explicit naming exist. |
| 2 | **Execution is hard-wired to MCP.** `integration()` always calls `callMcpTool`. Remote-select `optionsTool` is an MCP tool name. | `actions.ts:678-684`; `tool-specs.ts:39-44`; `arg-options/route.ts:50-55` | Apps with no remote MCP server, or an MCP server lacking the needed write tool, cannot be used. |
| 3 | **Auth coverage.** Built-in `api-token` is declared but not connectable ("API token connections are not supported yet"). There is no static OAuth client credentials path and no OAuth 1.0a. | `apps/web/app/(app)/[emailAccountId]/integrations/IntegrationRow.tsx:66-75`; `auth-url/route.ts:75-80`; `oauth.ts:490-530` | Apps that use API key + user token, or non-DCR OAuth, have no connect path. Only custom servers can store an API key (`apps/web/utils/actions/mcp.ts:164`). |
| 4 | **Composio write tools are not wired.** The Composio MCP server is created with `allowed_tools = allowedTools` only, and Composio enforces that list. No Composio entry declares `ruleActionWriteTools`. | `server-connection.ts:19-23`; `composio.ts:92-133` | A write tool for a Composio-hosted app would not be exposed until `ruleActionWriteTools` is also passed. Unverified at runtime. |
| 5 | **Custom MCP servers can't be rule actions.** `integration()` uses `findIntegration` (built-ins only), and `callMcpTool` uses `getIntegration` (throws for unknown names). | `integrations.ts:352-369`; `call-tool.ts:21` | User-added servers (e.g. a self-hosted automation hub's MCP endpoint) are read-only context today. |
| 6 | **No deterministic email-field mapping.** `{{...}}` is always an LLM prompt. `buildPayload` receives only resolved strings and `integration()` ignores `email` and `executedRule`. | `choose-args.ts:475-497`; `tool-specs.ts:67`; `actions.ts:605-608` | "Card title = subject, description = link + sender" needs an LLM call and can be paraphrased or prompt-injected. There are no `subject/from/snippet/messageLink/ruleName` placeholders. |
| 7 | **No result capture.** The tool result is discarded, and `ExecutedAction` has no column for an external id or URL. | `actions.ts:685`; `schema.prisma` `model ExecutedAction` | Blocks "open the created card" in history, follow-up actions on the same object, and idempotent upsert. |
| 8 | **No idempotency.** Message-level dedupe exists (Redis lock plus the `ExecutedRule` check), but the manual rerun discards the old result and re-runs every action. No idempotency key is sent to the app. | `process-history-item.ts:93-106`; `apps/web/utils/actions/ai-rule.ts:38-40` | Reruns create duplicate tasks or cards. |
| 9 | **No retry or timeout for MCP calls, and error detail is lost.** | `call-tool.ts:49-63`; §1.7 | A transient 5xx or rate limit becomes a permanent `FAILED` with a generic message, and there is no retry path in the UI. |
| 10 | **Cannot be delayed.** | `delayed-actions.ts:4-17`; `ScheduledAction` has no `integration*` columns | "Create the task 2 hours later" or a deferred retry via QStash is not available. |
| 11 | **Dependent config fields.** Remote-select options are fetched with `args: {}`, so one select cannot depend on another. | `arg-options/route.ts:50-55` | Board then list (Trello), workspace then project (Asana), repo then labels (GitHub) cannot be expressed. |
| 12 | **One account per app per mailbox.** | `schema.prisma` `McpConnection @@unique([emailAccountId, integrationId])` | Fine for v1, but worth noting. |
| 13 | **The webhook path is too thin to be the "hub" answer alone.** Fixed metadata-only payload, static secret header (no HMAC/timestamp), 1 s timeout, failures recorded as `SUCCEEDED`, POST only, one URL. | §1.5; `call-webhook.ts:18,84-102,136` | Zapier/Make/n8n/Pipedream receive too little to build a card or task without calling back, and failures are invisible. |
| 14 | **Feature-flag cost and behaviour.** PostHog is evaluated on every `INTEGRATION` execution. Without PostHog and without the env flag, actions are silently `SKIPPED`. The `NEXT_PUBLIC_*` value is read by client code. | `integration-action.server.ts:12-71`; `hooks/useFeatureFlags.ts:34-37` | Self-hosters must set `NEXT_PUBLIC_INTEGRATION_ACTION_ENABLED=true`, and on Next.js client code likely needs it at build time. |
| 15 | **Tier is checked only at connect time.** | `tier-access.ts` call sites (§2.3) | Behaviour after downgrade was not found. Existing connections appear to keep executing. |
| 16 | **Observability is thin.** There is status plus error JSON per action and logs. There are no per-integration metrics, no last-success timestamp and no "test this action" for write tools. A connection test exists (`apps/web/utils/actions/mcp.ts:69` `testMcpConnectionAction`). | `executed-action-outcome.ts`; `ResultDisplay.tsx:410` | It is hard to tell a user why their card didn't appear. |

What already works well and should be kept:

- Deterministic tool choice. The tool is stored on the rule, not chosen by the LLM (`schema.prisma` `Action.integrationName/integrationToolName/integrationArgs`).
- The declarative spec is the single source for UI, AI fill, validation, risk and display (`tool-specs.ts:1-23`).
- The write-tool allowlist is enforced twice (`actions.ts:626-637`; `call-tool.ts:25-31`).
- Write tools never reach chat/agents (`apps/web/utils/ai/mcp/mcp-tools.ts:46`; `apps/web/app/api/mcp/integrations/route.ts:25`).
- Per-action failure is recorded without aborting sibling actions (`execute.ts:107-119`).

---

## 4. Risks

### 4.1 Security

| Risk | Evidence | Note |
| --- | --- | --- |
| Token storage | AES-256-GCM via a Prisma extension for `mcpConnection.{accessToken, refreshToken, apiKey}`, `mcpIntegration.oauthClientSecret`, `messagingChannel` tokens and `user.webhookSecret` (`apps/web/utils/prisma-extensions.ts:15-27`; `apps/web/utils/encryption.ts:12`) | Any new credential column must be added to `ENCRYPTED_FIELDS`, or it is stored in plaintext. Easy to miss. |
| Composio holds third-party tokens; a single platform API key reaches every user's connections | `composio.ts:54-62` (`x-api-key` plus `user_id = emailAccountId`) | Blast radius of a leaked `COMPOSIO_API_KEY` is all tenants. The data-processor question is also relevant for self-hosters. |
| OAuth refresh race | `oauth.ts:213-257,263-350`. No lock found (`grep lock` in `oauth.ts` returned nothing). | Concurrent refreshes with rotating refresh tokens can invalidate a connection. Unverified in practice. |
| SSRF | Webhook: validation plus pinned DNS (`call-webhook.ts:60-67,114-116`). Custom MCP: `safeMcpFetch` refuses redirects (`apps/web/utils/mcp/safe-fetch.ts:18-28`). Built-ins use default fetch with hardcoded URLs. | Any native integration with a user-supplied base URL (self-hosted CRM, n8n, Activepieces) must reuse `@inboxzero/network/safe-url`. |
| AI-templated webhook URL | `url` is a template-capable field (`choose-args.ts:242,372`) and the secret header goes to whatever URL results (`call-webhook.ts:136`) | A prompt-injected sender could steer the host and receive `X-Webhook-Secret` plus metadata. Not verified whether the editor permits `{{}}` in the URL. Worth closing regardless. |
| Write-tool prompt injection | Already labelled high risk (`risk.ts:97-101`) | The LLM fills only string args, and `buildPayload` owns the wire shape. Deterministic placeholders (gap 6) would shrink this surface. |
| Dynamic catalogs | Pipedream `filterWriteTools` relies on `readOnlyHint` plus name heuristics (`sync-tools.ts` `buildBuiltInTools`; `integrations.ts:334-347`) | Never route rule writes through heuristic read filters. Keep writes on an explicit allowlist. |

### 4.2 Cost

- LLM: zero extra calls if every integration arg is literal (`choose-args.ts:131`). Otherwise there is **one** `aiGenerateArgs` call per matched rule, batched across all its actions (`ai-choose-args.ts:112-121`), on top of the rule-matching call. Deterministic placeholders would let most integration actions run with no extra LLM call.
- MCP: a new client, connect and close per call (`call-tool.ts:33-67`) adds a handshake to every action. Composio server URLs are memoized per process (`composio.ts:92-93`).
- PostHog flag evaluation per execution when the env flag is off (`integration-action.server.ts:57-71`).
- Sequential execution inside `after()` with a 300 s budget (`route.ts:19`). A slow third-party call with no timeout delays every later action of every rule for that message.

### 4.3 Upstream-merge risk

Commits touching each file in the 90 days to HEAD (`git log --since='90 days ago' -- <file>`):

| File | Commits | Assessment |
| --- | --- | --- |
| `apps/web/prisma/schema.prisma` | 62 | Very hot. Keep additions to new models where possible. Migrations conflict by timestamp only. |
| `apps/web/env.ts` | 35 | Hot, but additive lines merge cleanly. |
| `apps/web/utils/mcp/integrations.ts` | 9 | Hot. Upstream adds apps here regularly. |
| `apps/web/utils/ai/actions.ts` | 7 | Touch only at the `integration()` seam. |
| `apps/web/utils/ai/choose-rule/run-rules.ts`, `apps/web/utils/actions/rule.validation.ts`, `apps/web/utils/rule/rule.ts` | 6 each | Avoid where possible. |
| `apps/web/utils/mcp/call-tool.ts` | 4 | Moderate |
| `apps/web/utils/ai/choose-rule/execute.ts` | 3 | Moderate |
| `apps/web/utils/mcp/tool-specs.ts`, `choose-args.ts`, `ActionSteps.tsx` | 2 each | Cooler, but gap 1 forces edits here. |

Upstream is actively building in this exact area. About 20 commits under `apps/web/utils/mcp/` since mid-September include the Composio provider (`5cbd62906`, 2026-09-28), custom MCP servers (`572446858`) and an MCP connection test (`eda6167aa`, 2026-10-19). The `INTEGRATION` action itself landed in `30d6949e9` (2026-08-11), with gating added in `b95e4d56d`. Upstream may well ship its own answer to gaps 1 and 4. Divergent changes to `tool-specs.ts` and `integrations.ts` are the most likely conflicts.

### 4.4 Other

- Exhaustive `switch` on `ActionType` (e.g. the `never` check in `PlanBadge.tsx:179-184`) means a new enum value forces edits across many files. 26 non-test files already reference `ActionType.INTEGRATION` or `integrationArgs`.
- The table names `McpConnection`/`McpIntegration` are MCP-specific. Reusing them for non-MCP apps is semantically awkward. A parallel table would mean a migration plus duplicate connect UI.

---

## 5. Extend or build alongside?

**Answer: extend the existing `INTEGRATION` action and its tool-spec contract. Do not add a new `ActionType` or a parallel action pipeline. Do add a transport seam beside MCP (and an auth seam beside MCP-DCR/Composio) so a spec can execute through MCP, a hosted provider, or a native API client.** New per-app code should live in new files, and hot files should change only at small seams.

Evidence:

1. **The modular interface mostly exists already.** `IntegrationToolSpec` (`tool-specs.ts:60-68`) is a per-tool module: argument schema, editor controls, AI-fill semantics, required-ness, rule-writer description and `buildPayload`. Validation, AI fill, risk, display, import/export and the v1 API are already generic over it (§2.2).
2. **The coupling to MCP is narrow.** It is the single `callMcpTool` call in `integration()` (`actions.ts:678-684`), the MCP-named `optionsTool` (`tool-specs.ts:41`), and connection lookup through `McpConnection`/`McpIntegration` (`actions.ts:639-653`). These are seams, not architecture.
3. **The persistence and outcome model already fits.** `Action.integration*`, `ExecutedAction.integration*` with resolved args, `{success:false, errorCode}` failure reporting, and per-action `FAILED` without aborting siblings (`execute.ts:107-119`; `executed-action-outcome.ts:18-23`).
4. **Building alongside duplicates a lot.** It would mean a new enum value (migration in the hottest file, 62 commits in 90 days), exhaustive switches, and reimplementing editor, validation, AI fill, risk, history, import/export and API handling across about 26 files (§4.4). It would also fork from the code upstream is actively evolving (§4.3).
5. **But "extend" must not mean "MCP only".** Gaps 2–5 show the MCP path cannot reach apps lacking a usable remote MCP server, cannot connect API-key apps, and does not yet wire Composio writes. Extending the spec with an execution target, and the registry with non-MCP auth, keeps one user-facing action while removing that ceiling.

Changes any "extend" design must make regardless (inputs to the design phase):

- Gap 1: multi-spec support. That means an integration/tool picker in `ActionSteps.tsx`, explicit naming in `create-rule-schema.ts`, and removing the `getOnlyIntegrationToolSpec` fallbacks.
- Gap 6: deterministic placeholders from the email and rule result, made available to `buildPayload`.
- Gap 7: capture the external object id/URL on `ExecutedAction`.
- Gap 9: timeout and bounded retry around the tool call, with the provider error preserved.
- Gap 11: dependent remote-select args.

The `CALL_WEBHOOK` path is a useful complement for automation hubs, but on its own it is not a substitute: its payload, error handling and auth are too thin (gap 13).

Open question for the design phase: reuse `McpConnection`/`McpIntegration` for non-MCP connections, or add an integration-neutral connection table. This is a trade-off between migration and merge cost on one side and naming clarity and constraint fit on the other. Decided in §6.4.

---

## 6. Design: is "one module per integration" right?

The starting hypothesis was a modular design: one module per third-party app behind a shared interface. This section argues against it, compares the alternatives, and lands on a recommendation.

### 6.1 Options

| Option | What it means | For | Against |
| --- | --- | --- | --- |
| **A. Per-app modules** | Each app is a self-contained module (auth, client, actions, UI) behind a common plugin interface, with its own execution path. | Full control of payloads and auth. No third-party token broker. Works for apps with no MCP server. Testable with mocked HTTP. | Every app is a maintenance and security liability (API drift, auth quirks, rate limits, token storage). A plugin framework is premature abstraction for one or two apps (`AGENTS.md`: "Avoid premature abstraction"). It duplicates the generic machinery the spec already drives (§2.2). It runs against upstream's direction (MCP plus hosted provider, §4.3). |
| **B. MCP / Composio only** | Add `IntegrationToolSpec`s and registry entries. Every call goes through an MCP server, either the app's own or a hosted provider's. | Smallest diff. Follows upstream. A hosted provider covers hundreds of apps without per-app auth code. | Reach is capped by which apps ship a remote MCP server with dynamic client registration (gap 2, gap 3). A hosted provider holds every user's tokens behind one platform key (§4.1) and is a paid dependency that self-hosters may not want. Tool schemas can change under us. Composio writes aren't wired yet (gap 4). |
| **C. Webhook + automation hubs only** | Strengthen `CALL_WEBHOOK` and let Zapier, Make, n8n, Activepieces or Pipedream do every app-specific step. | Covers the long tail with no per-app code. Users build any flow they like. | Every user needs a second paid product and has to wire flows by hand. No result capture or idempotency without callbacks. Today's payload, auth and failure handling are too thin (gap 13). Failures land outside Inbox Zero's history. |
| **D. Hybrid: one action contract, pluggable execution** | Keep `INTEGRATION` + `IntegrationToolSpec` as the single per-tool contract. Add an execution target per spec (`mcp` or `native`) and connection kinds beside MCP OAuth (API key + user token now, fixed OAuth client later). Hubs become one more integration on the same contract later. | Keeps everything that is already generic (§2.2). Each app picks the cheapest reliable path: an MCP server where a good one exists, a small native client where it doesn't. Native code is limited to one file per app that implements a narrow interface. The shared fixes (gaps 1, 6, 7, 8, 9, 11) apply to every app at once. | Two execution paths to test. Native clients still need per-app upkeep, but only for apps that need them. Some edits in hot files are unavoidable (§4.3). |

### 6.2 Recommendation

**Option D.** The hypothesis is right that integrations should be modular. It's wrong about where the module boundary goes. The unit should be the **action spec** (one tool of one app), which already exists and already drives validation, AI fill, risk, display, import/export and the API. It should not be a per-app plugin with its own pipeline. The modular part that's actually missing is narrow: *how* a spec executes and *how* its connection authenticates. So:

- No new `ActionType`, no plugin loader, no dynamic registration. Specs stay in a static list. Per-app native code lives in its own folder, `apps/web/utils/integrations/<app>/` (client, executors, option listers, tests), plus a connect page and action where the app needs one.
- MCP stays the default. An integration opts into `native` only when the app has no usable MCP server or one is unsuitable (no DCR, missing write tool, unacceptable token broker). The choice is made per integration, not per tool, because a credential from the MCP OAuth flow is bound to the MCP server and can't be reused for direct API calls.

Note on option A: the `native` target *is* option A, applied one tool at a time behind the shared action. What's rejected is a separate per-app pipeline and plugin framework, not per-app code.
- Automation hubs are deferred. They become a later integration on this contract, for example a "send to automation hub" action with a full payload, a signed request and result capture. That's better than growing `CALL_WEBHOOK` into a second integration system.

Pushback on the original framing: building "one module per integration" as a framework before the second integration exists would duplicate about 26 files of generic handling (§4.4) and pull away from code upstream changes every week. The spec-level contract gives the same extensibility at a fraction of the surface.

### 6.3 The contract a new integration provides

The contract is split in two because `tool-specs.ts` is imported by client code (`ActionSteps.tsx` via the `"use client"` `RuleForm.tsx`, `PlanBadge.tsx`, and `rule.validation.ts` through the form's `zodResolver`). The spec stays declarative and browser-safe. Everything that touches credentials, env or HTTP lives in a server-only executor table, `apps/web/utils/integrations/executors.server.ts`, keyed by integration (and tool).

| Concern | Shape | Notes |
| --- | --- | --- |
| **Registry (per integration)** | Entry in `MCP_INTEGRATIONS` gains `execution: "mcp" \| "native"` (default `"mcp"`) and, for native, `connectKind: "api-token-paste" \| "token-redirect"`. The existing `authType` / `provider` fields are left as they are. Fixed-client OAuth is added only when an app needs it. | `execution` sits at integration level because MCP-OAuth tokens are bound to the MCP server (resource parameter, `integrations.ts:11` `skipResourceParam`). |
| **Connect (native)** | `api-token-paste`: the user pastes a token into a form, and a server action stores it. `token-redirect`: the server issues a state nonce and redirects to the app's authorize page. A client page under `app/(app)/[emailAccountId]/integrations/` receives the token from the URL fragment, checks the nonce, and posts the token to a server action. Both paths run `assertIntegrationsTierAccess`, encrypt the token into `McpConnection.accessToken`, and take any app-level key from env (`.env.example`, `env.ts`, `turbo.json`). | A server route never sees a URL fragment, so the capture page must be client-side. Trello's exact flow is checked against its docs in Phase 5. |
| **Server executor (native)** | `executors.server.ts` entry: `run(connection, payload, { signal }) => IntegrationCallResult`, `listOptions(connection, argKey, parentValues)`, `testConnection(connection)`, `revoke(connection)` (best-effort token revoke on disconnect). MCP integrations may register `parseResult(raw)` only. `IntegrationCallResult = { externalId?, url? }`. | Native connections never write `McpTool` rows, so chat and agents never load them (`utils/ai/mcp/mcp-tools.ts:26-35`). |
| **Config (per rule action)** | `args[]` as today (`text`, `select`, `remote-select`). `remote-select` gains `dependsOn: string[]`. The options route accepts validated parent values: native calls `listOptions`, and MCP specs supply `buildOptionsArgs(parentValues)` for their options tool. The editor clears child values when a parent changes. | Fixes gap 11. Today's route calls MCP options tools with `args: {}` (`arg-options/route.ts:50-55`). |
| **Trigger input (rule result)** | Deterministic placeholders in **text args only** (never select or remote-select, which store literal option values, `tool-specs.ts:15-19`), with a syntax that contains no `{{`. Values: `subject`, `from`, `to`, `date`, `snippet`, `link` (built with `getEmailUrlForMessage`, `utils/url.ts:190`), `ruleName`. They're resolved in `choose-args.ts` after the AI merge, in literal text only, never re-parsed, and before persistence, so `ExecutedAction.integrationArgs` holds final values. This also runs when no AI fill is needed (the `choose-args.ts:131-133` early return). The required-arg check runs after resolution. `addIntegrationActionIssues` (`rule.validation.ts:477-545`) rejects unknown placeholders. | Fixes gap 6 with no LLM call. Because substituted text is never re-parsed, a sender-controlled subject that contains template syntax can't become an AI prompt. The rule's AI `reason` is model output, so it isn't offered as a placeholder. |
| **Result** | The outcome path extracts `IntegrationCallResult` (on the same pattern as `sentMessageIds` in `executed-action-outcome.ts:25-48`) into a new nullable `ExecutedAction.integrationResult` JSON column. `ResultDisplay.tsx` renders `url` as a link only if it's `https:`. | Fixes gap 7. The value is third-party output, so a `javascript:` URL is possible. |
| **Errors / retry** | A classified `IntegrationError { kind: "auth" \| "rate_limit" \| "not_sent" \| "maybe_sent" \| "permanent", providerMessage }`. One shared wrapper applies: 15 s per-call timeout; at most 3 attempts and 30 s total; retry **only** `not_sent` (connect or DNS failure before the request was sent) and `rate_limit` (429, honouring `Retry-After` up to 10 s); never retry a timeout or 5xx on a write. Those are recorded `FAILED` with "may have been created". `auth` (401, revoked token) deactivates the connection and shows "Reconnect", mirroring `deactivateConnection` (`oauth.ts:248`). A trimmed `providerMessage` is stored in `executionError`. | Fixes gap 9. Retrying a timed-out create would duplicate the object, since apps like Trello offer no idempotency key. The numbers keep a message's actions inside the 300 s `after()` budget (§4.2). |
| **Idempotent rerun** | Before running an `INTEGRATION` action, look for an existing `ExecutedAction` with `SUCCEEDED` status and an `integrationResult.externalId` for the same `(emailAccountId, messageId, ruleId, integrationName, integrationToolName)`. If one exists, record the action `SKIPPED` ("already created") with a link to the existing object. This covers single rerun (`utils/actions/ai-rule.ts`) and bulk rerun (`assistant/bulk-run.ts:103-118`), because both reach `executeAct`. There's no per-action override in v1. | `ExecutedAction` has no `actionId`, and rerun creates a fresh `ExecutedRule` (`run-rules.ts:465`), so the match is on the tuple. Known limit: two identical tool actions in one rule share a match. |

### 6.4 Decisions inside the recommendation

| Decision | Choice | Why | Revisit if |
| --- | --- | --- | --- |
| Connection storage | Reuse `McpConnection` / `McpIntegration` for native connections (`accessToken`, `refreshToken` and `apiKey` are already encrypted, `prisma-extensions.ts:20`). | The reason is the integrations page: its list, status, connect and disconnect rows and its tier gating already read these tables, so a native app shows up there with no parallel UI. Upstream's other native connections each have their own table (`calendarConnection`, `driveConnection`, `messagingChannel`), so this is a deliberate exception, not the house pattern. | Native connections need columns MCP rows can't hold, or upstream renames the table. |
| MCP-assuming paths to branch on `execution` | Connection test (`utils/actions/mcp.ts:73-103` → `syncMcpTools` → `listMcpTools`, which throws "No server URL", `server-connection.ts:28-30`); the connect block for `api-token` (`IntegrationRow.tsx:66-75`, `auth-url/route.ts:75-80`); disconnect, which only revokes for hosted providers (`mcp.ts:38-45`); token lookup (`getAuthToken` api-token branch, `oauth.ts:183-202`); `callMcpTool` in `integration()`; the options route. | Each one would misbehave or show "Could not reach the server" for a native connection. | — |
| Result capture | One nullable JSON column on `ExecutedAction` (`integrationResult`). | Needed for history links and idempotent rerun. An additive migration merges cleanly. | Upstream adds an equivalent field. |
| Multi-spec | Integration and tool picker in the rule editor. The AI rule writer must name integration and tool (`utils/ai/rule/create-rule-schema.ts:187`). Remove the `getOnlyIntegrationToolSpec` fallbacks. The v1 API doesn't accept `INTEGRATION` actions today (`app/api/v1/rules/validation.ts:32-49`), and that stays out of scope. | Any second spec breaks the current fallbacks (gap 1), so this is a precondition. Adding specs to the AI rule writer grows what the model sees, and `AGENTS.md` requires explicit approval for that, so it's raised with the maintainer during planning. | — |
| Composio writes | Pass `ruleActionWriteTools` into the hosted server's allowed list (gap 4). | A small, generic fix that makes option B usable where it fits. | Upstream fixes it first. |
| Webhook | Out of scope for the shared layer. The AI-templated URL / secret-header issue (§4.1) is recorded as a separate fix. | Keeps this change focused, and that issue is independent of integrations. | — |

### 6.5 What would change this recommendation

- **Upstream ships multi-spec support or a transport seam first.** Rebase onto theirs and drop ours.
- **Most target apps gain solid remote MCP servers with DCR.** The native target then becomes unnecessary, and option B alone suffices.
- **Using a hosted token broker is acceptable for every deployment.** Native clients then shrink to apps the broker doesn't cover.
- **Users prefer to build flows in automation hubs rather than inside Inbox Zero.** Invest in the hub action (option C as an integration) before more native apps.
