---
type: object
status: verified
cluster: mail
universe: live
verified_date: 2026-10-23
git_ref: b21b900c7
sources:
  - apps/web/prisma/schema.prisma:1176-1201
---

# EmailMessage

> The normalized persisted record of an individual email message synced from an upstream provider.

## Why this shape
Inbox Zero interacts with heterogeneous email APIs (Gmail, Microsoft Graph) that structure messages and thread relationships differently. `EmailMessage` stores a minimal, indexed subset of metadata (dates, sender names, domains, read/sent/draft flags, and unsubscribe links) in Prisma to enable ultra-fast client filtering, search, and categorization without querying slow provider APIs repeatedly.

## Shape
- `id` (`String` / `@id @default(cuid())`): Internal unique identifier ([schema.prisma:1177](file:///home/pc/workspace/projects/inbox-zero/apps/web/prisma/schema.prisma#L1177))
- `threadId` (`String`): Provider conversation thread identifier ([schema.prisma:1180](file:///home/pc/workspace/projects/inbox-zero/apps/web/prisma/schema.prisma#L1180))
- `messageId` (`String`): Provider-specific message ID ([schema.prisma:1181](file:///home/pc/workspace/projects/inbox-zero/apps/web/prisma/schema.prisma#L1181))
- `fromDomain` (`String`): Extracted sender domain for high-speed newsletter and bulk filtering ([schema.prisma:1185](file:///home/pc/workspace/projects/inbox-zero/apps/web/prisma/schema.prisma#L1185))
- `unsubscribeLink` (`String?`): Parsed RFC-8058 or body unsubscribe link ([schema.prisma:1187](file:///home/pc/workspace/projects/inbox-zero/apps/web/prisma/schema.prisma#L1187))
- `emailAccountId` (`String`): Owning mailbox reference ([schema.prisma:1193](file:///home/pc/workspace/projects/inbox-zero/apps/web/prisma/schema.prisma#L1193))
- **Constraints**: Compound unique key on `[emailAccountId, threadId, messageId]` ([schema.prisma:1196](file:///home/pc/workspace/projects/inbox-zero/apps/web/prisma/schema.prisma#L1196))

## Connected to
- **owns**: None directly (leaf message record)
- **owned-by**: `EmailAccount` ([schema.prisma:1194](file:///home/pc/workspace/projects/inbox-zero/apps/web/prisma/schema.prisma#L1194))
- **joins**: `ThreadTracker` (via shared `[emailAccountId, threadId]`)
- **looks-like-but-is-not**: `Email` from `packages/mail-core` (the ephemeral in-memory parsed MIME email including full body/attachments).

## If you change this
- **Hits**:
  - Sync pipeline in `apps/worker/` and `apps/web/utils/sync/`
  - Unsubscribe worker in `apps/unsubscribe-worker/`
  - Message query indexes in PostgreSQL/Prisma
- **Does not hit**:
  - User session tokens
  - AI chat memory records

## Surfaces
- **Reads**: Inbox thread list views, newsletter detection jobs, cleanup queries
- **Writes**: Mail sync ingest runners

## See
- [schema.prisma](file:///home/pc/workspace/projects/inbox-zero/apps/web/prisma/schema.prisma#L1176-L1201)

