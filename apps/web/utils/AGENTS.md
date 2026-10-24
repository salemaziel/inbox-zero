# utils

**Parent context:** `../AGENTS.md`
**Generated:** 2026-10-23 · **Updated:** 2026-10-23

## Purpose

Server and shared domain logic for the web app: auth, logging, errors, Prisma helpers, email-provider abstraction, AI features, rule engine, billing, queues, and integrations. Route handlers (`app/api`) and server actions (`utils/actions`) stay thin and call into this folder. Repo-wide coding rules live in the root `AGENTS.md` and are not repeated here.

## Key Files

| File | Description |
| --- | --- |
| `auth.ts` | Better Auth config (`betterAuthConfig`), sign-up and account-link hooks, and the `auth()` session getter. Sits beside the `auth/` folder, which holds its helpers. |
| `prisma.ts`, `prisma-extensions.ts`, `prisma-helpers.ts`, `prisma-retry.ts` | Prisma client plus extensions (audit, retry) and error helpers like `isDuplicateError`. |
| `middleware.ts` | Route wrappers `withError`, `withAuth`, `withAdmin`, `withEmailAccount`, `withEmailProvider`. |
| `api-middleware.ts`, `api-auth.ts`, `api-key.ts`, `api-key-scopes.ts` | API-key auth for the public API (`withAccountApiKey`, `validateApiKey`). |
| `error.ts`, `error.server.ts`, `error-messages/` | `SafeError`, `captureException`, LLM and provider error classifiers, user-visible error persistence. |
| `logger.ts`, `logger-client.ts`, `logger-flush.ts` | `createScopedLogger` and flush helpers; use `logger.trace()` for PII. |
| `email-account.ts`, `email-account-client.ts`, `account.ts` | Resolve an email account and build the provider client for it. |
| `encryption.ts`, `hash.ts`, `crypto-compare.ts` | Token encryption, hashing, constant-time compare. |
| `rate-limit.ts`, `qstash.ts`, `cron.ts`, `internal-api.ts` | Rate limiting, QStash publishing, cron secret checks (`hasCronSecret`), internal API caller headers. |
| `redact-fields.ts`, `sentry-scrub.ts` | Log and Sentry redaction. |
| `public-openapi.ts`, `public-api-error.ts` | Public API OpenAPI document and error shape. |
| `*.test.ts` | Unit tests live beside each file. |

## Subdirectories

Only some folders have their own guide. Others are small enough to read directly.

