# __tests__/playwright

**Parent context:** `../AGENTS.md`
**Generated:** 2026-10-23 · **Updated:** 2026-10-23

## Purpose

Browser tests. `emulated/` runs the real Next app against seeded local emulators (Gmail or Outlook via `emulate`, Stripe, LLM, Todoist MCP, Recall) with no third-party credentials. `mail-simulation/` is a separate opt-in load simulation. Real-provider scenarios do not belong here; they go in `../e2e/`.

## Key Files

| File | Description |
| --- | --- |
| `README.md` | Authoritative description of the emulated suite, CI batching, evidence capture, and the LLM/Stripe emulators |
| `run-emulated-suite.mjs` | Entry for `pnpm test:playwright:emulated`: expands area/spec arguments (or selects specs from `PLAYWRIGHT_CHANGED_FILES`), runs each spec with a fresh Next process, emulator, and authenticated mailbox, then merges reports. `--list-targets` / `--list-batches` print the selection |
| `email-server.mjs` | Local email server started by the Playwright `webServer` config |
| `todoist-preload.mjs`, `todoist-transport.ts` | Route the app's Todoist MCP traffic to the emulator |
| `selection-comparison.md` | Notes comparing browser-selection strategies |
| `emulated/playwright-test.ts` | Extended `test` fixture (use this, not `@playwright/test`): attaches `browser-evidence` JSON and fails passing tests on uncaught page errors unless `allowPageErrors` is set |
| `emulated/playwright-evidence.ts` | `capturePlaywrightCheckpoint` for reviewer-visible screenshots |
| `emulated/mail-provider.ts` | Picks Google or Microsoft emulator (`PLAYWRIGHT_MAIL_PROVIDER=microsoft` for Outlook) |
| `emulated/setup/auth.setup.ts` | Authenticates once; writes the storage state the `emulated` project reuses |
| `emulated/account-test-helpers.ts` | Shared account/mailbox setup helpers |

## Subdirectories

| Directory | Description |
| --- | --- |
| `emulated/<area>/` | Specs grouped by product area: `attachments`, `automation`, `billing`, `calendars`, `channels`, `chat`, `cleanup`, `integrations`, `mail` (largest), `meetings`, `onboarding`, `settings`, `setup`. Each has `*-test-helpers.ts` and `*.spec.ts` files |
| `emulated/mail/coverage.json` | Maps each spec filename to the app-relative component/hook entry points it exercises; drives affected-spec selection in PRs |
| `mail-simulation/` | Opt-in Chromium load simulation (1,000-thread seed, quota/latency proxy). Own `playwright.config.mjs`, run via `pnpm test:mail-loading`; not in CI |

## For AI Agents

### Working In This Directory

- Specs run serially (`workers: 1`) against one seeded provider and one authenticated account; the package command isolates state by running each spec in a fresh process. Do not rely on state from another spec.
- Keep setup files inside the boundary they support so real-provider tests cannot reuse emulated auth state.
- A test that passes without `capturePlaywrightCheckpoint` stores a final-state screenshot; with checkpoints it skips that, so end on a checkpoint worth showing. Capture distinct UI states only.
- Persist reusable browser QA as executable specs, not Markdown flow docs. Split at the dependency boundary: deterministic UI in emulated, provider delivery/webhooks/labels/drafts in `../e2e/flows/`.
- Renaming or hiding a UI affordance breaks specs that select it by visible name. Grep this directory for the name (never through `head`); screenshots will not reveal it.
- When adding a spec to `mail/`, add its entry points to `emulated/mail/coverage.json` or PR selection may skip it. Selection logic lives in `../../utils/playwright/emulated-suite-selection.mjs` and `emulated-suite-targets.mjs`.
- For browser-facing UI changes, inspect the generated screenshots before finishing.
- Env defaults in `../../playwright.config.mjs`: `DATABASE_URL` falls back to local Postgres on port 5433; `GOOGLE_BASE_URL` / `MICROSOFT_BASE_URL` override the emulator.

### Testing Requirements

```bash
pnpm -F inbox-zero-ai test:playwright:emulated mail
pnpm -F inbox-zero-ai test:playwright:emulated mail/layout.spec.ts
pnpm -F inbox-zero-ai test:playwright:emulated automation settings
pnpm -F inbox-zero-ai test:playwright:emulated:setup        # auth setup project only
pnpm -F inbox-zero-ai test:mail-loading                      # mail-simulation, needs disposable Postgres
node --test apps/web/__tests__/playwright/mail-simulation/quota-proxy.test.mjs
pnpm emulate:stripe   # or emulate:llm / emulate:google / emulate:microsoft / emulate:recall
```

Do not run `dev` or `build` unless asked (root `AGENTS.md`); Playwright starts its own server.

### Common Patterns

- Import `test`/`expect` from `emulated/playwright-test.ts`.
- Specs steer the LLM emulator with `POST /__emulator/replies` on `PLAYWRIGHT_LLM_BASE_URL` and read prompts from `GET /__emulator/requests`.
- Stripe-side events are driven through the Stripe emulator's control endpoints.

## Dependencies

### Internal

- `../emulators/` (llm, stripe, recall, todoist-mcp), `../../playwright.config.mjs`, `../../utils/playwright/`, `../../scripts/*-emulator*.ts`.

### External

- `@playwright/test`, `emulate`.

## Manual Notes

Notes under this heading are written by humans and preserved on regeneration.
