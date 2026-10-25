# __tests__

**Parent context:** `../AGENTS.md`
**Generated:** 2026-10-23 · **Updated:** 2026-10-23

## Purpose

Everything that is not a colocated unit test. Unit tests live next to the code they test (`utils/foo.test.ts`); this directory holds the heavier tiers plus the shared test setup, mocks, and emulators. Each tier is gated by an environment flag so the default `pnpm test` stays fast and offline.

## Key Files

| File | Description |
| --- | --- |
| `setup.ts` | Vitest `setupFiles` entry. Imports `test-env.ts`, mocks `server-only`, `next/server` `after()` (runs inline), and QStash signature verification |
| `test-env.ts` | Side-effect import that sets env defaults (`DATABASE_URL`, auth/encrypt secrets, `DEFAULT_LLMS`, ...) before `@/env` validates. Standalone scripts must import it first |
| `helpers.ts` | Shared builders: `createTestLogger`, `getEmailAccount`/`getEmail`/`getRule`/`getAction`/`getMockMessage` factories, `createWith*TestMiddleware` wrappers for route handlers |
| `mocks/email-provider.mock.ts`, `mocks/sentry-nextjs.mock.ts` | Reusable mocks for the `EmailProvider` abstraction and Sentry |
| `ai-assistant-chat.test.ts` | Ungated mocked unit test for assistant chat behavior (runs in the default suite) |
| `index.md` | Generated directory index |

## Subdirectories

| Directory | Tier / Flag | Description |
| --- | --- | --- |
| `playwright/` | `pnpm test:playwright:emulated` | Browser tests against local emulators (see `playwright/AGENTS.md`) |
| `eval/` | `RUN_AI_TESTS=true` | Cross-model LLM evals with a judge (see `eval/AGENTS.md`) |
| `ai-regression/` | `RUN_AI_TESTS=true` | Live-LLM regression tests (see `ai-regression/AGENTS.md`) |
| `integration/` | `RUN_INTEGRATION_TESTS=true` | Emulator-backed provider tests (see `integration/AGENTS.md`) |
| `e2e/` | `RUN_E2E_TESTS=true` / `RUN_E2E_FLOW_TESTS=true` | Real Gmail/Outlook (see `e2e/AGENTS.md`) |
| `db/` | `RUN_DB_TESTS=true` | Real Postgres (see `db/AGENTS.md`) |
| `emulator/` | none | `google-mail-query.test.ts`, `microsoft-mail-query.test.ts`: start an in-process emulator and run in the default suite (not flag-gated) |
| `emulators/` | shared | In-repo fake servers: `llm.ts` (OpenAI-compatible), `stripe.ts`, `recall.ts`, `todoist-mcp.ts`, `knowledge-base-mcp.ts`; `llm.test.ts` tests the LLM emulator |
| `fixtures/inboxes/` | shared | Demo inbox data (`demo-inboxes.ts`) and adapters that seed it into emulators |
| `redis/` | `RUN_INTEGRATION_TESTS=true` | `local-mail-sync-budget.test.ts` (see `redis/README.md`); gated, but outside `integration/` so `pnpm test-integration` does not pick it up |

## For AI Agents

### Working In This Directory

- Pick the cheapest tier that can catch the bug: unit (mocked, colocated) then `db/` (when the behavior is Postgres itself) then `integration/` (emulator) then `playwright/emulated` (UI) then `e2e/` (real providers, last resort).
- Most heavy suites wrap its `describe` in `describe.skipIf(!RUN_X)` / `describe.runIf(RUN_AI_TESTS === "true")`. Without the flag the file reports as skipped, so a green default run says nothing about these tiers.
- `vitest.config.mts` excludes `__tests__/playwright/**`; Playwright specs are never run by vitest. It loads `.env.test` (or `.env.e2e` when `RUN_E2E_FLOW_TESTS=true`).
- Do not mock `@/utils/logger` (see root `AGENTS.md`); use `createTestLogger()` from `helpers.ts`.
- Read `.claude/skills/testing/SKILL.md` and the matching sub-file before writing a test.

### Testing Requirements

Run from the repo root unless noted:

```bash
pnpm test apps/web/utils/rule/chat-rule-risk.test.ts   # one unit test (RUN_AI_TESTS=false)
pnpm test                                      # all unit tests
pnpm test-integration                          # RUN_INTEGRATION_TESTS=true, --dir __tests__/integration
pnpm test-db                                   # RUN_DB_TESTS=true, --dir __tests__/db
pnpm --filter inbox-zero-ai test-ai __tests__/eval/your-feature.test.ts
pnpm --filter inbox-zero-ai test-e2e           # RUN_E2E_TESTS=true
pnpm --filter inbox-zero-ai test-e2e:flows     # RUN_E2E_FLOW_TESTS=true, e2e/flows only
pnpm -F inbox-zero-ai test:playwright:emulated mail
```

### Common Patterns

- `vi.mock("server-only", () => ({}))` is already global via `setup.ts`; older files repeat it, new ones need not.
- Factories in `helpers.ts` return `EmailAccountWithAI` with `aiProvider`/`aiModel`/`aiApiKey` as `null` so the default model path is used.

## Dependencies

### Internal

- `@/utils/*` code under test, `@/generated/prisma`, `@/utils/__mocks__/prisma`.
- `apps/web/scripts/run-*-emulator.ts` start the emulators in `emulators/` outside tests.

### External

- `vitest`, `@testing-library/react` + `jsdom` (component tests), `@playwright/test`, `emulate` (`@inbox-zero/emulate`) for Google/Microsoft fakes.

## Manual Notes

Notes under this heading are written by humans and preserved on regeneration.
