# Processes Shelf Contract (`map/processes/CONTEXT.md`)

This directory documents the verified movements (verbs) in `inbox-zero`.

## Process Catalog

| Process | Movement Type | Consumes | Produces | Status |
|---|---|---|---|---|
| [`proc_auth_oauth_connect`](./proc_auth_oauth_connect.md) | Auth / Session | `User`, `Account` | `Session`, `EmailAccount` | stub |
| [`proc_mail_sync`](./proc_mail_sync.md) | Sync / Ingest | `EmailAccount` | `EmailMessage`, `ThreadTracker` | stub |
| [`proc_rule_evaluation`](./proc_rule_evaluation.md) | Automation | `EmailMessage`, `Rule` | `Action`, `RuleHistory` | stub |
| [`proc_ai_triage`](./proc_ai_triage.md) | Intelligence | `EmailMessage` | `Category`, `Newsletter`, `ColdEmail` | stub |
| [`proc_mutation_action`](./proc_mutation_action.md) | Client Mutation | User input | Prisma writes, SWR mutate | stub |
| [`proc_worker_dispatch`](./proc_worker_dispatch.md) | Background Jobs | `AutomationJob`, queues | `Digest`, cleanup results | stub |

## Navigation Rules
- Each process card specifies an explicit Input → Movement → Output flow.
- Look up a process here when diagnosing an end-to-end failure or refactoring execution paths.

