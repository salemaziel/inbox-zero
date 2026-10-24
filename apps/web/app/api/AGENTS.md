# app/api

**Parent context:** `../AGENTS.md`
**Generated:** 2026-10-23 · **Updated:** 2026-10-23

## Purpose

All HTTP route handlers (`route.ts`, about 290 files). Four kinds of caller reach them: the signed-in web app (`user/`, `threads/`, `messages/`, `chat/` and similar), external providers and queues (webhooks and cron), API-key clients (`v1/`), and the mobile app (`mobile*/`, `mail/`). Mutations from the web UI are server actions, not routes (root `AGENTS.md`); routes here are mostly reads, streams, webhooks, and the stable HTTP contracts for mobile and the public API.

## Key Files

| File | Description |
| --- | --- |
| `index.md` | Generated index (only links `mobile-review`); do not hand-edit. |
| `../../utils/middleware.ts` | Not in this folder but required reading: `withError`, `withAuth`, `withAdmin`, `withEmailAccount`, `withEmailProvider`. |
| `../../utils/api-middleware.ts` | `withAccountApiKey(scope, requiredScopes, handler)` and `withStatsApiKey` for public API routes. |
| `../../utils/cron.ts` | `hasCronSecret`, `hasPostCronSecret`, `isAuthorizedCronOrInternalRequest` for cron and queue-forwarded routes. |

## Subdirectories

| Directory | Description |
| --- | --- |
| `user/` | Per-user and per-account data for the web app (see `user/AGENTS.md`). |
| `v1/` | Public REST API authenticated by API key. `rules`, `senders`, `stats`, `openapi`, `openapi.json`; `[...path]/route.ts` and `route.ts` return a consistent not-found for unknown paths; wrong methods use `createPublicApiMethodNotAllowedHandler`. |
| `google/`, `outlook/` | Provider linking, calendar, drive, and push webhooks (`google/webhook`, `outlook/webhook`). `watch/` and `outlook/watch` renew subscriptions. |
| `stripe/`, `lemon-squeezy/`, `apple/`, `resend/`, `loops/`, `recall/`, `slack/`, `telegram/`, `teams/` | Third-party webhooks and callbacks (each verifies its own signature or secret). |
| `cron/` | Scheduled jobs (`automation-jobs`, `draft-cleanup`, retention jobs, `scheduled-actions`). Protected by `CRON_SECRET`. |
| `scheduled-actions/`, `scheduled-emails/`, `follow-up-reminders/`, `reply-tracker/`, `automation-jobs/`, `snoozed-threads/` | Deferred work executors, reached by the queue or cron. |
| `ai/` | Model-backed helpers: `compose-autocomplete`, `summarise`, `translate`, `digest`, `models`, `analyze-sender-pattern`. |
| `chat/`, `chats/` | Assistant chat streaming, persistence (`chat-message-persistence.ts`), and email-action confirmation. |
| `threads/`, `messages/`, `mail-stream/`, `email-stream/`, `labels/`, `unsubscribe/` | Mailbox data and actions for the web client and mail engine. |
| `mobile/`, `mobile-auth/`, `mobile-review/`, `mail/` | Native app contracts: auth code exchange (`mobile-auth`), push tokens and mailbox sync (`mobile`), device and account registration (`mail/v1/accounts`, `mail/v1/devices`, `mail/settings`), App Store review access (`mobile-review/README.md`). |
| `mcp/` | OAuth and argument options for connecting external MCP servers (`[integration]/auth-url`, `callback`, `provider-callback`, `arg-options`) and the integration list. |
| `mcp-server/` | Hosted MCP server endpoint; same handlers as `../mcp/route.ts` (`@/utils/mcp/http`). |
| `auth/[...all]` | Better Auth catch-all. |
| `public/` | Unauthenticated booking endpoints (`booking-links`, `bookings`). |
| `admin/`, `organizations/`, `sso/` | Admin and organization endpoints. |
| `health/`, `deployment/`, `image-proxy/`, `email/render-html`, `digest-preview/`, `knowledge/`, `referrals/`, `voice/`, `clean/` | Single-purpose routes. |

## For AI Agents

### Working In This Directory

- Pick the wrapper by caller:
  - `withEmailAccount(scope, handler)`: the web app acting on one mailbox. Reads `X-Email-Account-ID` (`EMAIL_ACCOUNT_HEADER` in `@/utils/config`), checks the caller owns it or may view it, and exposes `request.auth.{userId, emailAccountId, email}`. Never read the account id from the body for authorization.
  - `withEmailProvider`: same, plus a ready `request.emailProvider`. Use it instead of building a provider by hand; keep logic provider-neutral (root `AGENTS.md`).
  - `withAuth`: user-level data with no mailbox (`request.auth.userId`).
  - `withAdmin`: admin only.
  - `withError`: no session. Use only for webhooks, cron, health, public pages, and routes that do their own verification. Every one of those must verify a secret, signature, or token explicitly before doing work.
  - `withAccountApiKey` / `withStatsApiKey`: public API with required API key scopes.
- The first argument is a scope string used in logs (for example `"user/rules"`); match the path.
- Webhooks: verify the provider's signature or token first (Google uses `GOOGLE_PUBSUB_VERIFICATION_TOKEN`, Stripe uses `Stripe-Signature`), return quickly, and push slow work to `after()` or the queue (`@/utils/queue/dispatch`). Set `export const maxDuration`.
- Top-level cron routes export both `GET` (`hasCronSecret`) and `POST` (`hasPostCronSecret`); queue-forwarded routes such as `cron/draft-cleanup/account` export only `POST` and use `isAuthorizedCronOrInternalRequest`. They fan work out through `enqueueBackgroundJob`.
- One resource per route file (root `AGENTS.md`). Export the response type from the route (`export type XResponse = Awaited<ReturnType<typeof getX>>`) so clients can import it.
- Public API changes (`v1/`) must stay consistent with `openapi` output (`@/utils/public-openapi`) and API key scopes in `@/utils/api-key-scopes`.
- Do not return provider tokens or raw secrets in responses; log with the request logger (`request.logger`), not a new one.

### Testing Requirements

- Route tests sit beside the route (`route.test.ts`; about 107 exist). From repo root: `pnpm test apps/web/app/api/threads/route.test.ts`, or a folder: `pnpm test apps/web/app/api/user`.
- Standard pattern: `vi.mock("@/utils/prisma")` and `vi.mock("@/utils/middleware", ...)` replacing `withEmailAccount` with a function that injects `request.auth` and a real `createScopedLogger("test")` (see `user/rules/route.test.ts`). Do not mock the logger.
- Integration tests for providers are in `../../__tests__/integration`; read `.claude/skills/testing/SKILL.md` before writing new tests.

### Common Patterns

- `async function getX({ emailAccountId })` does the query; `GET = withEmailAccount("scope", ...)` calls it and returns `NextResponse.json`.
- Errors: throw `SafeError` (`@/utils/error`) for user-visible failures; the wrapper turns it into a JSON `{ error, isKnownError }` response.
- Zod validation next to the route (`validation.ts`) and parse with `.parse`/`safeParse`; public API uses `readPublicApiJson`.

## Dependencies

### Internal

- `@/utils/middleware`, `@/utils/api-middleware`, `@/utils/cron`, `@/utils/internal-api`, `@/utils/queue`, `@/utils/email` (provider abstraction), `@/utils/prisma`, `@/utils/webhook`, `@/ee/billing`.

### External

- `next/server`, `zod`, `stripe`, `better-auth`, `@upstash/qstash`, `ai` (model streaming).

## Manual Notes

Notes under this heading are written by humans and preserved on regeneration.
