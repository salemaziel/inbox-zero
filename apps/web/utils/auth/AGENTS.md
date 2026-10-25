# utils/auth

**Parent context:** `../AGENTS.md`
**Generated:** 2026-10-23 · **Updated:** 2026-10-23

## Purpose

Helpers for the Better Auth setup: sign-in plugins (email code, SSO, SCIM, Apple), provider token storage and cleanup, and fixes for identity quirks between providers and Better Auth versions. The Better Auth configuration itself is in `../auth.ts` (a sibling file, not in this folder). Browser OAuth redirects, state, and mailbox linking are in `../oauth/`.

## Key Files

| File | Description |
| --- | --- |
| `save-tokens.ts` | `saveTokens`: writes refreshed access and refresh tokens, addressed either by `providerAccountId` or by `emailAccountId`. Takes `expectedExpiresAt` so a stale refresh cannot overwrite a newer token. |
| `cleanup-invalid-tokens.ts` | `cleanupInvalidTokens`: on permanent auth failures (`invalid_grant`, missing permissions, policy enforced, mail service not enabled) clears credentials, sets `disconnectedAt`, and notifies the user (in-app message and reconnection email). |
| `email-otp.ts` | `emailOtpPlugin`, before/after hooks, and session-creation hook for passwordless email-code login. Sign-up is disabled, codes are stored encrypted, expiry 5 minutes, 5 attempts. |
| `email-otp-setting.ts` | `updateEmailOtpSetting`: per-user on/off switch. Only a session from a connected provider (not an email-code session) may change it, and each change bumps `emailOtpVersion` to invalidate existing email-code sessions. |
| `sso.ts` | `adminSso`: wraps the Better Auth SSO plugin so provider-management endpoints require an admin. |
| `scim.ts` | `getScimOptions`, `assertScimUserActive`. Only enabled when `SCIM_CREDENTIAL_HASH_SECRET` is set. |
| `apple-client-secret.ts` | Builds the Sign in with Apple client secret at runtime with Node `crypto` (180 day TTL). Never store a static secret. |
| `microsoft-account-subject.ts` | `reconcileMicrosoftAccountSubject`: re-keys legacy accounts stored under `sub` to `oid`. |
| `rename-email.ts` | `syncGoogleEmailFromProfile`, `renameGoogleEmail`: keeps the stored mailbox address in sync after a Google rename, since push notifications use the address. |

## Subdirectories

None.

## For AI Agents

### Working In This Directory

- Import the session getter as `@/utils/auth` (the file). Helpers here are `@/utils/auth/<name>`. Do not move the session getter into this folder.
- All plugins are registered in `../auth.ts`. Adding a plugin or hook means editing both places.
- Token writes go through `saveTokens`; do not `prisma.account.update` tokens elsewhere, or the stale-write guard is bypassed.
- Disconnect on permanent failure with `cleanupInvalidTokens`, not by deleting the account. It keeps the mailbox record so the user can reconnect from the UI.
- Identity matching is security sensitive. `microsoft-account-subject.ts` requires `oid` and `sub` from the same id token before re-keying a row; do not relax this to match on email, which tenants can set freely.
- Management endpoints for SSO must keep the admin check in `adminSso`; hooks there guard both HTTP and server API calls.
- Mobile Apple login needs extra env (`APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`, and more). Setup notes are in `../oauth/apple-mobile-login.md`.
- Log with `createScopedLogger("auth/...")`; never log tokens, OTP codes, or client secrets.

### Testing Requirements

- Co-located tests: `email-otp.test.ts`, `sso.test.ts`, `scim.test.ts`, `cleanup-invalid-tokens.test.ts`, `rename-email.test.ts`, `microsoft-account-subject.test.ts`, `provider-account-subject.test.ts` (pins which claim Better Auth keys accounts on, so an upstream upgrade fails loudly), and others.
- Run from repo root: `pnpm test apps/web/utils/auth`. `../auth.test.ts` and `../auth-schema.test.ts` cover the main config.

### Common Patterns

- Plugin pieces are exported from here as values (`emailOtpPlugin`) or factory functions (`getScimOptions`, `adminSso`) and composed in `../auth.ts`.
- User-visible failures go through `../error-messages` helpers (`addUserErrorMessageWithNotification`).

## Dependencies

### Internal

- `../auth.ts`, `../prisma.ts`, `../admin.ts`, `../error-messages`, `../encryption.ts`, `../unsubscribe.ts`, `../logger.ts`, `@/env`, `@inboxzero/transactional-email`.

### External

- `better-auth` (`email-otp`, `sso`, API middleware), `@better-auth/scim`, Node `crypto` for the Apple secret, Prisma.

## Manual Notes

Notes under this heading are written by humans and preserved on regeneration.
