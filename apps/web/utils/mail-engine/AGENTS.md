# utils/mail-engine

**Parent context:** `../AGENTS.md`
**Generated:** 2026-10-23 · **Updated:** 2026-10-23

## Purpose

Client-side glue for the local-first mail engine. The engine itself lives in the workspace packages (`@inboxzero/mail-core`, `@inboxzero/mail-sqlite`, `@inboxzero/mail-react`, under `packages/`); this folder wires it into the Next.js app. It starts the engine in the browser (a Web Worker with SQLite on OPFS) or through the desktop app's IPC bridge, talks to the server's mail routes over HTTP with the active account header, and translates app concepts (threads queries, mutations, splits, drafts) into engine queries and commands. The server counterpart that feeds it provider data is `../email/local-mail-sync*.ts`, `../email/mailbox-sync.ts` and the per-provider `local-mail-sync.ts` in `../gmail/` and `../outlook/`.

## Key Files

| File | Description |
|------|-------------|
| `MailEngineHost.tsx` | Client component that decides whether to start the engine for the current route, holds the owner lock, and provides `MailEngineProvider`; renders startup failure states |
| `MailEngineConnectionBanner.tsx` | Connection/offline notice UI |
| `runtime-mode.ts` | `selectMailEngineRuntimeMode` (`desktop-ipc` / `browser` / `unavailable`) and `shouldStartMailEngine` (which routes need the engine) |
| `create-browser-engine.ts`, `engine-worker.ts`, `worker-protocol.ts`, `worker-session.ts` | Main-thread client, worker entry, message protocol (`BrowserEngineStart`, `WorkerRequest`) and worker session host |
| `desktop-ipc.ts` | Same client interface backed by the desktop app's IPC (`getInboxZeroDesktopApp`) |
| `wasm-sqlite.ts`, `storage-pressure.ts` | WASM SQLite driver over OPFS, storage quota handling |
| `owner-lock.ts`, `tab-channel.ts` | One tab owns the OPFS database via a Web Lock; other tabs follow over a BroadcastChannel |
| `http.ts` | `createMailHttpRequest(accountId)`: fetch wrapper that sends `EMAIL_ACCOUNT_HEADER` and streams bytes |
| `active-client.ts` | Module-level active `MailClient`, logout listeners, `closeActiveMailEngine` |
| `follow-mailbox-changes.ts` | Subscribes to server change events (EventSource) to trigger sync |
| `threads-query.ts`, `list-thread.ts`, `conversation-thread.ts` | Convert app `ThreadsQuery` and engine conversations into each other |
| `mutation-change.ts`, `thread-mail-mutations.ts`, `command-status.ts` | Thread mutations (archive, trash, spam, read, star, snooze) as engine commands and their status |
| `reply-drafts.ts`, `draft-content.ts`, `submit-conversations.ts`, `engine-delivery.ts` | Draft and send flow through the engine |
| `label-count-targets.ts`, `coverage.ts` | Folder/label count targets; waiting for metadata coverage to be complete |
| `wipe-local-mailbox.ts`, `clear-local-mail-account.ts`, `startup-failure.ts`, `startup-error.ts`, `admission-notice.ts`, `connection-notice.ts` | Reset and error/notice reporting |

## Subdirectories

None.

## For AI Agents

### Working In This Directory

- Browser-only code. Anything touching OPFS, workers, `navigator.locks`, `BroadcastChannel` or `EventSource` must stay out of server components and server utilities. `MailEngineHost.tsx` is `"use client"`.
- Exactly one tab owns the engine (`owner-lock.ts`). OPFS handles must be released before another tab starts, so `close` must always run in the `finally` path. Follower tabs read through `tab-channel.ts`; code that calls `getDiagnostics` on a follower must be abortable (see the comment in `coverage.ts`).
- The engine only starts on specific routes (`shouldStartMailEngine`). Adding a page that reads the local mailbox means adding its route segment there.
- Requests to the server must go through `createMailHttpRequest` so the active account header is set; the server routes read it to pick the email account.
- Provider is a plain `"google" | "microsoft"` string here (`BrowserEngineStart`); do not import `EmailProvider` implementations into this folder.
- Offline handling: `requestSyncUnlessOffline` avoids releasing deferred work while `navigator.onLine` is false. Use it instead of calling sync directly.
- Logout is expected to call `closeActiveMailEngine` (and `wipeLocalMailbox` when clearing data) so the on-device database does not leak between users.

### Testing Requirements

- Co-located `*.test.ts` / `*.test.tsx` (Vitest, node environment; `MailEngineHost.test.tsx` uses the React test setup).
- Run from repo root: `pnpm test apps/web/utils/mail-engine`
- Browser behaviour: `pnpm -F inbox-zero-ai test:playwright:emulated <area-or-spec>` and `pnpm -F inbox-zero-ai test:mail-loading` (see `../../__tests__/playwright/` and its AGENTS.md).

### Common Patterns

- Small pure helpers with explicit input objects (`selectMailEngineRuntimeMode({ desktopIpc, opfs, worker })`) so runtime decisions are unit-testable.
- Engine types come from `@inboxzero/mail-core/*` subpath imports (`engine`, `queries`, `commands`, `operations`, `protocol/*`).

## Dependencies

### Internal

- `@inboxzero/mail-core`, `@inboxzero/mail-sqlite`, `@inboxzero/mail-react` (workspace packages); `../desktop-app`, `../config` (`EMAIL_ACCOUNT_HEADER`), `../threads/validation`, `../outlook/inbox-sections`, `@/store/*`, `@/providers/EmailAccountProvider`, `@/components/ui/*`.
- Consumed by `app/(app)/layout.tsx`, the mail pages under `app/(app)/[emailAccountId]/mail/`, compose, and `../split-inbox/split-counts.ts`.

### External

- Browser APIs: OPFS, Web Workers, Web Locks, BroadcastChannel, EventSource.

## Manual Notes

Notes under this heading are written by humans and preserved on regeneration.
