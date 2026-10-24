---
type: object
status: verified
cluster: rules
universe: live
verified_date: 2026-10-23
git_ref: b21b900c7
sources:
  - apps/web/prisma/schema.prisma:748-785
---

# Action

> The executable operation triggered when an inbound email matches an automated `Rule`.

## Why this shape
`Action` encodes diverse side-effects—ranging from simple email operations (archive, label, mark read, trash) to external integrations (forwarding, webhook calls, Slack/Teams notifications, MCP tool calls). It decouples the matching logic in `Rule` from the execution details, allowing a single rule to perform multiple atomic actions with optional delay timers (`delayInMinutes`).

## Shape
- `id` (`String` / `@id @default(cuid())`): Unique identifier ([schema.prisma:749](file:///home/pc/workspace/projects/inbox-zero/apps/web/prisma/schema.prisma#L749))
- `type` (`ActionType`): Enum specifying operation (ARCHIVE, LABEL, FORWARD, WEBHOOK, MCP, etc.) ([schema.prisma:752](file:///home/pc/workspace/projects/inbox-zero/apps/web/prisma/schema.prisma#L752))
- `ruleId` (`String`): Foreign key to the parent rule ([schema.prisma:753](file:///home/pc/workspace/projects/inbox-zero/apps/web/prisma/schema.prisma#L753))
- `labelId` (`String?`): Stable label/category ID for provider-agnostic tagging ([schema.prisma:764](file:///home/pc/workspace/projects/inbox-zero/apps/web/prisma/schema.prisma#L764))
- `delayInMinutes` (`Int?`): Optional delay before execution via `ScheduledAction` queue ([schema.prisma:772](file:///home/pc/workspace/projects/inbox-zero/apps/web/prisma/schema.prisma#L772))
- `integrationToolName`, `integrationArgs` (`String?`, `Json?`): Parameters for external MCP tool invocations ([schema.prisma:775-776](file:///home/pc/workspace/projects/inbox-zero/apps/web/prisma/schema.prisma#L775-L776))

## Connected to
- **owns**: None (executed instances recorded in `ExecutedAction`)
- **owned-by**: `Rule` ([schema.prisma:755](file:///home/pc/workspace/projects/inbox-zero/apps/web/prisma/schema.prisma#L755)) and `EmailAccount` ([schema.prisma:756](file:///home/pc/workspace/projects/inbox-zero/apps/web/prisma/schema.prisma#L756))
- **joins**: `MessagingChannel` (optional notification target) ([schema.prisma:761](file:///home/pc/workspace/projects/inbox-zero/apps/web/prisma/schema.prisma#L761))
- **looks-like-but-is-not**: `ExecutedAction` (which is the immutable historical run log of an executed action).

## If you change this
- **Hits**:
  - Action executor in `apps/web/utils/rules/execute-action.ts`
  - Action builder UI in `apps/web/components/rules/`
  - Validation schemas in `apps/web/utils/actions/*.validation.ts`
- **Does not hit**:
  - Email sync fetchers
  - Calendar availability queries

## Surfaces
- **Reads**: Rule evaluation engine upon successful match
- **Writes**: Rule authoring UI

## See
- [schema.prisma](file:///home/pc/workspace/projects/inbox-zero/apps/web/prisma/schema.prisma#L748-L785)

