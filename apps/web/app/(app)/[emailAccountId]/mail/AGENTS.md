# app/(app)/[emailAccountId]/mail

**Parent context:** `../AGENTS.md`
**Generated:** 2026-10-23 · **Updated:** 2026-10-23

## Purpose

The built-in mail client: sidebar, thread list, reader pane, search, split tabs, label picker, snooze and command-palette actions. Thread data does not come from per-request API fetches. It comes from the local mail engine (`@inboxzero/mail-core`, `@inboxzero/mail-react`) that `MailEngineHost` starts in the browser, and the hooks here read from that engine and submit changes back to it.

## Key Files

| File | Description |
| --- | --- |
| `page.tsx` | Entry. Wraps `MailShell` in `EmailLabelsProvider` and `MailEngineHost` (from `@/utils/mail-engine/MailEngineHost`) and mounts `PermissionsCheck`. Exports `maxDuration = 180`. |
| `layout.tsx` | Reads the sidebar and list width cookies, supplies `ShortcutsProvider` with `MAIL_SHORTCUT_SCOPES`, mounts `MailThemeScope` and `DeploymentUpdateNotice`. Exposes widths as CSS variables. |
| `MailShell.tsx` | Top-level screen state: URL query state (via `nuqs`), selection, search, layout mode, wiring of list, reader, toolbar, dialogs. Largest file here. |
| `MailListPanel.tsx`, `ThreadList.tsx`, `ThreadRow.tsx` | List UI. |
| `MailReaderPane.tsx`, `ThreadReader.tsx`, `BufferedThreadReader.tsx`, `ReaderToolbar.tsx` | Reader UI. `BufferedThreadReader` keeps the previous thread visible while the next loads. |
| `MailSidebar.tsx`, `MailShellSidebar.tsx`, `MailAccountSwitcher.tsx` | Navigation, labels, account switching. `MailSidebar.tsx` also exports `getMailNavPath` and `MAIL_SCHEDULED_TYPE`. |
| `use-engine-mail-threads.ts`, `use-mail-threads.ts`, `use-combined-mail-threads.ts` | Thread list sources: single account, engine-backed, and all-accounts combined. Convert `ThreadsQuery` to engine queries via `@/utils/mail-engine/threads-query`. |
| `use-thread-actions.ts` | Archive, unarchive, trash (undoable with toasts) and snooze. Submits changes through `submitConversationChanges` and surfaces `admissionRejectionCopy`. |
| `use-optimistic-archive.ts`, `thread-list-behavior.ts`, `thread-select-all.ts`, `use-thread-selection.ts` | Optimistic removal, next-thread selection, and selection rules. |
| `types.ts` | `ListThread` (single-account or `CombinedListThread`) and key helpers such as `getListThreadKey`, `getListThreadSelection`. |
| `panel-widths.ts` | Cookie names and bounds for the sidebar and list panes. |
| `mail-search-query.ts`, `outlook-search-query.ts`, `MailSearchFilters.tsx`, `OutlookSearchFilters.tsx` | Search parsing and filters; Gmail and Outlook differ. |
| `label-tree.ts`, `label-visibility.ts`, `outlook-folder-list.ts`, `LabelPickerDialog.tsx` | Gmail labels versus Outlook folders. |
| `mail-command-palette.ts`, `snooze-command-palette.ts`, `ShortcutsDialog.tsx` | Command palette entries and shortcuts (registry lives in `@/lib/shortcuts`). |

## Subdirectories

None. All files are flat. Group by pattern:

- `use-*.ts(x)`: hooks with colocated `*.test.ts(x)`.
- `*-state.ts`, `*-query.ts`, `*-behavior.ts`: pure logic, unit tested without React.
- `*Dialog.tsx`, `*Menu.tsx`: dialogs and context menus.

## For AI Agents

### Working In This Directory

- Thread reads and writes go through the mail engine client (`useOptionalMailClient` from `@inboxzero/mail-react/MailEngineProvider`). Follow that path for new list behavior instead of adding separate fetches.
- Gmail and Outlook differ: labels versus folders, different search syntax. Check `provider` from `useAccount()` (or the helpers in `@/utils/email/provider-types`) only where the UI genuinely differs (for example `MailShell.tsx`, `MailSplitTabs.tsx`, `MailShellSidebar.tsx`, label code); keep everything else on the provider-neutral thread shape.
- `ListThread` can be a combined all-accounts thread. Always use `getListThreadEmailAccountId(thread)` rather than assuming the route's `emailAccountId`.
- Two selection keys exist: `getListThreadKey` (list identity) and `getThreadSelectionKey` (selection). Do not mix them.
- Archive is optimistic. If you add an action that removes a thread from the list, route it through `use-thread-actions` and hide it with `useOptimisticArchive` (wired in `MailShell.tsx`) so undo and rollback keep working.
- Panel widths persist in cookies read by the server layout; changing a cookie name or bounds in `panel-widths.ts` changes both server and client.
- Keyboard shortcuts must be registered in `@/lib/shortcuts/registry` under a mail scope; hint text comes from `getShortcutHint`.
- Renaming a visible control label breaks Playwright specs (root `AGENTS.md`); grep `__tests__/playwright` first.

### Testing Requirements

- Colocated tests only, jsdom ones are `*.test.tsx`. From repo root: `pnpm test "apps/web/app/(app)/[emailAccountId]/mail"` or one file, for example `pnpm test "apps/web/app/(app)/[emailAccountId]/mail/thread-list-behavior.test.ts"`.
- Browser flows: `pnpm -F inbox-zero-ai test:playwright:emulated mail` (specs in `../../../../__tests__/playwright/emulated/mail`).

### Common Patterns

- Pure helper plus a hook plus a test: `read-state.ts` / `star-state.ts`, `subscribe-to-visible-revalidation.ts`.
- Error containment around panes with `MailPanelErrorBoundary`.
- Toasts with undo via `toastUndo` from `@/components/Toast`.

## Dependencies

### Internal

- `@/utils/mail-engine/*` (host, queries, mutation changes), `@/utils/threads/*`, `@/providers/EmailAccountProvider`, `@/providers/EmailLabelsProvider`, `@/lib/shortcuts`, `@/components/email-list`, `../compose` for reply and forward.

### External

- `@inboxzero/mail-core`, `@inboxzero/mail-react`, `nuqs`, `react-hotkeys-hook`, `sonner`, `date-fns`.

## Manual Notes

Notes under this heading are written by humans and preserved on regeneration.
