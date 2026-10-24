# utils/email

**Parent context:** `../AGENTS.md`
**Generated:** 2026-10-23 · **Updated:** 2026-10-23

## Purpose

The provider-neutral email layer. `types.ts` defines the `EmailProvider` interface; `google.ts` (`GmailProvider`) and `microsoft.ts` (`OutlookProvider`) implement it by delegating to the raw API helpers in `../gmail/` and `../outlook/`. Application code (rules, AI, actions, API routes, webhooks) should talk to `EmailProvider`, never to the Gmail/Graph clients. The folder also holds provider-agnostic mail behaviour: send/draft composition, threading, signatures, rate limiting, provider health, watch management, and server-side sync for the local mail engine.

## Key Files

| File | Description |
|------|-------------|
| `types.ts` | The `EmailProvider` interface (about 100 methods) plus shared shapes: `EmailThread`, `EmailLabel`, `EmailFilter`, `DraftAttachment`, `ProviderMailboxSearch` |
| `provider.ts` | `createEmailProvider({ emailAccountId, provider, logger })`: the factory. Checks rate-limit state, builds the Gmail/Outlook client with token refresh, and wraps the result in a Proxy that records provider failures |
| `provider-types.ts` | `isGoogleProvider` / `isMicrosoftProvider` type guards for the stored provider string (`"google"` / `"microsoft"`) |
| `google.ts` | `GmailProvider implements EmailProvider` (about 2300 lines) |
| `microsoft.ts` | `OutlookProvider implements EmailProvider` (about 3400 lines) |
| `rate-limit.ts`, `rate-limit-mode-error.ts`, `is-provider-rate-limit-error.ts` | Per-account provider rate-limit state (stored in Redis via `../redis/email-provider-rate-limit.ts`), `ProviderRateLimitModeError`, and detection of Gmail/Graph throttling errors |
| `provider-health.ts` | `classifyEmailAccountProviderIssue` / `recordEmailAccountProviderIssue`: marks accounts with auth or provider problems |
| `watch-manager.ts` | Starts/renews/stops Gmail push watches and Outlook subscriptions per account |
| `durable-email-send.ts` (+ `.validation.ts`, `send-operation-policy.ts`, `email-send-operation.ts`) | Idempotent send keyed by `mutationId`, stored as `EmailSendOperation` rows with a processing lease |
| `compose-draft.ts`, `read-compose-draft.ts`, `draft-attachment-upload.ts` | Composer draft create/read and large-attachment upload handoff |
| `reply-all.ts`, `reply-body.ts`, `reply-quote.ts`, `parse-message-reply.ts`, `forward-message.ts`, `threading.ts` | Reply/forward construction and thread/header handling |
| `signature-*.ts`, `compose-signature.ts`, `send-as.ts`, `sent-with-footer.ts` | Signatures, send-as aliases, outgoing footer |
| `local-mail-sync.ts`, `local-mail-sync-types.ts`, `local-mail-sync-budget.ts`, `mailbox-sync.ts` | Server side of the browser/desktop mail engine sync: message compaction, opaque cursors, per-provider request budgets (see `../mail-engine/AGENTS.md`) |
| `image-proxy*.ts`, `inline-image-cache.ts`, `outgoing-inline-images.ts`, `rewrite-html.ts`, `render-safe-links.ts`, `prepare-html.client.ts` | HTML sanitising, remote image proxying, inline image handling |
| `sent-message-open/` | Open tracking for sent messages (`.server.ts` files are server-only) |
| `connected-accounts.ts`, `contact.ts`, `whitelist.ts`, `bulk-action-tracking.ts`, `notify-lapsed-watches.ts` | Account/contact helpers and tracking |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `sent-message-open/` | Sent-message open tracking (client and server halves) |

## For AI Agents

### Working In This Directory

- The abstraction is: `utils/email/types.ts` (contract) -> `google.ts` / `microsoft.ts` (implementations) -> `utils/gmail/*` / `utils/outlook/*` (raw API calls, retries, parsing). Add a capability by extending `EmailProvider`, implementing it in both classes, and putting the API-specific code in the provider folder.
- Always obtain a provider through `createEmailProvider`. It enforces the rate-limit gate and installs the failure-logging Proxy; constructing `new GmailProvider(...)` directly bypasses both (in app code only `../webhook/validate-webhook-account.ts` does this, on purpose; integration test helpers do too).
- Gmail and Outlook model mail differently: Gmail has labels and thread ids; Outlook has folders, categories and conversation ids. The interface hides this with label/folder methods (`getLabels`, `getFolders`, `moveThreadToFolder`, `getOrCreateFolderIdByName`), and for Outlook `ParsedMessage.labelIds` is derived from the message's folder and categories (`getOutlookLabels` in `../outlook/message.ts`). Check both implementations when changing semantics.
- Provider-type branching (`isGoogleProvider`, `isMicrosoftProvider`) belongs only at integration boundaries, per the root `AGENTS.md`. Prefer a new interface method over `if (isGoogleProvider(...))` in callers.
- Send paths that must not double-send (scheduled send, retries) go through `executeDurableEmailSend`; do not call `sendEmail` directly from a retried job.
- Files ending `.server.ts` or importing `server-only` must not be imported from client components. `*.client.ts` files are browser-safe.
- Token handling: `getAccessToken()` on the provider returns the cached token. The Proxy in `provider.ts` records the token that failed so credential cleanup never clears a newer token.

### Testing Requirements

- Unit tests are co-located (`*.test.ts`); `google.test.ts` and `microsoft.test.ts` cover the provider classes, `provider.test.ts` covers the factory.
- Run from repo root: `pnpm test apps/web/utils/email`
- Single file: `pnpm test apps/web/utils/email/threading.test.ts`
- Read `.claude/skills/testing/SKILL.md` before writing tests.

### Common Patterns

- Every method takes plain ids and returns provider-neutral shapes (`ParsedMessage`, `EmailThread`, `EmailLabel`).
- Rate-limit-aware calls are wrapped with `withRateLimitRecording` from `rate-limit.ts`.
- Cursors for local sync are opaque, versioned, zod-validated strings (`mailbox-sync.ts`).

## Dependencies

### Internal

- `../gmail/`, `../outlook/` (raw provider APIs), `../redis/` (rate-limit state), `../email-account-client.ts` (token-refreshing clients), `../prisma`, `../mail-engine/` (consumer of local sync), `../split-inbox/` (sender filters).

### External

- `@googleapis/gmail`, `@microsoft/microsoft-graph-client`, `nodemailer` (MIME), `html-to-text`, `@inboxzero/mail-core`.

## Manual Notes

Notes under this heading are written by humans and preserved on regeneration.
