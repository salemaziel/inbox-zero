---
type: object
status: verified
cluster: mail
universe: live
verified_date: 2026-10-23
git_ref: b21b900c7
sources:
  - apps/web/utils/email/types.ts:176-250
---

# EmailProvider

> Core interface abstraction providing a unified API over diverse email services (Google Workspace, Microsoft 365, generic IMAP).

## Why this shape
Directly coupling business logic to Gmail or Microsoft Graph APIs introduces leaking provider quirks throughout the codebase. `EmailProvider` acts as the uniform contract across all email mutations (archiving, drafting, sending, label manipulation, watch subscriptions, and message counting). Calling code programs against `EmailProvider` rather than branching on provider types.

## Shape
- `archiveMessage(messageId: string): Promise<void>` ([types.ts:181](file:///home/pc/workspace/projects/inbox-zero/apps/web/utils/email/types.ts#L181))
- `archiveThread(threadId: string, ownerEmail: string): Promise<void>` ([types.ts:183](file:///home/pc/workspace/projects/inbox-zero/apps/web/utils/email/types.ts#L183))
- `createDraft(params: { to: string, subject: string, messageHtml: string, ... }): Promise<{ id: string }>` ([types.ts:224-234](file:///home/pc/workspace/projects/inbox-zero/apps/web/utils/email/types.ts#L224-L234))
- `bulkArchiveFromSenders(fromEmails: string[], ...): Promise<void>` ([types.ts:190-194](file:///home/pc/workspace/projects/inbox-zero/apps/web/utils/email/types.ts#L190-L194))
- `countMessages(options: { folderId?: string, labelId?: string }): Promise<number>` ([types.ts:211-214](file:///home/pc/workspace/projects/inbox-zero/apps/web/utils/email/types.ts#L211-L214))

## Connected to
- **owns**: None (interface abstraction)
- **owned-by**: Mail engine layer (`apps/web/utils/email/`)
- **joins**: Implemented by `GoogleProvider` and `MicrosoftProvider`
- **looks-like-but-is-not**: `Account` (which holds raw OAuth tokens, not operational email client methods).

## If you change this
- **Hits**:
  - `GoogleProvider` implementation (`apps/web/utils/email/google/`)
  - `MicrosoftProvider` implementation (`apps/web/utils/email/microsoft/`)
  - Email action runners (`apps/web/utils/actions/`)
- **Does not hit**:
  - Database schema (`schema.prisma`)
  - Pure React UI components

## Surfaces
- **Reads**: Server action handlers, rule execution engines, cleanup workers
- **Writes**: Instantiated per request via `getEmailProvider({ emailAccountId })`

## See
- [types.ts](file:///home/pc/workspace/projects/inbox-zero/apps/web/utils/email/types.ts#L176-L250)

