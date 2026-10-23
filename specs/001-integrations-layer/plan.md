# Implementation Plan: Shared integrations layer for rule actions

**Branch**: `feat/integrations` (existing worktree branch; no new branch) | **Date**: 2026-10-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-integrations-layer/spec.md`; approved design `docs/integrations/00-current-state.md` §6.3–§6.4.

## Summary

Extend the existing `INTEGRATION` rule action (no new `ActionType`) into a shared layer: each integration declares `execution: "mcp" | "native"`; native integrations plug a server-only executor (run, listOptions, testConnection, revoke) into one table; every call goes through one shared call policy (15 s per attempt, ≤3 attempts, ≤30 s total, retry only `not_sent` and `rate_limit`); successful calls return `{ externalId?, url? }`, stored in a new nullable `ExecutedAction.integrationResult` JSON column and used for history links and rerun protection; text args gain deterministic `[[field]]` placeholders resolved after AI fill in author-written text only; native apps connect by token paste or token redirect into the existing `McpConnection` row; the editor gains an integration/tool picker and dependent remote selects. All new logic lives in `apps/web/utils/integrations/`; existing hot files change only at call-site seams. A test-only fixture integration exercises every path without any real third-party app.

## Technical Context

**Language/Version**: TypeScript (strict null checks), Node 24 (CI), Next.js App Router (`apps/web`).

**Primary Dependencies**: Prisma 7 (generated client at `apps/web/generated/prisma`, gitignored, produced by `postinstall: prisma generate`), Zod, next-safe-action, SWR, React Hook Form, `@modelcontextprotocol/sdk` (existing MCP path). No new packages.

**Storage**: PostgreSQL via Prisma. One additive column: `ExecutedAction.integrationResult Json?`. Native credentials reuse `McpConnection.accessToken` (already encrypted by `apps/web/utils/prisma-extensions.ts`).

**Testing**: Vitest (`apps/web/vitest.config.mts`, setup `apps/web/__tests__/setup.ts`, env defaults from `apps/web/__tests__/test-env.ts`, so no `.env` is needed). Co-located `*.test.ts`. Prisma mocked with `@/utils/__mocks__/prisma`; real logger (never mock `@/utils/logger`). Targeted run from repo root: `pnpm test <path relative to apps/web>` (root script is `turbo run test --filter=./apps/web -- --run`, and Vitest matches filters against paths relative to `apps/web`, so a repo-root `apps/web/...` prefix would match nothing). T001 confirms this form.

**Target Platform**: Next.js server (route handlers, server actions, `after()` webhook processing) and browser (rule editor, integrations page).

**Project Type**: Web application in a pnpm/turbo monorepo; this feature touches only `apps/web`.

**Performance Goals**: Zero extra LLM calls for actions using only placeholders and literals; no integration action consumes more than 30 s of the 300 s `after()` budget.

**Constraints**: Upstream-merge risk (§4.3): `schema.prisma` (62 commits/90 days), `env.ts`, `utils/mcp/integrations.ts`, `utils/ai/actions.ts`, `run-rules.ts`, `rule.validation.ts`, `rule.ts` are hot. Touch only at small seams. `run-rules.ts` is not touched. `tool-specs.ts` is imported by client code and must stay browser-safe. Public repository: no private details in code, comments or docs.

**Scale/Scope**: About 14 new source files plus tests, about 16 existing files touched at seams, 1 migration. No app-specific integration.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is the unfilled template, so there are no ratified constitution gates. The repository's binding rules are `AGENTS.md`; they are used as the gate set:

| Gate (from AGENTS.md) | Status | How the plan complies |
| --- | --- | --- |
| Co-located unit tests; no low-value tests; real logger | Pass | Each logic module has a co-located test that asserts behaviour; UI-only tasks get lint plus helper tests, no render tests. |
| Avoid premature abstraction; no layer without meaning | Pass | No plugin loader or dynamic registration. One static executor table. Helpers only where they name a domain concept (call policy, placeholders, rerun lookup). |
| No barrel files, no re-exports, helpers at bottom, imports at top | Pass | Direct imports from each new file. |
| Infer types from Zod | Pass | `IntegrationCallResult` inferred from its schema; server-action inputs inferred from `*.validation.ts`. |
| Mutations via next-safe-action; validation in `utils/actions/*.validation.ts` | Pass | New `utils/actions/integrations.ts` + `integrations.validation.ts` (also satisfies the `konsistent.json` rules). |
| One resource per API route | Pass | Existing options route extended; one new client page for token capture; no new API route. |
| Never dynamic Prisma transactions | Pass | Upserts and single updates only. |
| Env vars in `.env.example`, `env.ts`, `turbo.json` | Pass (N/A) | The shared layer adds no env var (spec FR-031). |
| Model-facing changes need explicit owner approval and disclosure | Pass (gated) | The rule-writer change is spec Q1, task T026, last and droppable. Default: not applied. |
| Prefer EmailProvider abstraction; provider checks only at boundaries | Pass | Only the existing `getEmailUrlForOptionalMessage({ …, provider, externalUrl })` is used for the `link` placeholder. |
| Respect module boundaries | Pass | Shared code in `utils/integrations/`; MCP code stays in `utils/mcp/`; app code (later) in `utils/integrations/<app>/`. |
| Do not run `dev`/`build` unless asked; no root `tsc --noEmit` | Pass | Per-task checks are targeted tests and Biome. `build:ci` runs once at the end because the owner's Phase 4 "done" requires a type check. |

Post-design re-check (after Phase 1 artifacts): still passing. The one added abstraction beyond the design is `utils/integrations/http.ts` (classified `fetch` for native clients); it is justified because HTTP-status-to-error-kind mapping is a correctness rule every native client must share (AGENTS.md: "Do not duplicate … correctness-sensitive rules").

## Project Structure

### Documentation (this feature)

```text
specs/001-integrations-layer/
├── plan.md              # This file
├── research.md          # Phase 0: decisions on open technical points
├── data-model.md        # Phase 1: entities, fields, validation, state transitions
├── quickstart.md        # Phase 1: how to validate the layer end to end
├── contracts/
│   ├── integration-contract.md   # Registry entry, tool spec, server executor, call result, errors
│   ├── placeholders.md           # Marker grammar and resolution rules
│   └── endpoints-and-actions.md  # Options route, connect server actions, token-capture page
├── checklists/requirements.md
└── tasks.md             # Phase 2 (speckit-tasks)
```

### Source Code (repository root)

```text
apps/web/
├── prisma/
│   ├── schema.prisma                                   # +1 line: ExecutedAction.integrationResult Json?
│   └── migrations/<timestamp>_executed_action_integration_result/migration.sql   # new
├── utils/integrations/                                 # NEW: all shared-layer logic
│   ├── types.ts                 # IntegrationError, error kinds, NativeIntegrationExecutor, NativeConnection
│   ├── result.ts (+ .test.ts)   # integrationCallResultSchema, parse, https-only URL guard (browser-safe)
│   ├── placeholders.ts (+ .test.ts)   # [[field]] grammar, values builder, literal-only rendering (browser-safe)
│   ├── call-policy.ts (+ .test.ts)    # timeout / retry / budget wrapper
│   ├── http.ts (+ .test.ts)           # fetch → IntegrationError classification for native clients
│   ├── executors.server.ts            # static NATIVE_EXECUTORS + MCP_RESULT_PARSERS tables and lookups (empty in this phase)
│   ├── idempotency.server.ts (+ .test.ts)   # prior-result lookup for rerun protection
│   ├── run-integration-action.server.ts (+ .test.ts)   # execution core called by actions.ts
│   ├── connection.server.ts (+ .test.ts)    # load/deactivate native connection; paste and redirect connect flows
│   ├── arg-options.server.ts (+ .test.ts)   # dependent remote-select options (native or MCP)
│   └── editor.ts (+ .test.ts)               # picker choices, dependent-field clearing, parent values (browser-safe)
├── __tests__/fixtures/integrations/fixture-integration.ts   # NEW test-only fixture (never imported by product code)
├── app/api/mcp/integrations/route.test.ts                     # NEW: listing visibility (spec FR-032)
├── utils/actions/integrations.ts, integrations.validation.ts  # NEW server actions (connect paste / redirect start / complete)
├── app/(app)/[emailAccountId]/integrations/
│   ├── IntegrationRow.tsx                    # seam: native connect branch
│   ├── NativeTokenPasteDialog.tsx            # NEW
│   └── connect/[integration]/page.tsx, TokenRedirectCapture.tsx   # NEW client capture page
├── app/(app)/[emailAccountId]/assistant/
│   ├── ActionSteps.tsx                       # seam: picker, parents, child clearing, placeholder hint
│   ├── IntegrationToolPicker.tsx             # NEW: tool picker and placeholder hint (new JSX lives here, not in ActionSteps)
│   └── ResultDisplay.tsx                     # seam: result link, new error copy
├── app/api/mcp/[integration]/arg-options/route.ts   # seam: delegate with parent values
├── app/api/mcp/integrations/route.ts         # seam: expose execution/connectKind; hide native when gated off
├── hooks/useIntegrationArgOptions.ts         # seam: parent values in request and SWR key
└── seams in: utils/mcp/integrations.ts, utils/mcp/tool-specs.ts, utils/mcp/call-tool.ts,
    utils/mcp/server-connection.ts, utils/ai/actions.ts, utils/ai/executed-action-outcome.ts,
    utils/ai/choose-rule/execute.ts, utils/ai/choose-rule/choose-args.ts,
    utils/actions/rule.validation.ts, utils/actions/mcp.ts
    (owner-gated T026 only: utils/ai/rule/create-rule-schema.ts, utils/ai/assistant/tools/rules/shared.ts,
    utils/rule/rule.ts, and their tests)
```

**Structure Decision**: Single web app (`apps/web`). New logic in `apps/web/utils/integrations/` per design §6.2. Browser-safe modules (`types.ts`, `result.ts`, `placeholders.ts`, `editor.ts`) have no `server-only`, env or Prisma imports; `*.server.ts` modules import `server-only`.

## Key design decisions (summary; details in research.md)

1. **Fixture strategy**: product lookups stay static. Tests inject the fixture by mocking the lookup modules (`@/utils/integrations/executors.server`, and where needed `findIntegration` / `getIntegrationToolSpec` via `vi.mock(..., async (importOriginal) => …)`), and browser-safe helpers take the spec list as a parameter. The fixture file lives under `apps/web/__tests__/fixtures/` and is never imported by product code.
2. **Remote-select shape**: the control gains `source?: "mcp" | "native"` (default `"mcp"`, so the Todoist spec is unchanged), `dependsOn?: string[]`, and for MCP `buildOptionsArgs?(parents)`. `getIntegrationRemoteSelectTools` ignores native fields.
3. **MCP errors**: `callMcpTool` keeps its message but throws `IntegrationError` with a kind (connect failure → `not_sent`; HTTP 401 → `auth`; 429 → `rate_limit`; tool `isError` → `permanent` with the tool's text; abort or other in-call failure → `maybe_sent`) and accepts an `AbortSignal`.
4. **Placeholders**: one post-processing call in `getActionItemsWithAiArgs`, deciding per arg from the original stored value; markers are replaced in literal parts only (split with `TEMPLATE_VARIABLE_PATTERN` so `placeholders.ts` stays browser-safe) and AI vars are inserted between them, so AI output and inserted values are never scanned. `link` uses `getEmailUrlForOptionalMessage` (Outlook-correct).
5. **Error codes** (stored in `executionError.code`): `INTEGRATION_AUTH_FAILED`, `INTEGRATION_RATE_LIMITED`, `INTEGRATION_NOT_SENT`, `INTEGRATION_MAYBE_SENT`, and `INTEGRATION_CALL_FAILED` (permanent; existing). Rerun skip reason: `INTEGRATION_ALREADY_CREATED`.
6. **Sequencing of single-spec fallback removal**: editor fallbacks go in T024; rule-save and rule-writer fallbacks only in the owner-gated T026 (spec design note 2). `getOnlyIntegrationToolSpec` itself stays, because the no-argument action label (`utils/action-display.tsx`, `AvailableActionsPanel.tsx`) and the Playwright spec depend on it.
8. **Rerun protection** excludes the current ExecutedRule (`execute.ts` persists each SUCCEEDED outcome before the next action runs) and uses no JSON-path filter.
9. **Failure isolation**: `runIntegrationAction` never throws; any unexpected error becomes a failed result for that action only. A result-parse failure after a successful call records SUCCEEDED with no result.
10. **Provider message**: kept out of thrown messages and logs above trace, stored in `executionError.message`, rendered in history (spec design note 10).
7. **Migration**: hand-written additive SQL (`ALTER TABLE "ExecutedAction" ADD COLUMN "integrationResult" JSONB;`). Applying it to a local dev database is additive and safe for other branches, but the implementer must ask before applying; unit tests never need it.

## Verification strategy

- Per task: one targeted command (listed in tasks.md), normally `pnpm test <file(s) relative to apps/web>`; UI tasks add `pnpm exec biome check <files>`. Turbo prefixes output lines with `inbox-zero-ai:test:` and may replay a cached result for unchanged inputs (still valid); for raw Vitest output use `pnpm --filter inbox-zero-ai exec vitest run <path>`.
- End of phase, once: `pnpm test` (full unit suite), `pnpm lint`, the `konsistent` and server-action export checks, and `pnpm --filter inbox-zero-ai build:ci` with CI's placeholder env values (see quickstart.md). Plus a grep of `apps/web/__tests__/playwright` for any renamed editor affordance; the focused Playwright spec `integration-action` runs only if the emulated environment is available (owner confirms).

## Complexity Tracking

No constitution violations. One deliberate exception to house style, inherited from the approved design §6.4: native connections reuse `McpConnection`/`McpIntegration` instead of a per-app table, so the existing integrations page, status, connect/disconnect and tier gating work unchanged.
