# app/api/user

**Parent context:** `../AGENTS.md`
**Generated:** 2026-10-23 · **Updated:** 2026-10-23

## Purpose

The data API for the signed-in web app: about 95 `route.ts` files, one resource each, that the SWR hooks in `../../../hooks` read from. Most are `GET` routes that return JSON for one email account. Mutations normally live in server actions (`../../../utils/actions`); the write routes here are the exceptions: drafts and draft attachment uploads, `scheduled-emails`, `snoozed-threads`, `senders/{bulk,status,unsubscribe}`, `categorize/senders/batch`, `stats/load`, `account`, `complete-registration`.

## Key Files

| File | Description |
| --- | --- |
| `me/route.ts` | Current user: AI provider and model, premium and billing state, webhook secret, dismissed hints. Uses `withError` and `auth()` directly so it can return `null` when signed out. |
| `email-accounts/route.ts` | Lists the user's accounts and the last-used account (cookie). `GetEmailAccountsResponse` is consumed by `EmailAccountProvider`. `withAuth`. |
| `email-accounts/[emailAccountId]/route.ts` | Delete one account (`withAuth`). |
| `email-account/route.ts` | Full details for the account in the header (`EmailAccountFullResponse`, used by `useOrgAccess`). |
| `rules/route.ts`, `rules/[id]/route.ts` | Rules with actions, groups, and organization rules, ordered by `sortRulesByCanonicalOrder`. |
| `stats/helpers.ts` | Shared query helpers for the `stats/*` routes (`getEmailFieldStats`). |
| `settings/multi-account/` | Multi-account settings (`validation.ts` beside the route). |

## Subdirectories

Each directory is a resource with its own `route.ts` and usually a colocated `route.test.ts`. Groups:

| Group | Directories |
| --- | --- |
| Identity and account | `me`, `account`, `email-account`, `email-accounts`, `complete-registration`, `email-otp`, `onboarding`, `persona`, `setup-progress`, `settings`, `organization-membership`, `api-keys` |
| Rules and AI | `rules`, `group`, `executed-rules`, `categories`, `categorize`, `cold-email`, `draft-actions`, `draft-cleanup-settings`, `ai-automation-status`, `error-messages`, `debug` |
| Mail data | `drafts`, `scheduled-emails`, `snoozed-threads`, `thread-plans`, `labels`, `folders`, `senders`, `send-as`, `snippets`, `signature`, `mail-splits`, `sent-message-opens`, `contacts`, `public-contact-context` |
| Stats | `stats/` (`by-period`, `email-actions`, `load`, `newsletters`, `recipients`, `response-time`, `rule-stats`, `sender-emails`, `senders`) |
| Calendar and meetings | `calendar`, `calendars`, `availability`, `booking-links`, `meeting-briefs`, `meeting-recorder` |
| Integrations | `drive`, `messaging-channels`, `digest-schedule`, `digest-status`, `schedule`, `automation-jobs`, `trial-preview` |

## For AI Agents

### Working In This Directory

- Wrapper counts today: `withEmailAccount` (about 63), `withEmailProvider` (26), `withAuth` (9), `withError` (4). Default to `withEmailAccount`; use `withEmailProvider` when you need the Gmail or Outlook client; use `withAuth` only for data that is not tied to a mailbox. Details in `../AGENTS.md`.
- Always scope Prisma queries by `request.auth.emailAccountId` (or `userId` for `withAuth`). Never trust an id from the query or body for ownership; when a route takes an id (`[id]`, `[draftId]`, `[groupId]`), include `emailAccountId` in the `where`.
- Export `XResponse` types from the route so hooks and components can import them (`export type RulesResponse = Awaited<ReturnType<typeof getRules>>`). Renaming or reshaping one breaks every consumer; grep for the type name.
- Keep the query in a separate `getX` function above the handler and return `NextResponse.json(result)`. Helper functions go at the bottom of files (root `AGENTS.md`).
- Wrap handler bodies the way neighbors do (`try`/`catch` with `request.logger.error`) so unexpected failures return a JSON error rather than throwing.
- The client sends the account id in the `X-Email-Account-ID` header through `fetchWithAccount` and `useOrgSWR`. A new SWR hook against a `withEmailAccount` route must use one of those, otherwise the route returns 403.
- Do not add new mutation routes where a server action fits (root `AGENTS.md`, Fullstack Workflow).

### Testing Requirements

- Colocated `route.test.ts` for most routes. From repo root: `pnpm test apps/web/app/api/user` or one route, for example `pnpm test apps/web/app/api/user/rules/route.test.ts`.
- Mock `@/utils/prisma` (`@/utils/__mocks__/prisma`) and `@/utils/middleware` so `withEmailAccount` injects `request.auth` (see `rules/route.test.ts`); use the real logger.
- Assert behavior that matters: the `where` clause includes the account id, and other users' ids return nothing.

### Common Patterns

- `GET = withEmailAccount("user/<path>", async (request) => { ... })`, scope string equals the path.
- `SafeError` for expected failures; `NextResponse.json({ error }, { status })` where status matters.
- Shared selects and helpers from `@/utils/...` (for example `premiumEntitlementSelect`) instead of repeating field lists.

## Dependencies

### Internal

- `@/utils/middleware`, `@/utils/prisma`, `@/utils/rule`, `@/utils/premium`, `@/utils/email`, `@/utils/error`, `@/utils/auth`, `@/utils/stats`, `@/hooks/*` (consumers).

### External

- `next/server`, `zod`, Prisma client from `@/generated/prisma`.

## Manual Notes

Notes under this heading are written by humans and preserved on regeneration.
