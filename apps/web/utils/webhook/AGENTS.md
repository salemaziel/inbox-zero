# utils/webhook

**Parent context:** `../AGENTS.md`
**Generated:** 2026-10-23 · **Updated:** 2026-10-23

## Purpose

Processing of mailbox change notifications from Google (Pub/Sub push, then the Gmail history API) and Microsoft (Graph change notifications). The route handlers in `app/api/google/webhook/route.ts` and `app/api/outlook/webhook/route.ts` authenticate the request and hand off to this folder, which resolves the email account, checks it is still entitled to be processed, finds the new messages, and runs the shared per-message pipeline (rules, categorization, reply tracking, filing). This is distinct from `../webhooks/` (plural), which only verifies standard-webhook signatures for third-party callbacks such as Recall and Loops.

## Key Files

| File | Description |
|------|-------------|
| `process-history.ts` | `processProviderHistory`: dispatches by provider string to the Google or Outlook processor; used by admin tooling to replay history and to reconcile recent Outlook messages |
| `process-history-item.ts` | `processHistoryItem`: provider-neutral per-message pipeline (skips ignored senders, de-dupes on `ExecutedRule`, runs rules, sender categorization, filing replies, outbound handling, draft cleanup) |
| `validate-webhook-account.ts` | `getWebhookEmailAccount` (lookup by email or Outlook subscription id, including historical subscription ids) and `validateWebhookAccount` (skips disconnected or non-premium accounts and un-watches them) |
| `error-handler.ts` | `handleWebhookError`: same classification as `withError` for async work (invalid grant, API errors, rate limits) |
| `google/process-history.ts` | Reads Gmail history from the stored history id, de-duplicates items, dispatches to the item handlers, records rate-limit catch-up |
| `google/process-history-item.ts`, `google/process-label-added-event.ts`, `google/process-label-removed-event.ts` | Handles messages added and label add/remove events (learning from user label changes) |
| `google/fetch-sender-from-message.ts`, `google/types.ts` | Helpers and `HistoryEventType` / `ProcessHistoryOptions` types |
| `outlook/process-history.ts` | Handles a Graph notification (`resourceData`), takes the per-message lock, fetches the message and runs `processHistoryItem` inside `after()` |
| `outlook/learn-label-removal.ts`, `outlook/types.ts` | Learns from removed categories; notification payload types and validation |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `google/` | Gmail history based processing |
| `outlook/` | Microsoft Graph notification processing |

## For AI Agents

### Working In This Directory

- Webhook endpoints must answer fast and never leak internal errors to Google or Microsoft (retries amplify failures). Heavy work runs after the response (`after()` plus `runWithBackgroundLoggerFlush`), and failures go through `handleWebhookError`.
- Verification lives in the route files, not here: Google uses `GOOGLE_PUBSUB_VERIFICATION_TOKEN` as a query token (empty string disables it for gateway-authenticated deployments); Outlook answers the `validationToken` handshake and checks `clientState`. Keep verification in the route when changing endpoints.
- Webhooks are at-least-once. Dedupe with `withMessageProcessingLock` (`../redis/message-processing.ts`) and the `ExecutedRule` check in `process-history-item.ts`; a new side effect in the pipeline must be idempotent.
- `validateWebhookAccount` creates the email provider with `createEmailProvider`. It deliberately skips and un-watches accounts that lack premium or AI access, so a new entitlement check belongs there, not in the per-provider processors.
- Provider rate limits: the route handlers check `getEmailProviderRateLimitState` and the processors record throttling via `withRateLimitRecording`; both then mark a catch-up in Redis (`gmail-history-catch-up`, `outlook-rate-limit-catch-up`) so history is replayed later. Do not drop notifications silently.
- Gmail notifications carry only a history id; Outlook ones carry a resource id. The shared pipeline takes a pre-fetched `ParsedMessage` or a message id, so provider-specific fetching stays in `google/` and `outlook/`.
- Invalid-grant errors must not clear tokens here; provider clients own credential cleanup (see comment in `error-handler.ts`).

### Testing Requirements

- Co-located `*.test.ts` in each folder (`process-history`, `process-history-item`, label events, `validate-webhook-account`, `types`).
- Run from repo root: `pnpm test apps/web/utils/webhook`
- Single file: `pnpm test apps/web/utils/webhook/google/process-history.test.ts`

### Common Patterns

- Provider-specific entry (`google/`, `outlook/`) -> shared `processHistoryItem` with a `SharedProcessHistoryOptions` bundle (provider, account, rules, `hasAutomationRules`, `hasAiAccess`, logger).
- Provider branching with `isGoogleProvider` / `isMicrosoftProvider` is acceptable here because this is the integration boundary.

## Dependencies

### Internal

- `../email/` (provider factory, rate limit, watch manager), `../gmail/` (history, client), `../outlook/` (backfill, labels), `../redis/`, `../ai/choose-rule/run-rules`, `../categorize/senders`, `../reply-tracker/`, `../drive/`, `../premium`, `../prisma`, `../logger-flush`.

### External

- `next/server` (`after`, `NextResponse`), `@sentry/nextjs`, `lodash`.

## Manual Notes

Notes under this heading are written by humans and preserved on regeneration.
