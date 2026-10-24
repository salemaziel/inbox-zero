# __tests__/e2e

**Parent context:** `../AGENTS.md`
**Generated:** 2026-10-23 · **Updated:** 2026-10-23

## Purpose

Tests against real Gmail and Outlook accounts and APIs. Slow, need credentials, and mutate a real mailbox, so they are skipped by default. Use only for behavior the emulator cannot reproduce; otherwise write an integration test (`../integration/AGENTS.md`).

## Key Files

| File | Description |
| --- | --- |
| `README.md` | Env vars (`TEST_OUTLOOK_EMAIL`, `TEST_OUTLOOK_MESSAGE_ID`, `TEST_CONVERSATION_ID`, `TEST_GMAIL_EMAIL`, `TEST_GMAIL_MESSAGE_ID`, `TEST_GMAIL_THREAD_ID`) and how to find ids |
| `helpers.ts` | Shared helpers such as `findOldMessage(provider, daysOld)` |
| `gmail-operations.test.ts`, `outlook-operations.test.ts` | Webhook payloads, history, threads, search, senders |
| `outlook-draft-read-status.test.ts`, `outlook-query-parsing.test.ts`, `outlook-search.test.ts` | Outlook-specific behavior |

## Subdirectories

| Directory | Description |
| --- | --- |
| `labeling/` | Gmail label and Outlook category CRUD, apply/remove, thread-level removal (`helpers.ts` inside) |
| `calendar/`, `cold-email/`, `drafting/` | Per-provider calendar, cold-email, and Outlook drafting tests |
| `flows/` | Multi-step production-path scenarios with two real accounts, webhooks via a tunnel, and real AI: `full-reply-cycle`, `auto-labeling`, `outbound-tracking`, `draft-cleanup`, `message-preservation`, `sent-reply-preservation`, `follow-up-reminders`. Has its own `README.md`, `config.ts`, `setup.ts`, `teardown.ts`, and `helpers/` (`accounts`, `email`, `polling`, `webhook`, `logging`). No emulator or DB shortcuts here |

## For AI Agents

### Working In This Directory

- Suites use `describe.skipIf(!RUN_E2E_TESTS)`; flows use `shouldRunFlowTests()` and `RUN_E2E_FLOW_TESTS`, which also makes `vitest.config.ts` load `.env.e2e` instead of `.env.test`.
- Clean-slate approach: create test data, act, verify, then clean up so tests are idempotent and leave the account as found. Prefer old inbox messages (see `findOldMessage`) so recent mail is not disturbed.
- Flow data is tagged with `E2E_RUN_ID` and `getNextMessageSequence()` for uniqueness across files; flows default to a cheap model (`E2E_AI_MODEL`).
- Flow timeouts live in `flows/config.ts` (`TIMEOUTS`: webhook processing, email delivery). Use the polling helpers rather than sleeps.
- CI runs flows only when the repository variable `E2E_FLOWS_ENABLED=true` and the secrets listed in `flows/README.md` are set.
- Never print or log tokens, refresh tokens, or secrets.

### Testing Requirements

```bash
pnpm --filter inbox-zero-ai test-e2e                         # RUN_E2E_TESTS=true
pnpm --filter inbox-zero-ai test-e2e microsoft-labeling
pnpm --filter inbox-zero-ai test-e2e microsoft-labeling -t "should apply and remove label"
pnpm --filter inbox-zero-ai test-e2e:flows                   # RUN_E2E_FLOW_TESTS=true, serial
pnpm --filter inbox-zero-ai test-e2e:flows full-reply-cycle
E2E_VERBOSE=true pnpm --filter inbox-zero-ai test-e2e:flows
```

Details: `.claude/skills/testing/e2e.md`.

### Common Patterns

- Get a provider through the real account loaders in `flows/helpers/accounts.ts` or the env-var ids above, then assert through the `EmailProvider` interface.
- `flows/setup.ts` mocks `@/utils/redis/message-processing` so the processing lock always succeeds; everything else is real.

## Dependencies

### Internal

- `@/utils/email/*`, `@/utils/prisma` (real test database), `../helpers.ts`.

### External

- Real Google and Microsoft APIs, an ngrok-style tunnel for webhooks, a real LLM key.

## Manual Notes

Notes under this heading are written by humans and preserved on regeneration.
