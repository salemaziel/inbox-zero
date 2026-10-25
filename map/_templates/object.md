---
type: object
status: stub
cluster: mail
universe: live
verified_date: YYYY-MM-DD
git_ref: main
sources:
  - path/to/source.ts:line
---

# {Noun}

> {One sentence: product name and code/file name if they differ.}

## Why this shape
{The load-bearing rationale: why this structure exists, what problem it solves, and what constraints it operates under. Do not write a field tour.}

## Shape
{Key invariant fields, types, and constraints citing source code line numbers.}
- `field1` (`Type`): description ([source](file:///absolute/path#L1))

## Connected to
- **owns**: {Objects owned and lifecycle-bound}
- **owned-by**: {Parent object}
- **joins**: {Relational associations}
- **looks-like-but-is-not**: {Distinction from adjacent or similar concepts}

## If you change this
- **Hits**: {First-order downstream changes: specific routes, schemas, mutations}
- **Does not hit**: {Apparent adjacent targets that are actually decoupled}

## Surfaces
- **Reads**: {Who reads this entity: apps, workers, clients}
- **Writes**: {Who creates/modifies this entity: server actions, webhooks, crons}

## See
- [source.ts](file:///absolute/path/to/source.ts#L1-L50)

