# hooks

**Parent context:** `../AGENTS.md`
**Generated:** 2026-10-23 · **Updated:** 2026-10-23

## Purpose

Client-side React hooks. Most are thin SWR wrappers around an API route (`useRules`, `useLabels`, `useUser`, `useMeetingRecorderSettings`, and so on); the rest are UI helpers (`useModal`, `useDialogState`, `useToggleSelect`, `useTableKeyboardNavigation`), draft persistence, voice capture, analytics, and feature flags. The folder is flat: about 95 files, each named `use<Thing>.ts(x)`.

## Key Files

| File | Description |
| --- | --- |
| `useUser.ts` | Current user and premium data from `/api/user/me`; treats a 401 as "logged out" rather than an error |
| `usePremium.ts` | Derives tier and access flags from `useUser`; honors `NEXT_PUBLIC_BYPASS_PREMIUM_CHECKS` |
| `useAccounts.ts` | All email accounts for the user (`EMAIL_ACCOUNTS_KEY`) |
| `useRules.tsx`, `useRule.tsx`, `useExecutedRules.tsx` | Assistant rule data |
| `useLabels.ts`, `useLabelCounts.ts`, `useFolders.ts` | Label, label-count, and folder data; `useFolders` is Microsoft-only and disabled for other providers |
| `useThreads.ts`, `useThread.ts`, `useThreadsByIds.ts`, `useMessages.ts`, `useMessagesBatch.ts` | Thread and message loading; `useThread` also reads from the local mail engine when one is available |
| `useReplyDrafts.ts`, `useLocalReplyDraft.ts`, `useReplyDraftPersistence.ts`, `useProviderDraftAutosave.ts` | Reply draft state: local copy, persistence, and provider-side autosave |
| `useMailSettings.ts` | Mail layout, split inbox, and preview settings, validated with a Zod schema |
| `useOrgSWR.ts` | `useSWR` replacement that sends the `X-Email-Account-ID` header for an account other than the signed-in one; uses a bare `fetch` and its own JSON handling, not the global fetcher |
| `useOrganization*.ts`, `useOrg*.ts`, `useOrgAccess.ts` | Organization membership, members, rules, and stats |
| `useMeetingRecorder.ts`, `useMeetingBriefs.ts` | Meeting notetaker and briefing data with polling intervals |
| `useVoiceDictation.ts`, `useVoiceLive.ts`, `useVoiceStatus.ts` | Browser side of `utils/voice/` |
| `useDrive*.ts`, `useFiling*.ts` | Drive connections, folders, and attachment-filing activity |
| `useFeatureFlags.ts` | PostHog flags and `NEXT_PUBLIC_*` env toggles as hooks |
| `useAnalytics.ts`, `useProductAnalytics.ts`, `useVideoAnalytics.ts` | PostHog helpers for onboarding, product events, and video |

## Subdirectories

None.

## For AI Agents

### Working In This Directory

- Data hooks call `useSWR` with a URL string and no fetcher. The global fetcher is configured in `providers/SWRProvider.tsx` and adds the `EMAIL_ACCOUNT_HEADER` for the current account. To fetch for a specific account, pass an array key `[url, emailAccountId]`; `getAccountScopedKey` in `utils/swr.ts` builds that (and returns `null`, which skips the request, when the id is falsy).
- Import response types from the route file (`import type { RulesResponse } from "@/app/api/user/rules/route"`) so the hook stays in sync with the API. Do not redeclare response shapes. See the "Fullstack Workflow" section of the root `AGENTS.md`.
- Use `useOrgSWR` only for endpoints that support org-admin access to another member's account. Account-only endpoints should use plain `useSWR`.
- Pass `null` as the key to disable a request (`enabled ? url : null`); many hooks take an `enabled` argument for this.
- Mutations are server actions in `utils/actions/`, called with `useAction` in components, then `mutate()` on the relevant key. Hooks here read data; they do not usually own writes.
- Only some hooks are marked `"use client"` (about 15 of 95); the rest rely on being imported from client components. Add the directive to any new hook that is imported from a server component, uses `@/env` client values, or otherwise needs it.
- Hooks must not import server-only modules (Prisma, server env, `utils/*.server.ts`). Shared pure helpers from `utils/` are fine.
- Do not mirror fetched data into local state with `useEffect`; derive it or keep explicit edit state (root `AGENTS.md`).
- `SWRProvider` persists a whitelist of SWR keys (`PERSISTED_SWR_KEYS` in `utils/swr-persistence.ts`) and resets the cache on account switch. A new key that should survive reloads must be added to that list.

### Testing Requirements

- Colocated tests: `useAnalytics.test.ts`, `useLabels.test.ts`, `useLocalReplyDraft.test.tsx`, `useMailSettings.test.tsx`, `useOrganizationMembership.test.ts`, `usePremium.test.ts`, `useProviderDraftAutosave.test.ts`, `useReplyDraftPersistence.test.tsx`, `useReplyDrafts.test.tsx`, `useThread.test.tsx`, `useToggleSelect.test.ts`.
- Vitest runs in the `node` environment by default. Hook tests that render use `@testing-library/react` `renderHook` and a first-line `// @vitest-environment jsdom` comment.
- Run from repo root: `pnpm test apps/web/hooks`
- For SWR hooks, wrap `renderHook` in a fresh `SWRConfig` with a new cache `provider` so tests do not share state (see `useMailSettings.test.tsx`).

### Common Patterns

- One hook per file, named after the file; return the raw `useSWR` result unless a derived value is needed (`useUser` and `useLabels` are the usual exceptions).
- Polling uses named constants (for example `MEETING_STATUS_REFRESH_INTERVAL`), not inline numbers.
- Account switching is global state: read the current account with `useAccount()` from `@/providers/EmailAccountProvider` rather than from route params.

## Dependencies

### Internal

- `@/providers/EmailAccountProvider` (`useAccount`), `@/providers/SWRProvider`, `@/app/api/**/route` (types only), `@/utils/swr`, `@/utils/config`, `@/generated/prisma/enums`, `@/utils/voice/*`, `@/utils/meeting-recorder/recording-lifecycle`, `@inboxzero/mail-react` and `@inboxzero/mail-core` (local mail engine).

### External

- `swr`, `posthog-js/react`, `zod`, `next/navigation`.

## Manual Notes

Notes under this heading are written by humans and preserved on regeneration.
