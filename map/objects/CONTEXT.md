# Objects Shelf Contract (`map/objects/`)

This directory houses the **Record Library of Nouns** for `inbox-zero`. Each card details a persistent domain entity, its structural rationale, its invariants, and first-order change boundaries.

## Rules for Walking Objects
1. Check `_index.md` first to identify the cluster and verification status (`verified`, `stub`, `stale`).
2. Open only the card relevant to the task. Avoid reading entire clusters into context.
3. Every card must cite exact lines in the source code (`apps/web/prisma/schema.prisma` or owning packages). The code is always the source of truth if documentation differs.
4. When editing a noun, inspect its **"If you change this"** section before touching code.

