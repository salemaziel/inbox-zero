# ICM System Map — L0 Catalog

Root catalog for navigating the `inbox-zero` repository architecture.

## Where Am I
You are in `map/`. This is the Interpretable Context Methodology (ICM) System Map for `inbox-zero`. The code in `apps/` and `packages/` is the authoritative source of truth; this map cites it to guide changes and prevent context bloat.

## Shelf Routing

| Task / Question | Destination |
|---|---|
| Understand map navigation, universes, and naming | [`CONTEXT.md`](./CONTEXT.md) |
| Find a domain noun, database model, or entity | [`objects/_index.md`](./objects/_index.md) |
| Mail engine, sync, provider integration | [`objects/mail/`](./objects/mail/) |
| Rules, filters, automated actions | [`objects/rules/`](./objects/rules/) |
| Newsletters, cold emails, digests, cleanup | [`objects/triage/`](./objects/triage/) |
| AI assistant, chat threads, knowledge base | [`objects/ai/`](./objects/ai/) |
| System workflows and execution processes | [`processes/CONTEXT.md`](./processes/CONTEXT.md) |
| Change impact: "What moves if I change X?" | [`effects/CONTEXT.md`](./effects/CONTEXT.md) |
| Node schemas and card templates | [`_meta/schema.md`](./_meta/schema.md) & [`_templates/`](./_templates/) |

## Rules
- Load only the single card needed for your task (2k–8k tokens target).
- Never read all cards into context at once.
- Verify claims against source code citations (`file:line`).
