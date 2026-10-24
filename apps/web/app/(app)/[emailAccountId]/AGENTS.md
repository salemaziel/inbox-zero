# app/(app)/[emailAccountId]

**Parent context:** `../AGENTS.md`
**Generated:** 2026-10-23 · **Updated:** 2026-10-23

## Purpose

Every screen that operates on one connected mailbox. The `[emailAccountId]` segment is the `EmailAccount.id` (not the user id and not the email address). There is no layout in this folder; the shell comes from `../layout.tsx`, and `EmailAccountProvider` (in `@/providers`) reads the id from `useParams()` and exposes it through `useAccount()`.

## Key Files

| File | Description |
| --- | --- |
| `PermissionsCheck.tsx` | Client component, once per account per page load. Calls `checkPermissionsAction` and redirects to `/{id}/permissions/consent` when OAuth scopes or the refresh token are missing. Mount it on pages that need provider access (mail, assistant, automation). |
| `assess.tsx` | `AssessUser`, mounted by the app layout. Runs `assessAction`, inbox whitelisting (skipped for Microsoft), and writing-style analysis once. Skipped when an admin views another user's account. |
| `error.tsx` | Renders the app error boundary for this segment. |

## Subdirectories

| Directory | Description |
| --- | --- |
| `mail/` | Built-in mail client (see `mail/AGENTS.md`). |
| `assistant/` | AI rules, chat, history, settings (see `assistant/AGENTS.md`). |
| `compose/` | Compose, reply, schedule, undo-send (see `compose/AGENTS.md`). |
| `onboarding/` | Multi-step onboarding (see `onboarding/AGENTS.md`). |
| `automation/` | Tabbed automation page; hosts the rules UI from `assistant/` plus onboarding prompts. |
| `setup/` | Setup checklist (`SetupContent.tsx`, `setup-action-timeout.ts`). |
| `settings/` | Per-account settings sections: model, API keys, webhook, MCP, digest, signature, billing, delete, copy rules. |
| `stats/`, `usage/` | Email analytics charts and AI usage. |
| `bulk-unsubscribe/`, `bulk-archive/`, `quick-bulk-archive/`, `clean/`, `smart-categories/`, `cold-email-blocker/` | Inbox cleanup tools. `clean/` is a step wizard with a live `EmailFirehose`. |
| `briefs/`, `onboarding-brief/`, `meetings/`, `calendars/` | Meeting briefs, meeting recorder, calendar connections, booking links. |
| `drive/` | Document filing from Google Drive or OneDrive (connections, allowed folders, filing activity). |
| `integrations/`, `channels/` | MCP integrations (`startMcpOAuth.ts`) and messaging channels (Slack, Telegram). |
| `permissions/consent/` | Re-consent page after missing scopes. |
| `organization/create/` | Create an organization. |
| `debug/` | Developer pages: `drafts`, `follow-up`, `mail-queue`, `memories`, `report`, `rule-history`, `rules`. |

## For AI Agents

### Working In This Directory

- Server pages receive `params: Promise<{ emailAccountId: string }>`; await it and call `checkUserOwnsEmailAccount({ emailAccountId })` before reading data. It redirects to `/login` or `/no-access`. Pages that are purely client-rendered rely on the `withEmailAccount` API routes for the real check.
- Client code gets the id and provider from `useAccount()`. Branch on `provider` only at true provider boundaries (root `AGENTS.md`).
- Admins and org members can view another user's account. Use `useOrgAccess().isAccountOwner` to skip owner-only side effects (see `PermissionsCheck.tsx`, `assess.tsx`).
- Build links with `prefixPath(emailAccountId, "/path")`. Moving a page means updating the matching `(redirects)/` entry and `@/utils/path` callers.
- Long-running pages export `maxDuration` (`mail` is 180, `assistant` and `onboarding` are 300); keep it when restructuring.
- Moving or renaming a UI control breaks Playwright specs that select it by visible name. Grep `__tests__/playwright` for the label before changing it.

### Testing Requirements

- Unit and component tests are colocated (`*.test.ts`, `*.test.tsx`). Example from repo root: `pnpm test "apps/web/app/(app)/[emailAccountId]/stats"`.
- Browser coverage: `pnpm -F inbox-zero-ai test:playwright:emulated <area-or-spec>`; inspect screenshots for UI changes.

### Common Patterns

- Page: server `page.tsx` (ownership check, cookies) renders a client component that uses SWR hooks from `@/hooks` and `useAccount()`.
- Mutations: `useAction(someAction.bind(null, emailAccountId))` with actions from `@/utils/actions/*`.
- Wrap provider-dependent trees in `EmailLabelsProvider` (`@/providers/EmailLabelsProvider`) when labels are needed.

## Dependencies

### Internal

- `@/providers/EmailAccountProvider`, `@/hooks/useOrgAccess`, `@/utils/email-account`, `@/utils/path`, `@/utils/actions/*`, `@/app/api/*` response types.

### External

- `next-safe-action`, `swr`, `react-hook-form`.

## Manual Notes

Notes under this heading are written by humans and preserved on regeneration.
