# app/(app)/[emailAccountId]/compose

**Parent context:** `../AGENTS.md`
**Generated:** 2026-10-23 · **Updated:** 2026-10-23

## Purpose

The email composer used for new messages, replies, and forwards. This folder has no `page.tsx`; its components are rendered by the mail client and other screens. It handles recipients, rich-text body, attachments, provider draft autosave, send warnings, scheduled delivery, and undo send.

## Key Files

| File | Description |
| --- | --- |
| `ComposeEmailForm.tsx` | The form. Exports `ComposeFormValues` and `ReplyingToEmail`, used by the hooks below. |
| `ComposeEmailFormLazy.tsx` | Dynamic-import wrapper that keeps the editor out of the main bundle; registers an open composer with `registerOpenComposer` (`@/utils/safe-reload`) so a deploy reload does not discard it. |
| `useComposeDraft.ts` | Provider draft save, discard, and autosave (`useProviderDraftAutosave`, `useReplyDraftPersistence` from `@/hooks`). |
| `useComposeSend.ts` | Send and schedule flow. Builds the payload, prepares inline images, validates size, calls the mail engine client or `scheduleEmailAction`. |
| `useComposeDraftAttachments.ts`, `useComposeAttachments.ts`, `upload-draft-attachment.ts`, `compose-attachments.ts` | Attachment upload and references. |
| `draft-operation-queue.ts` | `enqueueDraftOperation(key, fn)`: serializes draft changes per compose session. Gmail replaces the whole draft on every change, so overlapping saves would drop attachments. |
| `undo-send.ts` | 10 second undo window (`UNDO_SEND_DELAY_MS`), observes the engine operation status and restores the composer on undo. Only offered when online (`getUndoSendHoldUntil`). |
| `send-warnings.ts`, `SendWarningsDialog.tsx` | Warnings (not blocks) for a missing attachment and unfilled `[placeholder]` text. The attachment word list is multilingual; extend it by adding words. |
| `delivery-times.ts`, `DeliveryOptions.tsx` | Scheduled-send options. |
| `compose-recipients.ts`, `ComposeContactRecipientField.tsx`, `contact-suggestions.ts` | Recipient parsing and suggestions. |
| `reply-to-email-payload.ts`, `queued-reply.ts`, `send-draft-reference.ts`, `follow-provider-draft-message.ts` | Reply payloads and keeping the UI pointed at the right provider draft message. |
| `initial-compose-content.ts`, `compose-message-html.ts`, `resolve-remote-images.ts` | Initial body and outgoing HTML. |

## Subdirectories

None. Files are flat; each logic module `foo.ts` has `foo.test.ts` beside it, and hooks are `useCompose*`.

## For AI Agents

### Working In This Directory

- All draft mutations for one session must go through `enqueueDraftOperation` with the session key. Writing to the provider draft outside the queue can lose attachments.
- Sending uses the mail engine (`MailClient` from `@inboxzero/mail-core/engine`) so it can queue offline and be undone. Do not add a parallel direct-to-provider send path; the server send route is `app/api/messages/send`.
- The size check `validateSendEmailPayloadSize` (`@/utils/types/mail`) must run before submitting a payload.
- Undo send state is a module singleton (`pending` in `undo-send.ts`); only one offer exists at a time, and a new send releases the previous one.
- Keep warnings in `send-warnings.ts` as warnings; do not turn them into hard blocks.
- User-facing strings go through toasts in `@/components/Toast`.

### Testing Requirements

- Many tests, all colocated: logic as `*.test.ts`, DOM ones as `*.test.tsx` or `*.dom.test.ts` (for example `send-warnings.dom.test.ts`).
- From repo root: `pnpm test "apps/web/app/(app)/[emailAccountId]/compose"`.
- Browser coverage includes `__tests__/playwright/emulated/mail/compose-attachment-send.spec.ts`; run `pnpm -F inbox-zero-ai test:playwright:emulated mail` after UI changes.

### Common Patterns

- Pure logic module plus a thin hook that wires it to React state and the engine.
- `react-hook-form` for form values; the editor is a ref handle (`EmailEditorHandle` from `@inboxzero/email-editor/web`).

## Dependencies

### Internal

- `@/utils/mail-engine/reply-drafts`, `@/utils/email/outgoing-inline-images`, `@/utils/actions/scheduled-email`, `@/hooks/useProviderDraftAutosave`, `@/hooks/useReplyDraftPersistence`, `@/hooks/useHiddenDraftMessageIds`, `@/components/email-list/ThreadDeliveryStatus`, `@/lib/shortcuts/registry`.

### External

- `@inboxzero/email-editor`, `@inboxzero/mail-core`, `react-hook-form`, `swr`, `sonner`.

## Manual Notes

Notes under this heading are written by humans and preserved on regeneration.
