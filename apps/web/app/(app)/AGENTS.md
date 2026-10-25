# app/(app)

**Parent context:** `../AGENTS.md`
**Generated:** 2026-10-23 · **Updated:** 2026-10-23

## Purpose

The authenticated product. `layout.tsx` redirects to `/login` when there is no session, then wraps everything in the app shell (side nav, command palette, feedback and settings dialogs, mail engine runtime). Pages that act on one mailbox sit under `[emailAccountId]/`; pages that are about the user or organization sit directly here.

## Key Files

| File | Description |
| --- | --- |
| `layout.tsx` | Auth gate and shell. Reads sidebar and chat-width cookies, updates `lastLogin` in `after()`, mounts `AppProviders`, `MailEngineRuntime`, `SideNavWithTopNav`, `EmailViewer`, `SettingsDialog`, `CommandK`, `AssessUser`. |
| `error.tsx` | App-wide error boundary. `[emailAccountId]/error.tsx` renders it. It wraps `components/AppErrorBoundary`. |
| `AiAutomationStatusBanner.tsx`, `AppAlertBanner.tsx`, `ErrorMessages.tsx`, `ProviderRateLimitBanner.tsx` | Banners rendered above every page by the layout. |
| `DesktopMailIndicators.tsx`, `DesktopUpdateToast.tsx` | Desktop app badge and update prompt (`DesktopMailIndicators.test.ts` covers the logic). |
| `sentry-identify.tsx` | Tags Sentry events with the signed-in email. |

## Subdirectories

| Directory | Description |
| --- | --- |
| `[emailAccountId]/` | All per-mailbox features (see `[emailAccountId]/AGENTS.md`). |
| `accounts/` | List and connect email accounts (`AddAccount.tsx`). |
| `admin/` | Admin-only tools (user upgrade, Stripe sync, SSO registration, SCIM credentials, top spenders). The page checks `isAdmin` from `@/utils/admin`; backing routes use `withAdmin`. |
| `config/`, `license/`, `refer/`, `early-access/` | Small single-page screens: admin-only runtime config view (`isAdmin` check), license key activation, referrals, early-access feature page. |
| `no-access/` | Landing page for `checkUserOwnsEmailAccount` failures. |
| `organization/[organizationId]/` | Organization members, stats, shared rules (`rules/`), analytics consent banner. |
| `premium/` | Pricing and subscription UI. `config.ts` defines `tiers`, which the root `app/layout.tsx` also imports. `config.test.ts` covers it. |
| `settings/` | User-level settings; `SettingsDialog.tsx` is mounted globally by the layout, `page.tsx` is the full-page version. |
| `shared/` | Shared conversation list, activity, and `[conversationId]` view. |

## For AI Agents

### Working In This Directory

- The layout is a server component that uses `auth()`; do not turn it into a client component. Anything reading `useAccount()` must render under `[emailAccountId]/` or handle an empty `emailAccountId` (the provider returns a preview value outside an account route).
- A page that takes `emailAccountId` from params and touches data must call `checkUserOwnsEmailAccount({ emailAccountId })` (from `@/utils/email-account`) or use an API route with `withEmailAccount`. The layout does not check ownership.
- Links between account pages use `prefixPath(emailAccountId, "/path")` from `@/utils/path`; do not hand-build `/${id}/...`.
- Add new global banners to the layout only if they should show on every screen; per-feature banners belong with that feature.
- New top-level routes that need a short URL also need a `(redirects)/` entry (see `../AGENTS.md`).

### Testing Requirements

- Colocated vitest files, for example `pnpm test apps/web/app/(app)/premium/config.test.ts` from repo root (quote the path in a shell: `pnpm test "apps/web/app/(app)/premium/config.test.ts"`).
- Component tests (`*.test.tsx`) use the repo's testing setup; read `.claude/skills/testing/SKILL.md` first.

### Common Patterns

- Server `page.tsx` does auth and prefetch, then renders a client component for SWR-driven UI.
- Mutations go through `next-safe-action` actions in `@/utils/actions/*`, called with `useAction(action.bind(null, emailAccountId))`.

## Dependencies

### Internal

- `@/components` (`SideNavWithTopNav`, `CommandK`, `EmailViewer`), `@/providers` (`AppProviders`, `PostHogProvider`), `@/utils/mail-engine`, `@/utils/auth`, `@/utils/prisma`.

### External

- `next`, `next-safe-action`, `swr`, `@sentry/nextjs`.

## Manual Notes

Notes under this heading are written by humans and preserved on regeneration.
