# utils/redis

**Parent context:** `../AGENTS.md`
**Generated:** 2026-10-23 · **Updated:** 2026-10-23

## Purpose

All Redis access for the web app: the shared client, plus one small module per feature that stores short-lived state (locks and dedupe markers, caches, progress counters, rate-limit state, OAuth code claims, pub/sub). Keeping keys and TTLs here means feature code never builds Redis keys inline.

## Key Files

| File | Description |
|------|-------------|
| `index.ts` | Exports the shared `redis` client (Upstash REST client using `REDIS_HTTP_URL` / `REDIS_HTTP_TOKEN`) and `expire` |
| `subscriber.ts` | ioredis connection factory for pub/sub (needs `REDIS_URL`, a TCP URL); used by the SSE routes `app/api/mail-stream` and `app/api/email-stream` |
| `owned-lock.ts` | `acquireOwnedLock` / `markOwnedLockProcessed` / `clearOwnedLock`: token-owned locks with Lua scripts so only the holder can complete or release |
| `message-processing.ts`, `outbound-thread-status.ts` | Dedupe webhook message processing and outbound reply tracking, built on `owned-lock.ts` |
| `email-provider-rate-limit.ts` | Per-account Gmail/Graph rate-limit state read by `../email/rate-limit.ts` |
| `gmail-history-catch-up.ts`, `outlook-rate-limit-catch-up.ts` | Markers that tell the webhook path to catch up after throttling |
| `provider-issue-cleanup.ts` | Claim so only one worker cleans up a provider issue |
| `local-mail-hints.ts` | Pub/sub hint channel and interest keys for the local mail engine |
| `thread-page-buffer.ts` | Encrypted buffered pages for thread-list pagination (own Redis client, needs `EMAIL_ENCRYPT_SECRET` and `EMAIL_ENCRYPT_SALT`) |
| `account-validation.ts` | Cached check that a user owns an email account (1 hour) |
| `usage.ts` | AI usage and weekly cost tracking |
| `categorization-progress.ts`, `clean.ts`, `clean.types.ts` | Progress of bulk categorization and inbox-clean jobs |
| `reply.ts`, `summary.ts`, `research-cache.ts`, `docs-cache.ts`, `contact-photos.ts` | Caches (AI replies, summaries, research, docs, contact photos) |
| `oauth-code.ts` | Claim/lock/result of OAuth authorization codes to make callbacks idempotent |
| `messaging-link-code.ts` | One-time nonce store for chat-app link codes (see `../messaging/AGENTS.md`) |
| `public-contact-context-lock.ts` | Lock for public contact research |

## Subdirectories

None.

## For AI Agents

### Working In This Directory

- Import the client from `@/utils/redis`; do not construct `new Redis(...)` in feature code. The exceptions already here are `subscriber.ts` (needs TCP for subscribe) and `thread-page-buffer.ts`.
- The shared client is HTTP-based (Upstash style). It cannot subscribe; use `subscriber.ts` for pub/sub and publish with the normal client.
- Every key needs a TTL. Prefix keys by feature and include `emailAccountId` (or user id) so one tenant cannot read another's entries. Use the existing helper per feature rather than writing keys in callers.
- Use `owned-lock.ts` for any lock that must survive a crash safely: compare the token before releasing or marking processed. Do not use plain `SET`/`DEL` locks.
- Files starting with `import "server-only"` must never be reached from client components.
- Redis can be unconfigured in some deployments; modules like `email-provider-rate-limit.ts` expose an `is...Configured` check and callers degrade gracefully. Preserve that when adding features that are not essential.
- Do not store raw email content here without encryption; `thread-page-buffer.ts` is the pattern (`encryptToken`).

### Testing Requirements

- Co-located `*.test.ts` mock the Redis client.
- Run from repo root: `pnpm test apps/web/utils/redis`
- Single file: `pnpm test apps/web/utils/redis/message-processing.test.ts`

### Common Patterns

- One module per feature exporting `get*` / `save*` / `clear*` or `acquire*` / `release*` functions with key construction kept private (`getXKey`).
- Named TTL constants at the top of the file (`..._TTL_SECONDS`).

## Dependencies

### Internal

- `@/env`, `../logger`, `../encryption`, `../prisma` (account validation), `../email/rate-limit-mode-error`, `../threads/*`.

### External

- `@upstash/redis`, `ioredis`.

## Manual Notes

Notes under this heading are written by humans and preserved on regeneration.
