# Change-Impact Index (`map/effects/CONTEXT.md`)

Before modifying a component, schema, or process, consult this catalog to identify first-order impacted cards and decoupled boundaries.

---

## 1. Change Routing Matrix

| Area Being Changed | Open These Cards First | Does NOT Hit (Decoupled) |
|---|---|---|
| **Prisma Schema (`apps/web/prisma/schema.prisma`)** | Target noun card in `map/objects/`, `proc_mutation_action.md` | Pure client components in `packages/mail-ui` |
| **Email Ingest & Sync Logic** | `EmailAccount`, `EmailMessage`, `proc_mail_sync.md` | AI chat context, calendar scheduling |
| **Rule Matching or Actions** | `Rule`, `Action`, `RuleHistory`, `proc_rule_evaluation.md` | OAuth session verification |
| **Email Categorization / Unsubscribe** | `Category`, `Newsletter`, `ColdEmail`, `proc_ai_triage.md` | Mail split folder UI layouts |
| **AI Prompt & Chat Orchestration** | `Chat`, `ChatMessage`, `Knowledge`, `ReplyMemory` | Low-level provider sync adapters |
| **Calendar & Booking Links** | `CalendarConnection`, `BookingLink`, `Booking` | Mail classification models |
| **Server Action Mutations** | Target noun card, `proc_mutation_action.md` | Background worker queue handlers |

---

## 2. Inbound External Pointers (Outside → Repo)

These external callers point directly into repo paths and must be audited before changing contracts:
- **Vercel Cron & Inngest**: Calls `/api/cron/*` endpoints for digests and scheduled tasks.
- **Provider OAuth Redirects**: Google and Microsoft redirect URIs pointing to `/api/auth/callback/*`.
- **Tinybird Ingest Endpoints**: External analytics sinks receiving tracking events.

