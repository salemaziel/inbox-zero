# utils/gmail

**Parent context:** `../AGENTS.md`
**Generated:** 2026-10-23 · **Updated:** 2026-10-23

## Purpose

Raw Gmail API layer built on `@googleapis/gmail`: OAuth and token refresh, message/thread/label/draft/filter calls, MIME building and parsing, push-watch setup, history reads, retries and batching. It is the Google half of the `EmailProvider` abstraction: `../email/google.ts` (`GmailProvider`) calls these helpers, and the rest of the app is expected to go through `GmailProvider` (see `../email/AGENTS.md`). Outlook's equivalent is `../outlook/`.

## Key Files

| File | Description |
|------|-------------|
| `client.ts` | `getGmailClientWithRefresh`, token-expiry buffer, `getAccessTokenFromClient`; saves refreshed tokens and cleans up invalid ones |
| `oauth.ts`, `scopes.ts`, `permissions.ts` | Google OAuth client options, scope lists (mail and calendar), granted-scope checks |
| `message.ts`, `message-bodies.ts`, `decode.ts`, `snippet.ts` | Message fetch, `parseMessage` into `ParsedMessage`, body/attachment decoding |
| `thread.ts` | Thread fetch (`getCompleteGmailThread`) |
| `label.ts`, `label-colors.ts`, `label-validation.ts` | Labels, the `GmailLabel` constants (INBOX, CATEGORY_*, etc.), get-or-create of Inbox Zero labels |
| `mail.ts`, `reply.ts`, `forward.ts`, `draft.ts`, `draft-attachments.ts`, `resumable-draft-upload.ts` | Send, reply, forward, draft create/update, draft attachments and the resumable upload flow |
| `attachment.ts`, `attachment-stream.ts` | Attachment download and streaming |
| `filter.ts`, `settings.ts`, `signature-settings.ts` | Gmail filters, send-as and signature settings |
| `watch.ts`, `history.ts` | Pub/Sub `users.watch` / `stop` and `users.history.list` |
| `retry.ts`, `batch.ts`, `batch-with-retry.ts` | Error classification, backoff, batched `messages.get` |
| `mailbox-sync.ts`, `local-mail-sync.ts`, `sync-messages.ts` | Cursor-based backfill and change feed for the local mail engine |
| `spam.ts`, `trash.ts`, `contact.ts`, `constants.ts` | Spam/trash moves, People API contacts, label/message visibility constants |

## Subdirectories

None. Tests and the benchmark (`message-bodies.bench.ts`) sit beside the sources.

## For AI Agents

### Working In This Directory

- Callers outside `utils/email/` and a few auth/webhook paths should not import from here directly. Add the capability to `EmailProvider` in `../email/types.ts` and wire it through `GmailProvider` and `OutlookProvider`.
- Wrap Gmail API calls in `withGmailRetry` (`retry.ts`) so rate limits and transient errors back off consistently. Blocking retry delay is capped (`MAX_GMAIL_BLOCKING_RETRY_DELAY_MS`); long waits are handled by the rate-limit state in `../email/rate-limit.ts`.
- Token refresh happens in `client.ts`, which also deletes tokens on `invalid_grant`. Do not refresh or clear tokens elsewhere.
- Gmail labels are the unit for folders, categories and state (INBOX, UNREAD, STARRED, CATEGORY_PROMOTIONS...). Use `GmailLabel` constants rather than string literals.
- Local mail sync cursors are versioned zod objects (`provider: "google"`, phase `backfill` or `changes`) and each call spends from the budget in `../email/local-mail-sync-budget.ts`. Keep cursor shape changes backward-aware or bump `version`.
- `watch.ts` requires `GOOGLE_PUBSUB_VERIFICATION_TOKEN`; it resets the watch if Google reports an existing push client.

### Testing Requirements

- Co-located `*.test.ts` files; they mock the Gmail client rather than calling Google.
- Run from repo root: `pnpm test apps/web/utils/gmail`
- Single file: `pnpm test apps/web/utils/gmail/retry.test.ts`

### Common Patterns

- Functions take a `gmail_v1.Gmail` client (and often a `Logger`) as the first argument and return provider-shaped data; conversion to neutral types happens in `GmailProvider`.
- Batch reads chunk ids and use `batch.ts` instead of one request per message.

## Dependencies

### Internal

- `../email/` (provider class, rate limiting, sync budget and cursors), `../auth/` (`save-tokens`, `cleanup-invalid-tokens`), `../retry/`, `../types`, `../logger`, `../error`.

### External

- `@googleapis/gmail`, `@googleapis/people`, `nodemailer`/MIME helpers, `zod`.

## Manual Notes

Notes under this heading are written by humans and preserved on regeneration.
