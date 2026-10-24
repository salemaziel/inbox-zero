---
type: object
status: verified
cluster: mail
universe: live
verified_date: 2026-10-23
git_ref: b21b900c7
sources:
  - apps/web/prisma/schema.prisma:152-270
---

# EmailAccount

> The primary mailbox connection and tenancy context representing a linked email provider account (Google, Microsoft) and its configuration state.

## Why this shape
`EmailAccount` acts as the multi-tenant partition root for almost all operational data in Inbox Zero. Rather than binding rules, messages, categories, and automations directly to a `User`, they attach to an `EmailAccount`. This allows a single `User` to connect multiple business and personal mailboxes with completely isolated sync history, rules, categorization models, and provider credentials.

## Shape
- `id` (`String` / `@id @default(cuid())`): Unique identifier ([schema.prisma:153](file:///home/pc/workspace/projects/inbox-zero/apps/web/prisma/schema.prisma#L153))
- `email` (`String` / `@unique`): Primary mailbox address ([schema.prisma:154](file:///home/pc/workspace/projects/inbox-zero/apps/web/prisma/schema.prisma#L154))
- `userId` (`String`): Foreign key to the owning `User` with `onDelete: Cascade` ([schema.prisma:219-220](file:///home/pc/workspace/projects/inbox-zero/apps/web/prisma/schema.prisma#L219-L220))
- `accountId` (`String` / `@unique`): Foreign key to the underlying OAuth credential `Account` ([schema.prisma:221-222](file:///home/pc/workspace/projects/inbox-zero/apps/web/prisma/schema.prisma#L221-L222))
- `watchEmailsSubscriptionId` (`String?`): Outlook subscription webhook identifier ([schema.prisma:168](file:///home/pc/workspace/projects/inbox-zero/apps/web/prisma/schema.prisma#L168))
- `lastSyncedHistoryId` (`String?`): Gmail delta sync tracking checkpoint ([schema.prisma:170](file:///home/pc/workspace/projects/inbox-zero/apps/web/prisma/schema.prisma#L170))
- `rulesRevision` (`Int` / `@default(0)`): Version counter for invalidating client rule evaluation caches ([schema.prisma:192](file:///home/pc/workspace/projects/inbox-zero/apps/web/prisma/schema.prisma#L192))

## Connected to
- **owns**: `EmailMessage`, `Rule`, `Action`, `Label`, `Category`, `Newsletter`, `Chat`, `Digest`, `ThreadTracker`, `CleanupJob`
- **owned-by**: `User` ([schema.prisma:220](file:///home/pc/workspace/projects/inbox-zero/apps/web/prisma/schema.prisma#L220))
- **joins**: `Account` (OAuth credentials table) ([schema.prisma:222](file:///home/pc/workspace/projects/inbox-zero/apps/web/prisma/schema.prisma#L222))
- **looks-like-but-is-not**: `Account` (OAuth token credentials from BetterAuth / NextAuth) or `User` (the human login identity).

## If you change this
- **Hits**:
  - `withEmailAccount` middleware (`apps/web/utils/auth.ts`)
  - Sync runners (`apps/worker/` and `apps/web/utils/sync/`)
  - Account switching UI context (`apps/web/providers/`)
- **Does not hit**:
  - Pure message formatting components in `packages/mail-ui`
  - User billing subscriptions in `Payment`

## Surfaces
- **Reads**: Web client app router, background workers, SWR hooks via `useEmailAccount`
- **Writes**: OAuth callback setup handlers, user mailbox settings mutations (`updateEmailAccount`)

## See
- [schema.prisma](file:///home/pc/workspace/projects/inbox-zero/apps/web/prisma/schema.prisma#L152-L270)

