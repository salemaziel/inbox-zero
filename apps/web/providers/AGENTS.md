# providers

**Parent context:** `../AGENTS.md`
**Generated:** 2026-10-23 · **Updated:** 2026-10-23

## Purpose

React context providers and the SWR fetch layer. `GlobalProviders` and `PostHogProvider` wrap the whole app from `app/layout.tsx`; `AppProviders` wraps the signed-in app from `app/(app)/layout.tsx`. The provider order in `AppProviders.tsx` is the dependency order, so read it before adding one.

## Key Files

| File | Description |
| --- | --- |
| `GlobalProviders.tsx` | Root: service worker registration (Serwist), desktop-shell readiness and update handling, a basic `SWRConfig`, and the nuqs adapter |
| `PostHogProvider.tsx` | PostHog init plus `PostHogPageview` and `PostHogIdentify` |
| `AppProviders.tsx` | Signed-in app stack: theme, Jotai store, `EmailAccountProvider`, `SWRProvider`, `StatLoaderProvider`, `ChatProvider`, `MailEngineRuntime`, `ComposeModalProvider` |
| `EmailAccountProvider.tsx` | Current account from the route: `useAccount()`, plus `EmailAccountPreviewProvider` (empty account for previews) and `EmailAccountScopeProvider` (temporarily act as another owning account) |
| `SWRProvider.tsx` | Account-aware SWR config, cache reset on account switch, persisted-cache hydration |
| `swr-fetcher.ts` | `swrFetcher`: adds the account header, handles error responses, auth-expiry redirects, and error reporting |
| `swr-error.ts` | Normalizes error payloads into a message |
| `ChatProvider.tsx` | Assistant chat state on top of the AI SDK chat hook; `useChat()` |
| `ComposeModalProvider.tsx` | Compose window open state and "pop out reply" handoff; `useComposeModal()` |
| `EmailLabelsProvider.tsx` | Map of user labels by id for the current account; `useEmailLabels()` |
| `StatLoaderProvider.tsx` | Background loading of sender stats with progress toasts; `useStatLoader()` |
| `email-label-types.ts` | `EmailLabel` and `EmailLabels` types |
| `useCloseComposeOnMailExit.ts` | Small hook that closes compose when the user leaves the mail view |

## Subdirectories

None.

## For AI Agents

### Working In This Directory

- `EmailAccountProvider` sits above `SWRProvider` on purpose: the SWR fetcher needs the account id. That is why it loads accounts through `fetchEmailAccounts` instead of `useAccounts()` (see its comment). Do not move it below SWR or make it depend on SWR hooks.
- `useAccount()` throws if used outside an account provider. Use it rather than reading `emailAccountId` from route params, because `EmailAccountScopeProvider` can override the account without changing the route.
- `GlobalProviders` has a plain `SWRConfig` with `swrFetcher`, and `SWRProvider` (inside `AppProviders`) overrides it with the account-aware fetcher. An array SWR key `[url, emailAccountId]` fetches for that account; a string key uses the current account. See `hooks/AGENTS.md`.
- Switching accounts resets the SWR cache (`resetCache`) except for the first load from an empty id. If you add state keyed by account, clear it on switch the same way.
- The PostHog page-view code strips thread and search params before capture (`getPageViewSearch`); do not send raw URLs. Event rules are in `utils/analytics/product.ts`.
- `EmailLabelsProvider` is mounted per page (for example the assistant page), not globally; wrap what needs `useEmailLabels()`.
- Service worker registration is disabled outside production (`disable={process.env.NODE_ENV !== "production"}`); the worker itself is built by `serwist build`.
- These are client components. Do not add server-only imports.

### Testing Requirements

- Colocated tests: `ChatProvider.test.tsx`, `EmailAccountProvider.test.tsx`, `GlobalProviders.test.tsx`, `SWRProvider.test.tsx`, `swr-error.test.ts`, `swr-fetcher.test.ts`, `useCloseComposeOnMailExit.test.ts`.
- Provider component tests start with `// @vitest-environment jsdom`; the default Vitest environment is `node`.
- Run from repo root: `pnpm test apps/web/providers`

### Common Patterns

- Context + hook in the same file: `createContext` with a safe default (or a throwing hook), `useX()` exported next to `XProvider`.
- Error reporting in fetch code goes through `captureException` from `@/utils/error`.

## Dependencies

### Internal

- `@/utils/swr`, `@/utils/swr-persistence`, `@/utils/fetch-email-accounts`, `@/utils/config` (header and error codes), `@/utils/mail-engine/MailEngineHost`, `@/store` (Jotai store), `@/utils/analytics/product`, `@/hooks/useLabels`, `@/utils/actions/email-account-cookie`.
- Consumers: `app/layout.tsx`, `app/(app)/layout.tsx`, and every client hook that calls `useAccount()`.

### External

- `swr`, `next-themes`, `jotai`, `posthog-js`, `@serwist/next` (service worker), `nuqs`, `@ai-sdk/react`.

## Manual Notes

Notes under this heading are written by humans and preserved on regeneration.
