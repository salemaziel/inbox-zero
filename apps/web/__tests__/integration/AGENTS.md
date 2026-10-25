# __tests__/integration

**Parent context:** `../AGENTS.md`
**Generated:** 2026-10-23 · **Updated:** 2026-10-23

## Purpose

Real code paths against fake services from `emulate` (Google, Microsoft, Okta, Slack) and the in-repo emulators in `../emulators/`. No credentials, no network, seconds to run. Same code under test as `../e2e/`, but CI-friendly. Prefer this tier for new provider-behavior tests.

## Key Files

| File | Description |
| --- | --- |
| `helpers.ts` | `createGmailTestHarness`, `createOutlookTestHarness`, `createSlackTestHarness` (emulator + OAuth client + real `GmailProvider`/`OutlookProvider` + thread-id map), `createSignedSlackRequest`, `getAvailablePort`. Call `harness.emulator.close()` in `afterAll` |
| `provider-operations.test.ts`, `thread-fetching.test.ts`, `labeling-archiving.test.ts`, `draft-creation.test.ts`, `draft-attachments.test.ts` | Provider-agnostic `EmailProvider` behavior run against both emulators |
| `outlook-*.test.ts`, `gmail-mailbox-history.test.ts`, `mailbox-change-push.test.ts` | Provider-specific sync, delta, categories, flags, attachments |
| `rule-execution.test.ts`, `run-rules-learned-exclusions.test.ts`, `security-pipeline.test.ts` | Rule engine and email-security pipeline end to end |
| `webhook-flow.test.ts`, `webhook-action.test.ts`, `worker-queue.test.ts` | Webhooks and queue dispatch |
| `slack-*.test.ts`, `recall-*.test.ts`, `todoist-integration-action.test.ts`, `custom-mcp-server.test.ts`, `public-booking-google.test.ts`, `google-calendar-events.test.ts` | Messaging, meeting bot, MCP, and calendar integrations |
| `sso-*.test.ts`, `scim-better-auth.test.ts`, `google-emulator-oauth.test.ts` | Auth, SSO, SCIM |

## Subdirectories

| Directory | Description |
| --- | --- |
| `mail-engine/` | Mail-engine sync tests: `archive-reconciliation`, `catch-up`, `http-archive`, `search-body` |

## For AI Agents

### Working In This Directory

- Gate every suite with `describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)`; `pnpm test-integration` sets the flag and restricts vitest to this directory (`--dir __tests__/integration`). Note `security-pipeline.test.ts` is the one file here without the flag.
- Use the harness helpers instead of hand-building emulators. Use `getAvailablePort()` rather than a fixed port so files can run in parallel.
- Mock Prisma when the code writes to the DB (`vi.mock("@/utils/prisma", ...)`); use `../db/` instead when the database behavior itself is the point.
- Test through the `EmailProvider` abstraction; only branch on provider type at true provider boundaries (root `AGENTS.md`).
- Typical timeout is `{ timeout: 30_000 }` on the `describe`.
- Move to `../e2e/` only for what the emulator cannot simulate (real delivery, browser OAuth).

### Testing Requirements

```bash
pnpm test-integration                                                    # from repo root
pnpm --filter inbox-zero-ai exec cross-env RUN_INTEGRATION_TESTS=true vitest --run __tests__/integration/thread-fetching.test.ts
```

Details: `.claude/skills/testing/integration.md`.

### Common Patterns

- `beforeAll` creates the harness, `afterAll` closes the emulator; seed messages with explicit ids, `internal_date`, and `label_ids`.
- Provider-agnostic files (`provider-operations.test.ts`) take a `getHarness: () => ProviderTestHarness` and run the same assertions for Gmail and Outlook.

## Dependencies

### Internal

- `../helpers.ts`, `../emulators/`, `@/utils/email/*`, `@/utils/outlook/client`, `@/utils/rule/*`.

### External

- `emulate`, `@googleapis/gmail`, `@microsoft/microsoft-graph-client`, `@slack/web-api`, `vitest`.

## Manual Notes

Notes under this heading are written by humans and preserved on regeneration.
