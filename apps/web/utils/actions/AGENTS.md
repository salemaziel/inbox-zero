# utils/actions

**Parent context:** `../AGENTS.md`
**Generated:** 2026-10-23 · **Updated:** 2026-10-23

## Purpose

Server actions (`next-safe-action`) for all UI mutations, plus the Zod input schemas they share with client forms. Each feature has a pair: `<feature>.ts` (the `"use server"` actions) and `<feature>.validation.ts` (schemas and inferred types). The flow and form conventions are in root `AGENTS.md` and `.claude/skills/fullstack-workflow/SKILL.md`.

## Key Files

| File | Description |
| --- | --- |
| `safe-action.ts` | Defines the three clients: `actionClient`, `actionClientUser`, `adminActionClient`. Handles auth, ownership check, logging, audit context, Sentry, and error mapping. |
| `error-handling.ts` | Client-side helpers (`showSettingActionError`, `createSettingActionErrorHandler`) that toast action errors. Not a server action file. |
| `rule.ts`, `ai-rule.ts`, `organization-rule.ts` | Rule create, update, delete, enable, and AI-assisted rule actions. |
| `assistant-chat.ts` | Assistant chat actions; `assistant-chat-confirmation.ts` holds confirmation helpers. |
| `mail.ts`, `mail-bulk-action.ts`, `mail-split.ts` | In-app mail client mutations (largest file, over 500 lines). |
| `permissions.ts` | Gmail and Outlook permission checks via `EmailProvider` types. |
| `premium.ts`, `organization.ts`, `sso.ts`, `scim.ts` | Billing, organizations, SSO and SCIM admin. |
| `admin.ts` | Admin-only actions through `adminActionClient`. |
| `__tests__/` | Tests for organization, invitation, and copy-rules actions. |

Remaining files follow the pair pattern: `calendar`, `categorize`, `clean`, `cold-email`, `drive`, `group`, `knowledge`, `meeting-recorder`, `messaging-channels`, `onboarding`, `settings`, `snippet`, `unsubscriber`, `webhook`, and others.

## Subdirectories

| Directory | Purpose |
| --- | --- |
| `__tests__/` | Cross-feature action tests (organization, invitations, copy rules). |

## For AI Agents

### Working In This Directory

- Pick the client by scope:
  - `actionClient` binds the first argument to `emailAccountId`, checks the session, and verifies the account belongs to the user. `ctx` then has `emailAccountId`, `emailAccount`, `provider`, `userId`, `userEmail`, `logger`.
  - `actionClientUser` is session-only (no email account).
  - `adminActionClient` requires `isAdmin`.
- Every action needs `.metadata({ name: "..." })`; the name is the logger scope and the Sentry action name.
- Throw `SafeError` for expected failures; the message reaches the user. Any other error is captured to Sentry and replaced with a generic message.
- Filter queries by `emailAccountId` from `ctx`, never from `parsedInput`. See `snippet.ts` for the canonical `updateMany({ where: { emailAccountId, id } })` plus count check.
- Files containing actions start with `"use server"`; only async action exports are allowed there. Put constants and helpers in a separate file (`mail-bulk-action.constants.ts`, `automation-jobs.helpers.ts`).
- Keep schemas in `*.validation.ts` so client forms import them without pulling in server code. Infer types with `z.infer`.
- Unique-constraint errors: use `isDuplicateError` from `@/utils/prisma-helpers`.
- Provider-specific code goes through `EmailProvider`; `permissions.ts` is one of the few boundary exceptions.

### Testing Requirements

- Tests are co-located: `utils/actions/*.test.ts` and `utils/actions/__tests__/`.
- Run from repo root: `pnpm test apps/web/utils/actions` or `pnpm test apps/web/utils/actions/rule.test.ts`.
- `assistant-chat.server-action-boundary.test.ts` asserts that `assistant-chat.ts` exposes only the authenticated confirm actions and not the `...ForAccount` helpers; run it after changing exports there.
- Validation schemas have their own tests (for example `rule.validation.test.ts`, `booking.validation.test.ts`).

### Common Patterns

```ts
export const xAction = actionClient
  .metadata({ name: "x" })
  .inputSchema(xBody)
  .action(async ({ ctx: { emailAccountId, logger }, parsedInput }) => { ... });
```

- The client calls it as `useAction(xAction.bind(null, emailAccountId))` and shows errors with `getActionErrorMessage`.
- After a mutation the client calls SWR `mutate()`. Only `categorize.ts` calls `revalidatePath`.

## Dependencies

### Internal

- `@/utils/auth`, `@/utils/prisma`, `@/utils/error`, `@/utils/audit/context`, `@/utils/rule/*`, `@/utils/email/*`, `@/utils/ai/*`.

### External

- `next-safe-action`, `zod`, `@sentry/nextjs`, `next/server` (`after`).

## Manual Notes

Notes under this heading are written by humans and preserved on regeneration.
