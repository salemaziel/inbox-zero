# System Map Context (`map/CONTEXT.md`)

This map provides an agent-navigable representation of the `inbox-zero` repository. It documents the core domain nouns, system movements, and change-impact boundaries without duplicating or replacing the source code.

---

## 1. How to Walk This Map

A visiting agent or engineer walks the map using a three-tier catalog:

1. **Root Orientation**: Read `map/CLAUDE.md` (or its byte-identical twins `map/AGENTS.md` and `map/routing.md`). It answers *"Where am I?"* and *"Where do I go for task X?"* in under 60 lines.
2. **Shelf Index**: If exploring a domain noun, consult `map/objects/_index.md`. If exploring a change or impact, consult `map/effects/CONTEXT.md`. If exploring an end-to-end flow, consult `map/processes/CONTEXT.md`.
3. **Card Consultation**: Open strictly the individual card needed. Never slurp the entire directory. A healthy lookup loads **2,000 to 8,000 tokens** total (L0 catalog + L1 shelf contract + 1 card).

---

## 2. The Three Universes

Every artifact and node is categorized into one of three universes:

| Universe | Definition | Implementation Rule |
|---|---|---|
| **`live`** | Currently in force in production code. | Build and cite against these. Maintain backward compatibility where needed. |
| **`leftover`** | Legacy code, transition shims, or deprecated pathways still present in the tree. | Touch only when explicitly scoping migration or decommissioning. |
| **`ghost`** | Unwired types, aspirational features, dead drafts, or stubs. | Never implement against or assume active runtime wiring. |

---

## 3. Name Translation & Disambiguation

Product terminology and internal code names sometimes diverge:

| Product Concept | Code / File Identifier | Notes |
|---|---|---|
| **Inbox Split** | `MailSplit`, `MailSplitFilter` | Custom grouped inbox tabs/views |
| **Automations / Workflows** | `Rule`, `Action`, `AutomationJob` | User-defined filtering vs system scheduled jobs |
| **AI Assistant** | `Chat`, `ChatMessage`, `Knowledge` | AI thread orchestration in `apps/web/lib/` and `app/api/` |
| **Email Accounts** | `EmailAccount`, `EmailProvider` | Multi-provider mailbox connections (Google, Microsoft) |
| **Cleanup / Triage** | `CleanupJob`, `Newsletter`, `ColdEmail` | Background unsubscribe, bulk archival, and sender analysis |
| **Scheduled Sends** | `ScheduledEmail`, `EmailSendOperation` | Delayed outbound dispatch handled by workers |

