# utils/oauth

**Parent context:** `../AGENTS.md`
**Generated:** 2026-10-23 · **Updated:** 2026-10-23

## Purpose

The shared pieces of our own OAuth redirect flows: signed state, callback validation, mailbox account linking and reconnecting, provider configuration checks, and Microsoft error classification. Used by the route handlers that add or reconnect a Google or Microsoft mailbox, connect calendar or drive, connect Slack, and connect MCP integrations (`app/api/google/linking`, `app/api/outlook/linking`, `*/calendar/auth-url`, `*/drive/auth-url`, `app/api/slack`, `app/api/mcp/[integration]`). Sign-in itself is Better Auth (`../auth.ts`, `../auth/`).

## Key Files

| File | Description |
| --- | --- |
| `state.ts` | `generateSignedOAuthState`, `parseSignedOAuthState`, `validateSignedOAuthState`, cookie options. State is HMAC-signed with a nonce and `issuedAt` (10 minute default max age). |
| `callback-validation.ts` | `validateOAuthCallback`: checks state against the cookie and a present code; returns `targetUserId`, `stateNonce`, and `reconnectEmailAccountId`, or a redirect response. |
| `account-linking.ts` | `handleAccountLinking`: decides continue-create, merge, update-existing, update-tokens, or redirect when a provider account is added to a user. Cleans up orphaned accounts. |
| `account-linking-redirect.ts` | `createAccountLinkingRedirect`: redirect to `/accounts` with optional query params, deleting the named state cookie. |
| `reconnect-target.ts` | `findReconnectTarget`, `isReconnectTargetMismatch`: a reconnect names the mailbox it refreshes and the callback refuses a different identity. |
| `verify.ts` | `verifyEmailAccountAccess`: the current session must own the email account; throws `RedirectError`. |
| `redirect.ts` | `RedirectError`, `redirectWithMessage`, `redirectWithError`. |
| `error-handler.ts` | `handleOAuthCallbackError`: maps callback exceptions (including Microsoft AADSTS codes) to a redirect. |
| `microsoft-oauth.ts` | Parse AADSTS codes and scopes, `getMissingMicrosoftScopes`, `classifyMicrosoftOAuthError`. |
| `auth-callback-deduplication.ts` | `deduplicateOAuthCallback`: collapses duplicate Better Auth callback requests (link prefetchers, double clicks) using the Redis OAuth-code store. Used by `app/api/auth/[...all]/route.ts`. |
| `login-providers.ts`, `provider-config.ts` | Which login providers are enabled from env; `hasGoogleOauthConfig` and friends. |
| `linking-audit.ts` | Audit logger fields for linking attempts (hashed identifiers, actor versus target). |
| `apple-mobile-login.md`, `index.md` | Setup notes for native Apple login; doc-site index. |

## Subdirectories

None.

## For AI Agents

### Working In This Directory

- Every flow that starts with an `auth-url` route must store the signed state in an HTTP-only cookie and validate it in the callback with `validateOAuthCallback` before using the code. Never read `userId` or `emailAccountId` from query parameters; take them from the verified state.
- State is signed with a server secret and compared with `secureCompare`. Keep everything that matters inside the signed payload; the state cookie is HTTP-only, lax, and lives 10 minutes.
- Linking logic must never attach a provider account that already belongs to a different active user without going through `handleAccountLinking`'s merge or redirect results.
- A reconnect must keep the `reconnectEmailAccountId` constraint, or signing in as a second identity creates a new mailbox instead of refreshing the one being reconnected.
- Every error path should clear the state cookie (`createAccountLinkingRedirect` deletes the cookie given `stateCookieName`; `handleOAuthCallbackError` passes it).
- Log audit fields through `linking-audit.ts`; identifiers are hashed. Do not log codes, tokens, or raw state.
- Microsoft errors: add new AADSTS handling in `microsoft-oauth.ts` with a test, not in route files.
- MCP integration state cookies are named per integration (`getMcpStateCookieName`).

### Testing Requirements

- Co-located tests for each module (`state.test.ts`, `callback-validation.test.ts`, `account-linking.test.ts`, `reconnect-target.test.ts`, `microsoft-oauth.test.ts`, and others). Run from repo root: `pnpm test apps/web/utils/oauth`.
- Route-level tests live beside routes, for example `app/api/google/linking/callback/route.test.ts`.

### Common Patterns

- Validation functions return a discriminated result (`success: true | false`) with a ready-made `NextResponse` on failure.
- Provider is narrowed to `"google" | "microsoft"` for linking.

## Dependencies

### Internal

- `../auth.ts` (session), `../prisma.ts`, `../redis/oauth-code.ts`, `../crypto-compare.ts`, `../mcp/integrations.ts`, `../user/orphaned-account.ts`, `@/env`.

### External

- `next/server` (`NextResponse`), Node `crypto`.

## Manual Notes

Notes under this heading are written by humans and preserved on regeneration.
