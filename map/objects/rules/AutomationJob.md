---
type: object
status: verified
cluster: rules
universe: live
verified_date: 2026-10-23
git_ref: b21b900c7
sources:
  - apps/web/prisma/schema.prisma:1837-1863
---

# AutomationJob

> A scheduled, recurring automation task defined by a cron expression and a natural language instruction prompt.

## Why this shape
While `Rule` responds reactively to inbound email webhooks, `AutomationJob` executes proactively on a defined schedule (e.g. daily standup summaries, weekly report generation, periodic cleanup). It combines a UTC cron expression with a prompt and an outbound messaging channel, enabling autonomous scheduled agent workflows.

## Shape
- `id` (`String` / `@id @default(cuid())`): Unique identifier ([schema.prisma:1838](file:///home/pc/workspace/projects/inbox-zero/apps/web/prisma/schema.prisma#L1838))
- `name` (`String`): Descriptive job label ([schema.prisma:1842](file:///home/pc/workspace/projects/inbox-zero/apps/web/prisma/schema.prisma#L1842))
- `enabled` (`Boolean` / `@default(true)`): Active flag ([schema.prisma:1843](file:///home/pc/workspace/projects/inbox-zero/apps/web/prisma/schema.prisma#L1843))
- `prompt` (`String?` / `@db.Text`): Natural language instructions for the job runner ([schema.prisma:1844](file:///home/pc/workspace/projects/inbox-zero/apps/web/prisma/schema.prisma#L1844))
- `cronExpression` (`String`): Standard UTC cron expression ([schema.prisma:1845](file:///home/pc/workspace/projects/inbox-zero/apps/web/prisma/schema.prisma#L1845))
- `nextRunAt` (`DateTime`): Indexed next execution timestamp ([schema.prisma:1847](file:///home/pc/workspace/projects/inbox-zero/apps/web/prisma/schema.prisma#L1847))
- `messagingChannelId` (`String`): Delivery target for generated reports ([schema.prisma:1849](file:///home/pc/workspace/projects/inbox-zero/apps/web/prisma/schema.prisma#L1849))
- `emailAccountId` (`String` / `@unique`): Account partition root (currently limited to 1 job per account) ([schema.prisma:1858](file:///home/pc/workspace/projects/inbox-zero/apps/web/prisma/schema.prisma#L1858))

## Connected to
- **owns**: `AutomationJobRun` ([schema.prisma:1854](file:///home/pc/workspace/projects/inbox-zero/apps/web/prisma/schema.prisma#L1854))
- **owned-by**: `EmailAccount`
- **joins**: `MessagingChannel` (Slack/Teams/Discord destination) ([schema.prisma:1850](file:///home/pc/workspace/projects/inbox-zero/apps/web/prisma/schema.prisma#L1850))
- **looks-like-but-is-not**: `Rule` (which triggers on incoming email events, not cron schedules).

## If you change this
- **Hits**:
  - Background cron scheduler (`apps/worker/` or `/api/cron/`)
  - Automation UI in `apps/web/app/(app)/automations/`
  - Job execution runner
- **Does not hit**:
  - Inbound email webhook receivers
  - UI theme providers

## Surfaces
- **Reads**: Background worker polling `nextRunAt <= now()`
- **Writes**: User automation configuration forms

## See
- [schema.prisma](file:///home/pc/workspace/projects/inbox-zero/apps/web/prisma/schema.prisma#L1837-L1863)

