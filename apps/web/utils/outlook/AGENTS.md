# utils/outlook

**Parent context:** `../AGENTS.md`
**Generated:** 2026-10-23 · **Updated:** 2026-10-23

## Purpose

Raw Microsoft Graph layer for Outlook / Microsoft 365 mail (and the Outlook calendar client): OAuth and token refresh, messages, folders, categories, drafts, filters (inbox rules), subscriptions (webhooks), batching and retries. It is the Microsoft half of the `EmailProvider` abstraction: `../email/microsoft.ts` (`OutlookProvider`) calls these helpers. The Gmail equivalent is `../gmail/`.

## Key Files

| File | Description |
|------|-------------|
| `client.ts`, `client-types.ts` | `OutlookClient` wrapper (Graph client plus access token, folder-id and category caches); `getOutlookClientWithRefresh`; forces `Prefer: IdType="ImmutableId"` |
| `oauth.ts`, `scopes.ts`, `admin-consent.ts` | Microsoft OAuth/token requests, scopes, tenant admin-consent handling |
| `message.ts` | Message queries and `convertMessage` into `ParsedMessage`; derives `labelIds` from folder and categories |
| `thread.ts`, `thread-helpers.ts`, `thread-search-query.ts` | Conversation-based threads (Graph has no native threads) |
| `folders.ts`, `inbox-sections.ts` | Folder tree, system folder names (INBOX, DRAFT, SENT, ARCHIVE, TRASH, SPAM), Focused/Other inbox sections |
| `label.ts`, `category-colors.ts`, `label-validation.ts` | Outlook categories used as labels; color presets |
| `mail.ts`, `reply.ts`, `draft.ts`, `draft-attachments.ts`, `attachment.ts`, `upload-session.ts` | Send, reply, drafts, attachments, large-upload sessions |
| `filter.ts` | Graph message rules as filters |
| `watch.ts`, `subscription-manager.ts`, `subscription-history.ts` | Graph change-notification subscriptions; `OutlookSubscriptionManager` keeps one active subscription per account and records history |
| `retry.ts`, `batch.ts`, `errors.ts`, `page-token.ts` | Graph retry policy (read vs write), `$batch`, error predicates, paging tokens |
| `search-escape.ts`, `odata-escape.ts`, `search-scope.ts`, `assistant-search.ts` | Escaping for `$filter`/`$search` and search scoping |
| `mailbox-sync.ts`, `local-mail-sync.ts`, `backfill-recent-messages.ts`, `rate-limit-catch-up.ts` | Local mail engine sync and catch-up after throttling |
| `calendar-client.ts` | Microsoft Graph calendar client used by `../calendar/providers/microsoft*.ts` |
| `spam.ts`, `trash.ts`, `contact.ts`, `constants.ts` | Junk/deleted moves, contact search |

## Subdirectories

None.

## For AI Agents

### Working In This Directory

- Application code should use `EmailProvider`, not these helpers. New capabilities go into `../email/types.ts` first, then `OutlookProvider` and `GmailProvider`.
- Wrap Graph calls with `withMicrosoftGraphRetry` (reads) or `withMicrosoftGraphWriteRetry` (writes) from `retry.ts`; do not retry non-idempotent writes with the read policy.
- Outlook has no labels or native threads. Labels are categories plus folders, threads are `conversationId`, and archive means moving to the Archive folder. Folder ids are cached on `OutlookClient`; resolve system folders through `folders.ts`.
- Always escape user text going into OData `$filter`, `$search` or category names with `odata-escape.ts` / `search-escape.ts`.
- Message ids are requested as immutable ids; do not drop the `Prefer` header when creating Graph clients elsewhere.
- Subscriptions expire (max lifetime about 3 days, renewal threshold 1 day in `subscription-manager.ts`). Renewal is driven from `../email/watch-manager.ts`.
- Personal vs work/school accounts and tenant admin consent have different failure modes; see `admin-consent.ts` and `errors.ts` before changing auth error handling.

### Testing Requirements

- Co-located `*.test.ts`; Graph is mocked.
- Run from repo root: `pnpm test apps/web/utils/outlook`
- Single file: `pnpm test apps/web/utils/outlook/retry.test.ts`

### Common Patterns

- Helpers take an `OutlookClient` (and `Logger`) and return Graph types; `OutlookProvider` converts to neutral shapes.
- `isAlreadyExistsError` and similar predicates in `errors.ts` make create-or-get idempotent.

## Dependencies

### Internal

- `../email/` (provider class, sync cursors and budget, rate limit), `../auth/`, `../retry/`, `../calendar/`, `../split-inbox/` (inbox sections), `../logger`, `../error`.

### External

- `@microsoft/microsoft-graph-client`, `@microsoft/microsoft-graph-types`.

## Manual Notes

Notes under this heading are written by humans and preserved on regeneration.
