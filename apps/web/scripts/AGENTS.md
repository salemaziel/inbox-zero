# scripts

**Parent context:** `../AGENTS.md`
**Generated:** 2026-10-23 · **Updated:** 2026-10-23

## Purpose

Command-line scripts for the web app: CI guard checks, the one-command local dev launcher, local emulators for third-party services, Playwright report and PR-comment tooling, eval reporting, and one-off operational scripts (billing, Redis, Tinybird, user migration). Nothing here ships in the production bundle. Several files are small guards run from `package.json` scripts and `.github/workflows/test.yml`.

## Key Files

| File | Description |
| --- | --- |
| `check-enum-imports.js` | Fails if a Prisma enum value is imported from `@/generated/prisma/client`; enums must come from `@/generated/prisma/enums` (`pnpm check-enums`) |
| `check-server-action-exports.js` | Fails if a `"use server"` file exports anything beyond intentional actions (`pnpm check-server-actions`) |
| `check-client-redirects.js` | Fails on direct `location.href` / `assign` / `replace` redirects; use `redirectToSafeUrl` from `utils/redirect.ts` (`pnpm check-client-redirects`) |
| `check-test-fixtures.ts` | Fixtures may only use reserved example domains; stray `.jsonl` eval data under `__tests__` is an error (`pnpm check-test-fixtures`, `--staged` for staged files) |
| `local-dev.ts` | Launcher behind `pnpm local:start` from the repo root; state in `.context/local-dev/`; helpers in `local-dev/` |
| `emulate-seed.ts`, `write-emulate-seed.ts` | Build the seed JSON for the Google and Microsoft emulators from demo inbox fixtures in `__tests__/fixtures/inboxes/` (`pnpm emulate:seed`) |
| `run-llm-emulator.ts`, `run-recall-emulator.ts`, `run-stripe-emulator.ts`, `todoist-mcp-emulator.ts` | Standalone local emulators for an OpenAI-compatible model, Recall, Stripe, and Todoist MCP |
| `playwright-pr-comment.ts`, `build-playwright-pr-comment.ts` | Build the screenshot comment posted on PRs from a Playwright review JSON |
| `playwright-report-dashboard.ts`, `generate-playwright-report-dashboard.ts` | Build the HTML dashboard of Playwright run history and screenshots |
| `playwright-screenshot-diff.ts`, `png-validation.ts` | Pixel-difference ratio between screenshots, and size and dimension checks for PNG inputs |
| `measure-playwright-selection.mjs` | Measures which emulated Playwright targets a set of changed files selects |
| `eval-ablate.ts`, `eval-compare-runs.ts`, `eval-pool-ablations.ts` | Eval analysis scripts |
| `generate-llm-pricing.ts` | Regenerates model pricing data from OpenRouter |
| `build-mcp-app.mjs` | Builds the optional MCP mail client UI only if its source is present; part of `build` and `build:ci` |
| `vercel-ignore-build.sh` | Vercel "ignored build step": exit 1 means build, exit 0 means skip (preview builds skip unless the branch is `main` or `staging`, or `FORCE_VERCEL_PREVIEW_BUILD` is set) |
| `migrate-microsoft-provider-account-ids.ts`, `purge-orphaned-tinybird-data.ts` | One-off data fixes; dry run by default, with an apply flag |
| `listIncompleteStripeSubscriptions.ts`, `listSubQuantitiesLemon.ts`, `listRedisUsage.ts`, `addUsersToResend.ts`, `setup-telegram-bot.ts` | Ad hoc operational scripts that read production-like env |

## Subdirectories

| Directory | Description |
| --- | --- |
| `emulator/` | Long-running local stack (real web backend with Google and Microsoft emulators, throwaway Postgres and Redis), driven by `stack.mjs` with `up`, `down`, or `reset`; includes an integration-test mode with a response-loss proxy. See `emulator/README.md` |
| `local-dev/` | Modules for `local-dev.ts`: environment generation, port lock, process management, Redis HTTP shim |
| `eval-report/` | `generate-eval-report.ts`, `aggregate.ts`, `render-html.ts`: aggregate eval run output into an HTML report (`pnpm eval-report`) |
| `lib/` | `source-files.js`: shared file walker used by the `check-*.js` guards |

## For AI Agents

### Working In This Directory

- The `check-*.js` guards are plain CommonJS (the redirect check also uses the `typescript` compiler API), so they run without a build step. Share file traversal through `lib/source-files.js`.
- Each existing guard has a `package.json` script and a step in `.github/workflows/test.yml`; a new guard should do the same. `check-client-redirects.test.ts` is the example of testing one.
- One-off scripts that touch real data should default to a dry run and require an explicit flag (such as `--apply`) to write. Follow `migrate-microsoft-provider-account-ids.ts` and `purge-orphaned-tinybird-data.ts`. Put the run command in a header comment.
- Many scripts need environment variables loaded; prefer the existing `dotenv run -f .env.local` pattern from `package.json` (see `telegram:setup`) over reading secrets from the shell history. Never print tokens or keys in script output.
- Run scripts with `pnpm --filter inbox-zero-ai exec tsx scripts/<file>.ts` from the repo root, or the named `package.json` script when one exists. Eval scripts need `--tsconfig tsconfig.eval-script.json` (the `eval:*` scripts already set it).
- The scripts here are run by hand or in CI. Do not run the emulator stack, build, or dev server unless the task asks for it (root `AGENTS.md`).
- The Docker prerender-placeholder logic lives in `docker/scripts/replace-in-prerender.mjs` at the repo root; only its test (`docker-replace-in-prerender.test.ts`) lives here.

### Testing Requirements

- Colocated tests: `check-client-redirects.test.ts`, `docker-replace-in-prerender.test.ts`, `emulate-seed.test.ts`, `generate-playwright-report-dashboard.test.ts`, `playwright-pr-comment.test.ts`, `playwright-report-dashboard.test.ts`, `playwright-screenshot-diff.test.ts`, `png-validation.test.ts`, `local-dev/*.test.ts`, `eval-report/*.test.ts`, `emulator/*.test.mjs`.
- Run from repo root: `pnpm test apps/web/scripts`
- The guards themselves run with `pnpm --filter inbox-zero-ai check-enums` (and the other `check-*` scripts) to match CI.

### Common Patterns

- Scripts open with a comment saying what they do and the exact command to run them.
- `.mjs` and `.js` files (`emulator/`, `build-mcp-app.mjs`, `check-*.js`) run directly under `node`; `.ts` files run through `tsx`.

## Dependencies

### Internal

- `@/env`, `@/utils/*` (encryption, Stripe via `@/ee/billing/stripe`, Redis, LLM config), `__tests__/fixtures/inboxes/`, `utils/playwright/` (suite selection used by the Playwright tooling), `docker/scripts/` at the repo root.

### External

- `tsx`, `dotenv`, `typescript` (compiler API in `check-client-redirects.js`), `@prisma/adapter-pg`, Stripe and Lemon Squeezy SDKs, the `emulate` CLI, Docker for the emulator stack.

## Manual Notes

Notes under this heading are written by humans and preserved on regeneration.
