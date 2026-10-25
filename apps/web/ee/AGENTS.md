# ee

**Parent context:** `../AGENTS.md`
**Generated:** 2026-10-23 · **Updated:** 2026-10-23

## Purpose

Enterprise Edition code, covered by the Inbox Zero Commercial License in `ee/LICENSE.md` rather than the repo's main license. Today it contains only billing: Stripe, Lemon Squeezy, and Apple in-app purchases for the mobile app. Everything here is imported as `@/ee/billing/...`.

## Key Files

| File | Description |
| --- | --- |
| `LICENSE.md` | Commercial license text for this directory |
| `index.md` | Auto-generated index stub; not documentation |

## Subdirectories

| Directory | Description |
| --- | --- |
| `billing/stripe/` | `index.ts` (`getStripe`, `updateStripeSubscriptionItemQuantity`), `sync-stripe.ts` (`syncStripeDataToDb`, `connectPurchaserAsAdmin`), `payments.ts` (invoice payment sync), `refunds.ts`, `ai-overage.ts` (AI generation overage on upcoming invoices), `invoice-email.ts`, `loops-events.ts`, `posthog-events.ts` |
| `billing/lemon/` | `index.ts`: Lemon Squeezy subscription quantity, customer lookup, license key activation |
| `billing/apple/` | `index.ts`: App Store notification verification, subscription state, and DB sync; `root-certificates.ts` (Apple root certs for signature verification); `local-testing.ts` (non-production test signer) |

## For AI Agents

### Working In This Directory

- Code placed here falls under the commercial license, so only add to `ee/` when that is intended. Do not copy `ee/` code into other directories. Importing from `ee/` elsewhere in the app is normal (about 20 files do).
- Stripe subscription state is written to the `Premium` model by `syncStripeDataToDb`; callers (`app/api/stripe/webhook/controller.ts`, `app/api/stripe/success/route.ts`) go through it rather than updating rows themselves.
- Webhook entry points live outside this folder: `app/api/stripe/webhook/`, `app/api/lemon-squeezy/webhook/`, `app/api/apple/webhook/`, and `app/api/apple/subscription/sync/`. The Stripe route verifies the signature itself with `getStripe().webhooks.constructEvent`; for Apple, the verification helpers (`verifyAppleNotificationPayload`, `verifyAppleSignedTransaction`) are in `ee/billing/apple/index.ts`.
- `apple/local-testing.ts` contains a throwaway signing key for local testing. It is only used when `APPLE_IAP_LOCAL_TESTING` is on and the process is not production. It is not a real App Store key; do not replace it with one and do not add real credentials anywhere in the repo.
- Secrets come from `@/env` (for example `LEMON_SQUEEZY_API_KEY`). New billing env vars follow the repo's env rules in the root `AGENTS.md`.
- Billing functions take a `logger` where they do background work; pass the caller's logger instead of creating a new one.

### Testing Requirements

- Colocated tests: `billing/stripe/*.test.ts` (index, payments, refunds, ai-overage, invoice-email, loops-events, posthog-events, sync-stripe) and `billing/apple/index.test.ts`. Lemon has none.
- Route-level tests: `app/api/stripe/webhook/route.test.ts`, `app/api/apple/webhook/route.test.ts`.
- Run from repo root: `pnpm test apps/web/ee`
- Tests should not call real billing services.

### Common Patterns

- Provider-specific modules export plain async functions; there is no shared billing interface across Stripe, Lemon, and Apple.
- `sync-stripe.ts` derives the stored subscription status through its local `getEffectiveStripeSubscriptionStatus`, which it also re-exports.

## Dependencies

### Internal

- `@/env`, `@/utils/prisma`, `@/utils/logger`, `@/utils/premium`, `@/app/(app)/premium/config` (tier mapping), `@inboxzero/tinybird-ai-analytics` (AI generation counts for overage).
- Consumers: `app/api/stripe/*`, `app/api/apple/*`, `app/api/lemon-squeezy/*`, `utils/actions/admin.ts`, premium UI.

### External

- `stripe`, `@lemonsqueezy/lemonsqueezy.js`, `@apple/app-store-server-library` (App Store verification), `jose`.

## Manual Notes

Notes under this heading are written by humans and preserved on regeneration.
