# utils/split-inbox

**Parent context:** `../AGENTS.md`
**Generated:** 2026-10-23 · **Updated:** 2026-10-23

## Purpose

Mail splits: the user-defined tabs at the top of the mail view (for example "Unread", "Newsletters", "From a domain"). A split is a named set of filters (`MailSplitFilterKind`: LABEL, CATEGORY, FROM, UNREAD, STARRED, OLDER_THAN) combined with "all" or "any". This folder owns the filter validation, the translation of a split into a provider-neutral `ThreadsQuery` and a local-engine predicate, the prepared library of presets, defaults derived from the user's rules, and the Prisma persistence (`MailSplit`, split filters) with a per-account lock.

## Key Files

| File | Description |
|------|-------------|
| `split-query.ts` | `MailSplit` type, `mailSplitToThreadsQuery`, `otherMailSplitQuery` (the catch-all "Other" tab, `OTHER_SPLIT_ID`), `OLDER_THAN_OPTIONS`, `getPortableLabelSplits` |
| `thread-matches-split.ts` | Client/in-memory check of whether a thread matches a split, and the "Other" filter |
| `split-counts.ts` | `splitCountTargets`: builds engine predicates so tab counts use the same logic as the list (via `../mail-engine/threads-query.ts`) |
| `split-filters.ts` | Zod schema for filters: UNREAD/STARRED take no value, the rest require one |
| `sender-filter.ts` | `senderFilterSchema` (email or `@domain.com`) and `matchesSenderFilter` |
| `split-constants.ts` | `MAX_MAIL_SPLITS` (14) and `MAX_SPLIT_LABELS` (5; each label is one provider query) |
| `splits.server.ts` | Create/update/delete/reorder splits in Prisma; returns `duplicate` / `limit` statuses |
| `split-lock.ts` | `lockMailSplits`: Postgres advisory transaction lock per email account |
| `settings.server.ts` | `getMailSettings`: layout, preview setting and ordered splits; applies `ensureAllMailSplit` |
| `initial-splits.ts` | Initial "All" and "Unread" splits and `ensureAllMailSplit` (older accounts may lack "All") |
| `default-splits.ts`, `default-splits.server.ts` | Default splits derived from enabled system rules (`DEFAULT_MAIL_SPLIT_SYSTEM_TYPES`) and the server function that applies them |
| `native-categories.ts` | Gmail categories (Personal, Social, Updates, Forums, Promotions) and Outlook Focused/Other sections as ready-made splits |
| `split-library.ts`, `library.server.ts` | Prepared preset catalogue written against label names so one catalogue works for every account; the server side resolves names to ids per account and can enable the matching rule |

## Subdirectories

None.

## For AI Agents

### Working In This Directory

- Files ending `.server.ts` use Prisma and must not be imported into client components. `split-query.ts`, `thread-matches-split.ts`, `split-counts.ts`, `split-filters.ts` and `sender-filter.ts` are shared with the browser.
- Any change to what a filter kind means must be made in both `split-query.ts` (server-side query) and `thread-matches-split.ts` plus `../mail-engine/threads-query.ts` (client/engine matching). If they diverge, the tab count and the tab list disagree.
- Splits are translated to `ThreadsQuery`, which `EmailProvider` search methods consume for both Gmail and Outlook (see `../email/AGENTS.md`). Provider differences (Gmail label/category ids vs Outlook categories and Focused/Other sections) are handled in `native-categories.ts` and `../outlook/inbox-sections.ts`, not in the filter model.
- Create and update in `splits.server.ts` run under `lockMailSplits` so the limit check (`MAX_MAIL_SPLITS`) cannot race. Keep new write paths that count or reorder splits inside that lock.
- Library presets and defaults reference label names, not ids; resolve ids per account in the `.server.ts` layer.
- The "All" split (no filters) must always exist; use `ensureAllMailSplit` when reading splits.
- Filter validation (`mailSplitFilterSchema`, `MailSplitFilterDraft`) is defined in `split-filters.ts` and also consumed by `../ai/split/prompt-to-split.ts`; action input schemas live in `../actions/mail-split.validation.ts`.

### Testing Requirements

- Co-located `*.test.ts` (query building, matching, counts, library, default splits including `.server` tests).
- Run from repo root: `pnpm test apps/web/utils/split-inbox`
- Single file: `pnpm test apps/web/utils/split-inbox/split-query.test.ts`
- Callers: the mail API routes under `app/api/mail/v1/accounts/[accountId]/splits/` have their own route tests.

### Common Patterns

- Pure query/matching functions take plain `MailSplit` objects and an injectable `now: Date` for date-relative filters, so tests are deterministic.
- Persistence functions return tagged results (`{ status: "created" | "duplicate" | "limit" }`) instead of throwing for expected cases; `SafeError` is used for user-visible failures.

## Dependencies

### Internal

- `../prisma`, `../rule/consts`, `../threads/validation` (`ThreadsQuery`), `../mail-engine/threads-query.ts`, `../outlook/inbox-sections`, `../gmail/label`, `../email/types` (`EmailProvider`), `../actions/mail-split.validation`, `../email.ts` (address canonicalisation), `@/generated/prisma/*`.
- Used by `app/api/threads`, `app/api/mail/v1/accounts/[accountId]/splits/*`, `app/api/mail/settings`, and the mail UI (`MailShell.tsx`, `NewSplitDialog.tsx`, `use-split-counts.ts`).

### External

- `zod`, `@inboxzero/mail-core/queries`.

## Manual Notes

Notes under this heading are written by humans and preserved on regeneration.
