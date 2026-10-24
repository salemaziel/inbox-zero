# components

**Parent context:** `../AGENTS.md`
**Generated:** 2026-10-23 · **Updated:** 2026-10-23

## Purpose

Reusable React components shared across routes: shadcn/ui primitives, app-wide building blocks (buttons, inputs, toasts, loading/error states, side nav), and a few feature clusters. Route-specific components do not belong here; they live next to their `page.tsx` (root `AGENTS.md`).

## Key Files

| File | Description |
| --- | --- |
| `LoadingContent.tsx` | Standard wrapper for async data: `<LoadingContent loading error>`; shows `Loading`/`ErrorDisplay`, offline-aware via `useIsOnline` |
| `Toast.tsx` | `toastSuccess`, `toastError`, `toastInfo`, `toastUndo`, `Toaster`. Use these, not direct sonner calls |
| `Tooltip.tsx` | App `Tooltip` wrapper (content string, shortcuts, side) over `ui/tooltip` |
| `Input.tsx` | Legacy react-hook-form `Input` taking `registerProps`/`error`, plus `Label`, `ExplainText`, `ErrorMessage` |
| `Button.tsx` | Older button with `link` prop and `ButtonLoader`; only 6 importers. New code uses `ui/button.tsx` |
| `Combobox.tsx`, `Select.tsx`, `MultiSelectFilter.tsx`, `LabelCombobox.tsx` | Selection controls |
| `SideNav.tsx`, `SideNavMenu.tsx`, `SideNavWithTopNav.tsx`, `TopBar.tsx`, `CommandK.tsx` | App chrome and command palette |
| `ConfirmDialog.tsx`, `ErrorBoundary.tsx`, `AppErrorBoundary.tsx`, `ErrorDisplay.tsx`, `ErrorPage.tsx` | Dialogs and error handling; `app-error-boundary-log-context.ts` builds the log context |
| `PremiumAlert.tsx`, `PlanBadge.tsx`, `UpgradeToPlusButton.tsx`, `EndTrialButton.tsx` | Billing and plan gating UI |
| `EmailMessageCell*.ts(x)`, `EmailCell.tsx`, `EmailViewer.tsx`, `SenderIcon.tsx` | Email list cells and viewer (the thread view itself is in `email-list/`) |
| `TimezoneDetector.tsx`, `theme-provider.tsx`, `chat-sidebar-width.ts` | Small client utilities |
| `*.test.ts(x)` | Colocated tests next to the component they cover |

## Subdirectories

| Directory | Description |
| --- | --- |
| `ui/` | shadcn/ui primitives, lowercase kebab-case (see `ui/AGENTS.md`) |
| `assistant-chat/` | Assistant chat UI: messages, tool-call rendering, history (see `assistant-chat/AGENTS.md`) |
| `email-list/` | Thread and message rendering for the mail reader (see `email-list/AGENTS.md`) |
| `new-landing/` | Current marketing site sections and primitives (see `new-landing/AGENTS.md`) |
| `ai-elements/` | Vendored AI Elements registry components (`prompt-input`, `conversation`, `message`, `tool`, `reasoning`, ...) used by chat |
| `kibo-ui/` | Vendored Kibo UI registry components (`tree`) |
| `team-comments/` | Conversation discussion, participants, share dialog, `CommentComposer` |
| `editor/` | Tiptap-based rich text editors (`Tiptap.tsx`, `SimpleRichTextEditor.tsx`, `extensions/`) |
| `voice/` | Voice input and overlay (`VoiceInput`, `VoiceOverlay`, `AudioLevelBars`) |
| `messaging/` | `DeliveryChannelsSetting.tsx` |
| `snippets/`, `drive/`, `charts/`, `bulk-archive/`, `feature-announcements/`, `layouts/` | Small feature clusters; `layouts/` holds `BasicLayout` and `BlogLayout` |

## For AI Agents

### Working In This Directory

- Use shadcn/ui from `ui/` first (root `AGENTS.md`). `components.json` registers the `@ai-elements` and `@kibo-ui` registries; `ai-elements/` and `kibo-ui/` are vendored output, so prefer wrapping over editing them.
- Prefer `ui/button.tsx` over the older `Button.tsx`. `Button.tsx`, `Input.tsx`, and similar top-level files are legacy but still used; do not mass-migrate them as part of an unrelated change.
- Async data goes through `LoadingContent`; user feedback through `Toast.tsx`.
- Files that use hooks, state, or browser APIs start with `"use client"`. Components that only render props can stay server-compatible; do not add the directive reflexively.
- Top-level file names here are PascalCase; `ui/` and the chat/email clusters use kebab-case or camelCase per their own convention. Match the folder you are in.
- Anything shared by one route only should move next to that route's `page.tsx`; do not create `components/` subfolders under `app/`.
- Fetching with SWR and mutations with server actions belong in the caller or a hook (`../hooks/`), not in presentational components.

### Testing Requirements

Tests are colocated. Component tests need the jsdom environment, declared per file with `// @vitest-environment jsdom` (or `/** @vitest-environment jsdom */`) at the top; stub `ResizeObserver` when the component needs it (see `email-list/EmailThread.test.tsx`).

```bash
pnpm test apps/web/components/LoadingContent.test.tsx
pnpm test apps/web/components/PremiumAlert.test.tsx
pnpm test apps/web/components
```

Browser-facing changes also need a Playwright pass: grep `../__tests__/playwright` for any visible label you rename (root `AGENTS.md`).

### Common Patterns

- Class merging with `cn` from `@/utils`; variants with `cva`.
- Forms: React Hook Form with `useAction`; show errors with `getActionErrorMessage` (see `.claude/skills/fullstack-workflow/SKILL.md`, `.claude/skills/ui-components/SKILL.md`).

## Dependencies

### Internal

- `@/utils` (`cn`), `@/hooks/*`, `@/providers/*` (notably `EmailAccountProvider`, `ChatProvider`), `@/utils/actions/*`.

### External

- Radix UI, `class-variance-authority`, `lucide-react`, `tailwindcss`, `react-hook-form`, `swr`, `motion`, Tiptap, `@ai-sdk/react`.

## Manual Notes

Notes under this heading are written by humans and preserved on regeneration.
