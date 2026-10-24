# utils/analytics

**Parent context:** `../AGENTS.md`
**Generated:** 2026-10-23 · **Updated:** 2026-10-23

## Purpose

Product and conversion analytics: the PostHog event catalog and property rules for the app, the sign-in funnel, mail usage and speed telemetry, desktop-app health reports, and ad-conversion tracking (browser and server). Low-level PostHog and Facebook senders live elsewhere (`utils/posthog`, `utils/fb`); this directory decides what to send, when, and under what consent and dedup rules.

## Key Files

| File | Description |
| --- | --- |
| `product.ts` | Event names (`PRODUCT_ANALYTICS_EVENTS`, `MAIL_ANALYTICS_EVENTS`), action ids, `APP_PAGES`, page-view properties, URL param stripping. The header comment documents every event and property |
| `client.ts` | `getClientAnalyticsProperties`: web vs desktop client, desktop version, mail-engine transport (registered as PostHog super properties) |
| `auth-funnel.ts` | Client side of the login funnel: provider normalization, remembering the attempted provider, auth-started and auth-failure events |
| `auth-funnel.server.ts` | Server side: marks new-user auth contexts and resolves the provider from a better-auth endpoint context |
| `mail-usage.ts` | `trackMailAction` plus batched navigation-shortcut counts |
| `mail-performance.ts` | Sampled input-event, long-task, and thread-switch latency summaries |
| `summary-flush.ts` | `scheduleSummaryFlush` and `runWhenIdle`: shared timer and page-hidden flush for summary events |
| `desktop-health.ts` | Hourly health report from the Electron shell, when its bridge exists |
| `conversion-events.ts` | Shared conversion constants and types (`ConversionEvent`, URL params, browser event name) |
| `client-conversions.ts` | `trackClientConversion`: consent-gated browser conversions; holds events in memory until the cookie banner is answered |
| `server-conversions.ts` | `trackRegistrationCompletedConversion` with Redis-backed once-only dedup, sent to Facebook and PostHog |
| `server-conversion-events.ts` | `trackServerConversionEvent`: publishes conversions to a configured external endpoint through QStash; Stripe metadata helpers |

## Subdirectories

None.

## For AI Agents

### Working In This Directory

- Files are mixed client and server. `client-conversions.ts` is `"use client"`; `server-conversions.ts`, `server-conversion-events.ts`, and `auth-funnel.server.ts` import Redis, Prisma, or env and must never be imported from client components. The `.server.ts` suffix marks the split for auth-funnel; keep it.
- Privacy rule from `product.ts`: event properties are ids, counts, enums, and durations only. Never send subjects, senders, search text, or message content. Page URLs are passed through `stripUntrackedUrlParams` so thread selection and search text do not leak.
- New product events are added to the catalog in `product.ts` (and documented in its header comment), not as string literals at call sites.
- Browser conversions must respect cookie consent: `denied` drops the event, `pending` holds it. Use `trackClientConversion`, not a direct pixel call.
- Server conversions are deduplicated per user and provider with a 24-hour Redis key (`CONVERSION_DEDUPE_TTL_SECONDS`) and a deterministic event id, so retries and double webhooks do not double count. Keep the key reservation and the release-on-failure behavior when editing `server-conversions.ts`.
- `trackServerConversionEvent` does nothing unless `CONVERSION_ANALYTICS_SERVER_URL` is set; it logs failures instead of throwing unless `throwOnError` is passed.
- High-frequency signals (navigation shortcuts, performance samples) are aggregated and flushed through `summary-flush.ts` every 5 minutes and when the page is hidden; do not send them per event. Performance reporting is sampled (`MAIL_PERFORMANCE_SAMPLE_RATE`).

### Testing Requirements

- Every module except `conversion-events.ts` and `summary-flush.ts` has a colocated `*.test.ts`.
- Callers with tests: `app/api/stripe/webhook/route.test.ts`, `app/api/user/complete-registration/route.test.ts`.
- Run from repo root: `pnpm test apps/web/utils/analytics`

### Common Patterns

- Pure helpers (`summarizeDurations`, `buildMailPerformanceSummary`, `normalizeAuthProvider`) are separated from the browser-side effects so they can be unit tested without a DOM.
- Several modules keep module-level state (navigation counts, held conversions, the sampled flag, collected samples). Account for that in tests; see how the existing tests handle it.

## Dependencies

### Internal

- `@/utils/posthog`, `@/utils/fb`, `@/utils/cookie-consent`, `@/utils/desktop-app`, `@/utils/redis`, `@/utils/prisma`, `@/utils/mail-engine` (transport mode), `@/utils/upstash` (QStash publish), `@/env`.
- Consumers: `providers/PostHogProvider.tsx`, `lib/shortcuts/useShortcuts.ts`, `app/(landing)/login/`, `app/api/stripe/`, `app/api/user/complete-registration/`, `app/(app)/[emailAccountId]/mail/use-mail-performance-telemetry.ts`.

### External

- `posthog-js` (types and capture), `better-auth` (context type in `auth-funnel.server.ts`).

## Manual Notes

Notes under this heading are written by humans and preserved on regeneration.
