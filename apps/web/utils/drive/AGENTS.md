# utils/drive

**Parent context:** `../AGENTS.md`
**Generated:** 2026-10-23 · **Updated:** 2026-10-23

## Purpose

Cloud drive integration (Google Drive and OneDrive) and the attachment-filing pipeline built on it. Covers: OAuth connect and token refresh, a `DriveProvider` abstraction over both services, and the engine that downloads an email attachment, extracts text, asks the AI where it belongs, uploads it, and records a `DocumentFiling` row. Also handles the notification and reply loop when the AI is unsure and asks the user.

## Key Files

| File | Description |
| --- | --- |
| `types.ts` | `DriveProvider` interface, `DriveFolder`, `DriveFile`, `UploadFileParams`, `DriveProviderType` |
| `provider.ts` | `createDriveProviderWithRefresh`: picks Google or OneDrive from a `DriveConnection`, refreshes an expired token, and persists the new one |
| `client.ts` | OAuth URL builders and code exchange for both providers (`getGoogleDriveOAuth2Url`, `exchangeGoogleDriveCode`, `getMicrosoftDriveOAuth2Url`, `exchangeMicrosoftDriveCode`) |
| `scopes.ts` | Google and Microsoft scope lists, deliberately minimal |
| `constants.ts` | `DRIVE_STATE_COOKIE_NAME` for the OAuth state cookie |
| `handle-drive-callback.ts` | Shared OAuth callback handler for both providers: state validation, duplicate-code cache and lock, token exchange, connection upsert, redirect |
| `filing-engine.ts` | `processAttachment`: the end-to-end filing pipeline for one attachment, plus `getFilableAttachments` |
| `process-filing-attachments.ts` | Loops `processAttachment` over a message's attachments and sends one batched notification |
| `document-extraction.ts` | Text extraction from PDF, .docx, and plain text (`extractTextFromDocument`, `isExtractableMimeType`); also `canUseNativePdfSupport` |
| `folder-utils.ts` | `createFolderPath` (nested folder creation) and `createAndSaveFilingFolder` |
| `handle-filing-reply.ts` | `processFilingReply`: interprets a user's emailed reply to a filing question and re-files or creates folders |
| `filing-notifications.ts` | Email notifications: filed, asking, and correction confirmation |
| `filing-messaging-notifications.ts` | Same notifications sent through a connected messaging channel (currently only the Slack case is handled) |
| `source-items.ts` | `buildDriveSourceItems`: shapes folders and files for the attachment-source picker UI |
| `url.ts` | `getDriveFileUrl`: browser URL for a filed document |

## Subdirectories

| Directory | Description |
| --- | --- |
| `providers/` | `google.ts` (`GoogleDriveProvider`) and `microsoft.ts` (`OneDriveProvider`) implementing `DriveProvider` |

## For AI Agents

### Working In This Directory

- Go through `DriveProvider` (from `provider.ts`) everywhere outside `providers/`. Do not call Google or Graph clients directly from filing code; the provider-type checks (`isGoogleProvider`, `isMicrosoftProvider`) belong only in `provider.ts` and OAuth code.
- Always obtain a provider with `createDriveProviderWithRefresh`. The inner `createDriveProvider` is not exported on purpose; skipping it means expired tokens are never refreshed.
- The interface has no delete method by design (see the comment in `types.ts`): "undo" marks the `DocumentFiling` as rejected and leaves the file in the user's drive. Do not add deletion without a scope discussion.
- Scopes are intentionally narrow (`drive.file` for Google, `Files.ReadWrite` rather than `.All` for Microsoft). Widening scopes forces existing users to reconnect.
- `DriveConnection.accessToken` and `refreshToken` are encrypted transparently by the Prisma extension in `utils/prisma-extensions.ts`; read and write them through `@/utils/prisma`.
- `processAttachment` exits early unless the account has `filingEnabled` and a `filingPrompt`. It also guards against duplicate filings (`DUPLICATE_FILING_FIELDS`) and treats a `PROCESSING` filing older than 30 minutes as stale.
- OAuth callbacks are idempotent: a Redis result cache and lock keyed on the code stop double-submits from creating two connections. Keep the cached-result and lock branches when changing `handle-drive-callback.ts`.
- Callback routes live in `app/api/google/drive/` and `app/api/outlook/drive/`; the folder and preview routes live in `app/api/user/drive/`. Server actions are in `utils/actions/drive.ts`.
- The AI analysis step itself is in `utils/ai/document-filing/`, not here.

### Testing Requirements

- Colocated tests: `filing-engine.test.ts`, `handle-filing-reply.test.ts`, `process-filing-attachments.test.ts`, `filing-notifications.test.ts`, `filing-messaging-notifications.test.ts`, `document-extraction.test.ts`, `folder-utils.test.ts`, `source-items.test.ts`, `url.test.ts`, `client.test.ts`, `providers/microsoft.test.ts`.
- Run from repo root: `pnpm test apps/web/utils/drive`

### Common Patterns

- Pipeline functions take `emailAccount`, `emailProvider`, `message`, and a `logger` and report failures through a result object (`FilingResult`) rather than throwing, so one bad attachment does not stop the rest.
- Per-attachment failures in loops are caught and logged, then the loop continues.

## Dependencies

### Internal

- `@/utils/email` (`EmailProvider`, provider-type helpers), `@/utils/gmail/oauth` and `@/utils/outlook/oauth` (OAuth config and token requests), `@/utils/ai/document-filing/`, `@/utils/messaging/`, `@/utils/redis/`, `@/utils/prisma`, `@/utils/logger`, `@/utils/error` (`SafeError`).
- Consumers: `utils/webhook/process-history-item.ts`, `utils/actions/drive.ts`, `utils/ai/assistant/chat-inbox-tools.ts`, `app/api/*/drive/`, and the drive and assistant UI.

### External

- `@googleapis/drive`, Microsoft Graph over HTTP, and `unpdf` and `mammoth` (dynamically imported in `document-extraction.ts`).

## Manual Notes

Notes under this heading are written by humans and preserved on regeneration.
