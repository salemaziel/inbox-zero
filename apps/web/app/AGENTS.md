# app

**Parent context:** `../AGENTS.md`
**Generated:** 2026-10-23 · **Updated:** 2026-10-23

## Purpose

The Next.js App Router tree. It holds every page, layout, route handler, and metadata route for the web app. Authenticated product screens live in `(app)`, public pages in `(landing)`, and HTTP endpoints in `api`. Business logic lives in `../utils`, not here; see root `AGENTS.md` for the repo rules.

## Key Files

| File | Description |
| --- | --- |
| `layout.tsx` | Root layout: fonts, JSON-LD (Organization, WebSite, SoftwareApplication), analytics, PostHog, cookie consent, `GlobalProviders`, robots rules via `isIndexingAllowed`. |
| `global-error.tsx`, `not-found.tsx` | Root error and 404 boundaries. |
| `manifest.ts`, `sw.ts`, `startup-image.ts`, `icon.png`, `opengraph-image.jpg` | PWA manifest, service worker source (built by serwist, see `../serwist.config.mjs`), iOS startup images, and icons. |
| `robots.ts`, `robots.test.ts` | robots.txt generation and its test. |
| `llms.txt`, `openapi.json` | Static files served at the site root. |
| `utm.tsx` | Client component that records UTM params on landing. |
| `index.md` | Generated folder index (links to `api/index.md`); do not hand-edit. |

## Subdirectories

| Directory | Description |
| --- | --- |
| `(app)/` | Authenticated product UI behind login (see `(app)/AGENTS.md`). |
| `api/` | Route handlers: user API, webhooks, cron, public API v1, mobile, MCP (see `api/AGENTS.md`). |
| `(landing)/` | Public pages: `home`, `pricing`, `login`, `logout`, `welcome`, `thank-you`, `app`, `app-review`, `connect-mailbox`, `oss-friends`, `mcp` (consent and login for the MCP OAuth flow), plus `components` (demo and test widgets). Its layout only adds conversion analytics scripts. |
| `(redirects)/` | Short legacy paths (`/mail`, `/assistant`, `/stats`, `/clean`, `/bulk-unsubscribe`, and others). Each `page.tsx` calls `redirectToEmailAccountPath(path, searchParams)` from `../utils/account.ts` to send the user to `/{emailAccountId}/{path}` using the last-used account cookie. |
| `(marketing)/` | Currently empty. Nothing to document. |
| `mcp/` | Single `route.ts`: the public MCP server endpoint (`POST`, `OPTIONS`, `GET`), delegating to `../utils/mcp/http`. `api/mcp-server/route.ts` has the same handlers; `api/mcp` is the OAuth flow for connecting external MCP servers. |
| `auth-callback/` | Handoff page that opens the Inbox Zero app via its custom URL scheme after sign-in (`AuthCallbackHandoff.tsx`, `utils/mobile-auth/app-callback-url`). |
| `book/[slug]/` | Public booking page (availability, time picker, `cancel`, `reschedule`, OG images). Backed by `api/public/booking-links` and `api/public/bookings`. |
| `organizations/invitations/[invitationId]/` | Accept-invitation page for organizations. |
| `t/[token]/` | Single `route.ts`: tracking-pixel GIF endpoint that records a sent-message open (`utils/email/sent-message-open`). Public, no login. |

## For AI Agents

### Working In This Directory

- Route groups in parentheses (`(app)`, `(landing)`, `(redirects)`) do not appear in URLs. `(app)` and `(landing)` have separate layouts; do not import landing layout pieces into `(app)`.
- Imports from other app routes use the full alias, for example `@/app/(app)/premium/config`. The root layout itself imports `tiers` from there, so moving that file breaks the root.
- The web `app/` tree must not grow business logic. Put reusable server logic in `../utils` and shared components in `../components` (root `AGENTS.md`).
- Adding a new `/{path}` that should also work without an account prefix needs a `(redirects)/{path}/page.tsx` that calls `redirectToEmailAccountPath`.
- `index.md` files in this tree are generated; leave them alone.
- Route files that call the model or long mailbox work export `maxDuration` (for example `export const maxDuration = 300`). Keep that when editing those pages.

### Testing Requirements

- Tests live next to source (`robots.test.ts`, `book/[slug]/*.test.ts`, etc.). Run from repo root: `pnpm test apps/web/app/robots.test.ts`.
- Browser flows are in `../__tests__/playwright`, not here. See `../__tests__/playwright/AGENTS.md`.

### Common Patterns

- Server components use `await auth()` and `redirect("/login")` for unauthenticated access; account ownership uses `checkUserOwnsEmailAccount` from `../utils/email-account.ts`.
- Metadata uses `getBrandTitle` and `BRAND_NAME` from `../utils/branding`.

## Dependencies

### Internal

- `../utils` (auth, middleware, actions, branding, account helpers), `../components`, `../providers`, `../hooks`, `../env.ts`, `../generated/prisma`.

### External

- `next`, `react`, `next-axiom`, `@vercel/analytics`, `@next/third-parties`, `@dub/analytics`, `schema-dts`, `serwist` (service worker).

## Manual Notes

Notes under this heading are written by humans and preserved on regeneration.
