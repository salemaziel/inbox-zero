# __tests__/db

**Parent context:** `../AGENTS.md`
**Generated:** 2026-10-23 · **Updated:** 2026-10-23

## Purpose

Tests that run against a real Postgres instead of a mocked Prisma client. Use when the behavior under test is the database: unique constraints, conditional `updateMany` count guards, `onDelete` behavior, partial-index semantics, and data migrations. Anything else belongs in a mocked unit test or an emulator-backed integration test.

## Key Files

| File | Description |
| --- | --- |
| `README.md` | Setup and conventions; read before adding a test |
| `fake-bot-provider.ts` | In-memory `MeetingBotProvider` used to mock the outside world |
| `digest-claim.test.ts`, `pending-digest.test.ts`, `snoozed-thread-scheduler.test.ts`, `held-email-undo.test.ts` | Claim/lease and conditional-update guards |
| `rule-name-unique-error.test.ts`, `email-rename.test.ts`, `mailbox-merge.test.ts`, `shared-conversations.test.ts`, `stripe-trial-conversion.test.ts` | Constraint and cross-table behavior |
| `*-migration.test.ts` (`mail-split`, `split-filter`, `pending-digest`, `normalize-group-item-values`) | Data migration regressions |
| `cold-email-*.test.ts`, `custom-rule-label-removal.test.ts`, `default-mail-splits.test.ts`, `group-item-reconciliation.test.ts`, `meeting-recorder-reconcile.test.ts` | Domain queries that depend on real SQL |

## Subdirectories

None.

## For AI Agents

### Working In This Directory

- Suites use `describe.skipIf(!process.env.RUN_DB_TESTS)` Some older suites import `@/utils/prisma` inside `beforeAll` via `await import(...)`; most import statically at the top, which is fine because `skipIf` keeps the default run from touching the database. Follow the root `AGENTS.md` rule and use static imports in new tests.
- These tests delete rows in `beforeEach`. `DATABASE_URL` must point at a throwaway database, never one you care about.
- Seed what each test needs in `beforeEach` and delete it again; every test must be able to run alone.
- Mock the outside world (bot providers, calendar APIs, queues); leave the database real. Assert on rows read back from the database, not on mock calls, whenever the point is a persisted state transition.
- The group item normalization migration regression should also run on PostgreSQL 15, whose string escaping differs from newer versions.
- CI (`.github/workflows/test.yml`) starts Postgres, runs `prisma migrate deploy`, and runs only `__tests__/db/shared-conversations.test.ts`; other DB suites run locally only.

### Testing Requirements

```bash
# one-time, throwaway database
createdb inboxzero_test
DATABASE_URL="postgresql://postgres:password@localhost:5432/inboxzero_test?schema=public" \
DIRECT_URL="postgresql://postgres:password@localhost:5432/inboxzero_test?schema=public" \
  pnpm -F inbox-zero-ai exec prisma migrate deploy

DATABASE_URL="postgresql://postgres:password@localhost:5432/inboxzero_test?schema=public" \
  pnpm test-db                                   # RUN_DB_TESTS=true, --dir __tests__/db
```

### Common Patterns

- Seed rows in `beforeEach`, clean up after, and use fixed `now` dates for time-based claims (see `digest-claim.test.ts`).

## Dependencies

### Internal

- `@/utils/prisma`, `@/generated/prisma/enums`, `prisma/` migrations, the domain modules under test.

### External

- PostgreSQL, `vitest`.

## Manual Notes

Notes under this heading are written by humans and preserved on regeneration.
