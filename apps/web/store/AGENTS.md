# store

**Parent context:** `../AGENTS.md`
**Generated:** 2026-10-23 · **Updated:** 2026-10-23

## Purpose

Client-side state that outlives a single component: a shared Jotai store, a few atoms (AI queues, command palette and dialog open state), batched "do this to every thread from a sender" queues (archive, delete, mark read) with progress, and the recent-search history for mail. Server state belongs in SWR (`hooks/`), not here.

## Key Files

| File | Description |
| --- | --- |
| `index.ts` | `jotaiStore`: the one Jotai store instance, shared by `AppProviders` and by plain functions that set atoms outside React |
| `sender-queue.ts` | `createSenderQueue(createPayload, options)`: factory for a per-sender thread-mutation queue with status, progress, and session-storage persistence; also `clearStoredSenderQueues` |
| `archive-sender-queue.ts`, `delete-sender-queue.ts`, `mark-read-sender-queue.ts` | Concrete queues built from `createSenderQueue`; each aliases `addTo...Queue`, `use...SenderStatus`, and `clear...Statuses` (only archive also exposes progress hooks) |
| `fetch-sender-threads.ts` | `fetchAllSenderThreads`: pages through all threads from one sender (inbox or all scope), used by the queues |
| `ai-queue.ts` | Atom of ids currently being processed by AI; `pushToAiQueueAtom`, `removeFromAiQueueAtom`, `useAiQueueState` |
| `ai-categorize-sender-queue.ts` | Atom map of sender categorization progress; push, stop, and per-item hooks |
| `command-palette.ts` | Open-state atoms for the command palette, shortcuts dialog, and feedback dialog, plus mail and sender command context atoms |
| `mail-search-history.ts` | Per-account recent searches in `localStorage`; read, remember, match, and clear |
| `prefixed-storage.ts` | `removePrefixedStorageKeys(storage, prefix)` |

## Subdirectories

None.

## For AI Agents

### Working In This Directory

- Use `jotaiStore` from `@/store` when setting atoms outside React (see `ai-queue.ts`). `AppProviders` passes the same instance to the Jotai `Provider`, so a second `createStore()` would split state.
- Import from the specific file (`@/store/archive-sender-queue`), never a barrel; `index.ts` only exports the store.
- New sender-level bulk actions should be a new file that calls `createSenderQueue` with a `ThreadMutationPayload` factory, like `archive-sender-queue.ts`, rather than a new queue implementation. The mutations are sent through the local mail engine (`@/utils/mail-engine/thread-mail-mutations`).
- Queue state is persisted in `sessionStorage` under a key derived from the mutation payload, and `getSessionStorage` returns nothing when storage is unavailable. Writes are wrapped in try/catch because quota or private mode can fail; keep that, and keep the in-memory path working without storage.
- `clearStoredSenderQueues` and `clearRecentSearchHistory` turn persistence off for the rest of the page session and remove the stored keys (via `removePrefixedStorageKeys`). Call them only when you mean to drop local data.
- Recent searches are keyed by `emailAccountId` in `localStorage`; do not store search text in analytics (see `utils/analytics/product.ts`).
- `fetchAllSenderThreads` takes an explicit `scope` because providers treat an unfiltered thread query as inbox-only. Pass it deliberately.
- Files here use browser APIs (`window`, `sessionStorage`, `localStorage`); read them inside functions or effects so server rendering does not break. Only `archive-sender-queue.ts` carries a `"use client"` directive; the other files rely on being imported from client code.

### Testing Requirements

- Colocated tests: `sender-queue.test.ts`, `archive-sender-queue.test.tsx`, `fetch-sender-threads.test.ts`, `mail-search-history.test.ts`, `prefixed-storage.test.ts`.
- Tests touching storage or hooks start with `// @vitest-environment jsdom`; the default Vitest environment is `node`.
- Run from repo root: `pnpm test apps/web/store`

### Common Patterns

- Atoms plus exported helper functions that call `jotaiStore.set(...)`, and exported `use...` hooks built on `useAtomValue`.
- The sender queues use `useSyncExternalStore` over a listener set instead of Jotai.
- Immutable updates: copy the `Set` or `Map` before changing it.

## Dependencies

### Internal

- `@/utils/mail-engine/mutation-change` and `@/utils/mail-engine/thread-mail-mutations`, `@/utils/fetch` (`fetchWithAccount`), `@/utils/error` (`EmailProviderRateLimitError`), `@/app/api/threads/basic/route` (types).
- Consumers: bulk unsubscribe and sender screens, `components/CommandK.tsx`, the mail search UI, and `providers/AppProviders.tsx`.

### External

- `jotai`, `react` (`useSyncExternalStore`).

## Manual Notes

Notes under this heading are written by humans and preserved on regeneration.
