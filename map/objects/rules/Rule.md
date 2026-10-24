---
type: object
status: verified
cluster: rules
universe: live
verified_date: 2026-10-23
git_ref: b21b900c7
sources:
  - apps/web/prisma/schema.prisma:693-747
---

# Rule

> User-defined or organization-level automation rule that matches inbound emails using static criteria or AI instructions.

## Why this shape
`Rule` unifies both deterministic filtering (regex/string matching on `from`, `to`, `subject`, `body`) and semantic AI classification (`instructions`). It supports logical combinations (`AND`/`OR`) and can be either user-scoped or materialized from an `OrganizationRule`. By storing both static fields and natural-language prompt text, Inbox Zero evaluates simple rules cheaply in code while delegating nuanced semantic rules to LLMs.

## Shape
- `id` (`String` / `@id @default(cuid())`): Unique identifier ([schema.prisma:694](file:///home/pc/workspace/projects/inbox-zero/apps/web/prisma/schema.prisma#L694))
- `name` (`String`): Descriptive display name ([schema.prisma:697](file:///home/pc/workspace/projects/inbox-zero/apps/web/prisma/schema.prisma#L697))
- `enabled` (`Boolean` / `@default(true)`): Whether the rule is active ([schema.prisma:700](file:///home/pc/workspace/projects/inbox-zero/apps/web/prisma/schema.prisma#L700))
- `runOnThreads` (`Boolean` / `@default(false)`): If true, runs on conversation threads rather than single messages ([schema.prisma:702](file:///home/pc/workspace/projects/inbox-zero/apps/web/prisma/schema.prisma#L702))
- `conditionalOperator` (`LogicalOperator` / `@default(AND)`): How conditions are combined ([schema.prisma:718](file:///home/pc/workspace/projects/inbox-zero/apps/web/prisma/schema.prisma#L718))
- `instructions` (`String?`): Semantic prompt for LLM-based evaluation ([schema.prisma:721](file:///home/pc/workspace/projects/inbox-zero/apps/web/prisma/schema.prisma#L721))
- `from`, `to`, `subject`, `body` (`String?`): Static regex/text matching filters ([schema.prisma:729-732](file:///home/pc/workspace/projects/inbox-zero/apps/web/prisma/schema.prisma#L729-L732))
- `organizationRuleId` (`String?`): Foreign key if cloned from team policy ([schema.prisma:710](file:///home/pc/workspace/projects/inbox-zero/apps/web/prisma/schema.prisma#L710))

## Connected to
- **owns**: `Action` ([schema.prisma:698](file:///home/pc/workspace/projects/inbox-zero/apps/web/prisma/schema.prisma#L698)), `RuleHistory` ([schema.prisma:740](file:///home/pc/workspace/projects/inbox-zero/apps/web/prisma/schema.prisma#L740)), `ExecutedRule`
- **owned-by**: `EmailAccount` ([schema.prisma:705](file:///home/pc/workspace/projects/inbox-zero/apps/web/prisma/schema.prisma#L705))
- **joins**: `Group` (optional sender whitelist/blacklist association) ([schema.prisma:725](file:///home/pc/workspace/projects/inbox-zero/apps/web/prisma/schema.prisma#L725))
- **looks-like-but-is-not**: `AutomationJob` (which is a scheduled recurring cron job, whereas `Rule` triggers on inbound emails).

## If you change this
- **Hits**:
  - Rule evaluation engine in `apps/web/utils/rules/`
  - Rule creation and editing forms in `apps/web/app/(app)/rules/`
  - `EmailAccount.rulesRevision` counter (must bump on update to bust cache)
- **Does not hit**:
  - Unsubscribe background worker
  - User authentication / session tokens

## Surfaces
- **Reads**: Incoming webhook handlers, mail sync batch evaluator
- **Writes**: Rules settings UI forms via `next-safe-action`

## See
- [schema.prisma](file:///home/pc/workspace/projects/inbox-zero/apps/web/prisma/schema.prisma#L693-L747)

