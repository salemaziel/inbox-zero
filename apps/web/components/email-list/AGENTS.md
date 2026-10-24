# components/email-list

**Parent context:** `../AGENTS.md`
**Generated:** 2026-10-23 · **Updated:** 2026-10-23

## Purpose

Rendering of an opened conversation in the mail reader: the thread, each message with its header, body, attachments, calendar invitation, and delivery status, plus inline reply/forward composing. Used by `app/(app)/[emailAccountId]/mail/` (`ThreadReader`, `MailShell`, `MailReaderPane`) and the assistant page.

## Key Files

| File | Description |
| --- | --- |
| `EmailThread.tsx` | Thread container: orders and collapses messages (`organizeThreadMessages`), reply drafts, keyboard shortcuts, send-command handling |
| `EmailMessage.tsx` | One message: header, expand/collapse, reply/forward composer (`ComposeEmailFormLazy`), draft deletion, calendar invitation |
| `EmailContents.tsx` | `HtmlEmail` (sanitizes via `sanitizeEmailHtml`, resolves inline images, renders in `BufferedMailHtmlFrame` from `@inboxzero/mail-ui/MailBody`) and `PlainEmail` (linkified text) |
| `EmailDetails.tsx`, `EmailDate.tsx` | Header details and date formatting |
| `EmailAttachments.tsx`, `OpenedConversationAttachments.tsx` | Attachment list and previews (previews use an iframe) |
| `CalendarInvitation.tsx` | Invite card; detection lives in `utils/calendar/invitations/` |
| `ThreadDeliveryStatus.tsx`, `SentMessageOpenStatus.tsx` | Send and open status indicators |
| `latest-scheduled-send.ts` | `getLatestScheduledSendId` picks the most recent scheduled-send row |
| `types.ts` | `Thread`, `ThreadMessage`, `Executing`, derived from `ThreadsResponse` in `app/api/threads/route` |

## Subdirectories

None.

## For AI Agents

### Working In This Directory

- Email HTML is untrusted. Always go through `sanitizeEmailHtml` / `prepareSanitizedEmailHtml` (`@/utils/email/prepare-html.client`) and the framed renderer; never use `dangerouslySetInnerHTML` with message HTML. The sanitizer is `dompurify`, pinned to an exact patched version; do not loosen or swap it.
- Inline images and external images go through the image proxy constants in `prepare-html.client`; keep inline-image content-id handling (`@inboxzero/mail-ui/inline-images`) intact when touching `HtmlEmail`.
- `HtmlEmail` is performance sensitive: it memoizes sanitization and uses a render cache keyed by account, message, and send operation id. Message objects are rebuilt on every republish, so key on stable ids, not object identity.
- Account context comes from `useAccount()` (`@/providers/EmailAccountProvider`). Mutations use server actions via `useAction` (for example `deleteDraftAction`), not API routes.
- Reply drafts are tracked in `@/utils/mail-engine/reply-drafts` and `useHiddenDraftMessageIds`; a draft being sent must be hidden from the thread until the send settles. Check `EmailThread.test.tsx` before changing ordering or draft visibility.
- Keyboard handling uses `react-hotkeys-hook` and `isTypingTarget` from `@/lib/shortcuts/registry`; do not fire shortcuts while the user types in an editor.
- Provider-specific logic (Gmail labels, forwarding helpers) is imported from `utils/gmail/*` in places; do not add new provider checks here, prefer the `EmailProvider` abstraction.
- Renaming a button label or tooltip breaks Playwright specs in `../../__tests__/playwright/emulated/mail/`; grep there first.

### Testing Requirements

Colocated: `EmailThread.test.tsx`, `EmailMessage.test.tsx`, `EmailContents.test.tsx`, `ThreadDeliveryStatus.test.tsx`, `latest-scheduled-send.test.ts`. TSX tests use `// @vitest-environment jsdom` and a stub `ResizeObserver`.

```bash
pnpm test apps/web/components/email-list
pnpm test apps/web/components/email-list/EmailThread.test.tsx
pnpm -F inbox-zero-ai test:playwright:emulated mail     # reader behavior in a browser
```

Specs relevant here include `message-actions`, `reader-visuals`, `thread-states`, `attachment-previews`, `compose-and-reply`, and `draft-deletion` under `../../__tests__/playwright/emulated/mail/`.

### Common Patterns

- Pure helpers (`organizeThreadMessages`, `getLatestScheduledSendId`) are exported and unit-tested separately from the JSX.

## Dependencies

### Internal

- `@/providers/EmailAccountProvider`, `@/providers/ComposeModalProvider`, `@/hooks/useReplyDrafts`, `@/hooks/useHiddenDraftMessageIds`, `@/utils/email/*`, `@/utils/mail-engine/reply-drafts`, `@/utils/actions/mail`, `app/(app)/[emailAccountId]/compose/*`.

### External

- `@inboxzero/mail-ui` (inline images, linkify, framed HTML), `react-hotkeys-hook`, `next-safe-action`, `lucide-react`.

## Manual Notes

Notes under this heading are written by humans and preserved on regeneration.
