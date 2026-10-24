# Quickstart: validating the shared integrations layer

How to prove the layer works without any real third-party app. Implementation detail lives in [tasks.md](./tasks.md); interfaces in [contracts/](./contracts/).

## Prerequisites

- Run from the repository root of the `feat/integrations` worktree.
- Dependencies installed once (task T001): `bash scripts/pnpm-install-without-desktop.sh --frozen-lockfile` (the install CI uses; `pnpm install --frozen-lockfile` also works). `postinstall` runs `prisma generate`; no database is contacted.
- The app's `.env` is gitignored and absent in this worktree. Unit tests do not need it: `apps/web/__tests__/test-env.ts` supplies placeholder values, and Prisma is mocked.
- No database, network access or third-party account is needed for any test below.

## Targeted test form

```bash
pnpm test <path relative to apps/web>      # e.g. pnpm test utils/integrations/call-policy.test.ts
```

The root `test` script runs Vitest inside `apps/web`, and Vitest matches filters against paths relative to `apps/web`. A filter starting with `apps/web/` matches nothing. Confirm the summary line reports the expected file count (`Test Files  1 passed (1)`), not "No test files found".

## Scenario checks (all unit-level, fixture-backed)

| Spec story | Command | Expected |
| --- | --- | --- |
| US1 execution and result (native and MCP) | `pnpm test utils/integrations/run-integration-action.server.test.ts utils/ai/actions.test.ts` | Fixture receives one call; result `{ externalId, url }` returned; MCP parser path stores the same shape; gate-off still `SKIPPED`. |
| US1 persistence and history guard | `pnpm test utils/ai/choose-rule/execute.test.ts utils/integrations/result.test.ts` | `integrationResult` written on SUCCEEDED and rerun SKIPPED; `javascript:` URL rejected. |
| US2 placeholders | `pnpm test utils/integrations/placeholders.test.ts utils/ai/choose-rule/choose-args.test.ts utils/ai/choose-rule/choose-args.security.test.ts utils/actions/rule.validation.test.ts` | Markers resolved with zero AI calls; subject containing `{{…}}`/`[[…]]` stays literal; unknown marker rejected at save. |
| US3 retry and classification | `pnpm test utils/integrations/call-policy.test.ts utils/integrations/http.test.ts utils/mcp/call-tool.test.ts` | Attempts, waits and kinds match data-model.md; never retries `maybe_sent`. |
| US4 rerun protection | `pnpm test utils/integrations/idempotency.server.test.ts utils/integrations/run-integration-action.server.test.ts` | Prior result from an earlier run → no fixture call, `SKIPPED` with prior link; two identical actions in one run both execute. |
| US5 connect/test/disconnect | `pnpm test utils/integrations/connection.server.test.ts utils/actions/mcp.test.ts app/api/mcp/integrations/route.test.ts` | Tier enforced, token trimmed and verified before save, bad state rejected, revoke called on disconnect (and a hung revoke still deletes), no `McpTool` rows, native apps hidden when gated off. |
| US6 picker and dependent options | `pnpm test utils/integrations/editor.test.ts utils/integrations/arg-options.server.test.ts utils/mcp/tool-specs.test.ts` | Single tool preselected; child cleared on parent change; undeclared parent keys refused. |
| US7 hosted-provider write tools | `pnpm test utils/mcp/server-connection.test.ts` | Provider receives read and write tools. |
| US8 (only if owner approved) | `pnpm test utils/ai/rule/create-rule-schema.test.ts utils/rule/rule.test.ts` | One rule-writer option per tool, app and tool saved. |

## End-of-phase verification (run once, after all tasks)

```bash
pnpm test                                   # full unit suite
pnpm lint                                   # Biome via turbo
pnpm konsistent                             # repo conventions (server-action and validation files)
pnpm --filter inbox-zero-ai check-server-actions
pnpm --filter inbox-zero-ai check-enums
# CI-aligned type/build check. .env is absent here, so use CI's non-secret placeholder values
# (the same ones in .github/workflows/build-check.yml):
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres AUTH_SECRET=secret \
GOOGLE_CLIENT_ID=client_id GOOGLE_CLIENT_SECRET=client_secret GOOGLE_PUBSUB_TOPIC_NAME=topic \
EMAIL_ENCRYPT_SECRET=secret EMAIL_ENCRYPT_SALT=salt DEFAULT_LLMS=openai:gpt-5.4-mini \
INTERNAL_API_KEY=secret NEXT_PUBLIC_BASE_URL=http://localhost:3000 \
NODE_OPTIONS=--max_old_space_size=16384 \
pnpm --filter inbox-zero-ai build:ci
```

Run `build:ci` in the background with a bounded timeout (AGENTS.md). Turbo prefixes test output lines with `inbox-zero-ai:test:`, so match summary lines without a `^\s+` anchor. List changes with `git status --porcelain` (it includes untracked files, unlike `git diff --stat`); never stage `.omc/`, `apps/web/.omc/` or `.specify/`. Then grep, without truncating, for any editor affordance whose visible name changed:

```bash
grep -rn "Add Todoist task\|Connect Todoist\|Integration" apps/web/__tests__/playwright
```

The focused browser spec (`pnpm -F inbox-zero-ai test:playwright:emulated automation/integration-action.spec.ts`; the runner takes an area or a spec path relative to `__tests__/playwright/emulated`) needs the emulated environment and a database. Run it only if the owner confirms that environment is available. Locally, use a throwaway Postgres (the config defaults to port 5433) and Redis-over-HTTP rather than the dev database, because the spec's helpers delete integration rows, and leave `NEXT_PUBLIC_BASE_URL` unset so the runner picks a free port instead of reusing a server already on port 3000. In dev mode the shared sign-in setup can exceed its 30-second wait while pages compile on demand; running as CI does (`build:ci` with `NODE_ENV=production`, then `PLAYWRIGHT_PRODUCTION=1` with a fixed `NEXT_PUBLIC_BASE_URL`) avoids that.

## Database migration

The migration file is created in T002. Applying it (`prisma migrate dev` / `migrate deploy`) to a local dev database is additive (one nullable column) and safe for other branches that share that database, but **ask the owner before applying**. No test in this phase needs it applied.