| Directory | Purpose |
| --- | --- |
| `__mocks__/` | Vitest manual mocks for `prisma` and `email-provider`. |
| `actions/` | Server actions and Zod validation files (see `actions/AGENTS.md`). |
| `agent-markdown/` | Accept-header parsing and markdown content negotiation. |
| `ai/` | LLM-backed features: rule choice, drafting, assistant chat, reports (see `ai/AGENTS.md`). |
| `analytics/` | Auth-funnel and client conversion tracking. |
| `attachments/` | Attachment download queue and draft attachment handling. |
| `audit/` | Audit-log context, delivery, and Prisma extension. |
| `auth/` | Better Auth helpers: SSO, SCIM, email OTP, token saving (see `auth/AGENTS.md`). |
| `automation-jobs/` | Scheduled automation job cron, defaults, destinations. |
| `booking/` | Public booking pages: policy, rate limit, emails. |
| `bulk-archive/` | Archive candidate selection. |
| `calendar/` | Calendar providers, OAuth, availability. |
| `categorize/` | Sender categorization pipeline (`senders/`). |
| `chat/` | Assistant chat active-run tracking and soft delete. |
| `cold-email/` | Cold-email blocker rule and sender exclusions. |
| `constants/` | Shared constants (user roles). |
| `decision-model/` | Optional structured decision model with LLM fallback (see `decision-model/AGENTS.md`). |
| `desktop/` | Desktop app version and GitHub release lookup. |
| `digest/` | Digest scheduling, formatting, delivery state. |
| `dlp/` | Sensitive-content policy. |
| `docs-sources/` | Fetching and indexing docs pages for the assistant. |
| `drive/` | Google Drive and OneDrive providers and document filing. |
| `email/` | `EmailProvider` abstraction and shared email helpers (see `email/AGENTS.md`). |
| `error-messages/` | Persisted user-facing error messages. |
| `filebot/` | Detects filing-assistant emails. |
| `follow-up/` | Follow-up reminders and drafts. |
| `gmail/` | Gmail API client code (see `gmail/AGENTS.md`). |
| `group/` | Group (learned pattern) matching. |
| `label/` | Label apply, compare, lookup helpers. |
| `llms/` | Model selection, retries, caching, usage (see `llms/AGENTS.md`). |
| `mail-api/` | Request authorization and operations for the mail HTTP API. |
| `mail-engine/` | Browser-side mail engine host and client (see `mail-engine/AGENTS.md`). |
| `mcp/` | MCP server, client integrations, tool specs (see `mcp/AGENTS.md`). |
| `meeting-briefs/` | Pre-meeting brief gathering. |
| `meeting-recorder/` | Meeting bot providers and transcripts (see `meeting-recorder/AGENTS.md`). |
| `messaging/` | Slack and Teams chat integrations (see `messaging/AGENTS.md`). |
| `mobile-auth/` | Mobile app OAuth handoff, PKCE, session cookie. |
| `oauth/` | OAuth state, callback validation, account linking (see `oauth/AGENTS.md`). |
| `offline/` | Offline mail cache. |
| `organizations/` | Organization access, roles, ownership. |
| `outbound-webhook/` | Rule action that calls a user webhook, with URL validation. |
| `outlook/` | Microsoft Graph client code (see `outlook/AGENTS.md`). |
| `parse/` | HTML, reply-extraction, unsubscribe, calendar-event parsing. |
| `playwright/` | Helpers for the emulated Playwright suite runner. |
| `premium/` | Plans, billing access, seats, credits. |
| `privacy/` | Reasoning retention policy. |
| `queue/` | AI queue and job dispatch backends (BullMQ, internal, QStash). |
| `recall/` | Recall.ai client and transcript handling. |
| `redis/` | Redis-backed caches, locks, progress state (see `redis/AGENTS.md`). |
| `referral/` | Referral codes and links. |
| `reply-tracker/` | Conversation status, draft tracking (see `reply-tracker/AGENTS.md`). |
| `retry/` | Retry-after parsing and provider retry. |
| `rule/` | Rule CRUD and matching helpers (see `rule/AGENTS.md`). |
| `scheduled-actions/` | Delayed rule actions scheduler and executor. |
| `scheduled-email/` | Scheduled send service. |
| `senders/` | Bulk sender actions and unsubscribe flows. |
| `snippets/` | Snippet shortcut expansion. |
| `snooze/` | Snooze scheduler and due processing. |
| `split-inbox/` | Inbox split tabs (see `split-inbox/AGENTS.md`). |
| `sso/` | SSO provider XML metadata parsing. |
| `stats/` | Response-time stats. |
| `team-comments/` | Team comments on threads. |
| `threads/` | Combined thread list loading and paging. |
| `types/` | Shared mail types. |
| `upstash/` | Upstash helpers for sender categorization. |
| `user/` | User delete, merge, and fetch. |
| `voice/` | Voice input catalog and errors (see `voice/AGENTS.md`). |
| `webhook/` | Gmail and Outlook push webhook processing (see `webhook/AGENTS.md`). |
| `webhooks/` | Standard-webhook signature verification. |

## For AI Agents

### Working In This Directory

- `utils/auth.ts` and `utils/auth/` both exist. `@/utils/auth` resolves to the file; helpers import as `@/utils/auth/<name>`.
- Prefer `EmailProvider` (`utils/email/`) over calling `gmail/` or `outlook/` directly; provider checks belong only at the integration boundary.
- Expected user-facing failures throw `SafeError`; anything else is reported to Sentry and shown as a generic message.
- Log fields come from the call chain; do not re-add them. PII goes through `logger.trace()`.
- Access control: a Prisma query that takes a client-supplied id must also filter by `emailAccountId` or `userId`.
- `index.md` here and in `oauth/` are doc-site indexes, not folder guides.

### Testing Requirements

- Unit tests sit next to source as `*.test.ts`. From the repo root: `pnpm test apps/web/utils/<dir>` or a single file path.
- Shared Prisma mock: `vi.mock("@/utils/prisma")` uses `utils/__mocks__/prisma.ts`.
- AI evals are in `apps/web/__tests__/eval/` and run with `pnpm --filter inbox-zero-ai test-ai`, not `pnpm test`.
- Review `.claude/skills/testing/SKILL.md` before writing tests.

### Common Patterns

- Function-per-file modules with a single options object argument that includes `logger`.
- `*.server.ts` marks server-only code; `*.validation.ts` holds Zod schemas.
- Redis keys, locks, and caches live in `redis/`, not inline in feature code.

## Dependencies

### Internal

- `@/generated/prisma`, `@/env`, workspace packages under `packages/` (for example `@inboxzero/mail-core`, `@inboxzero/network`).

### External

- Better Auth, Prisma, `ai` (Vercel AI SDK), `next-safe-action`, Zod, Sentry, Upstash Redis/QStash, BullMQ.

## Manual Notes

Notes under this heading are written by humans and preserved on regeneration.
