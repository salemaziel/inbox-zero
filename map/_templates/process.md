---
type: process
status: stub
universe: live
verified_date: YYYY-MM-DD
git_ref: main
sources:
  - path/to/source.ts:line
---

# {Process Name}

> {One sentence: what triggers this movement and what deliverable or state transition it produces.}

## Contracts
- **Consumes**:
  - `[ObjectCard](file:///absolute/path/to/object.md)`
- **Produces**:
  - `[ObjectCard](file:///absolute/path/to/object.md)`

## Movement Cycle
1. **Trigger**: {Event or invocation, citing source}
2. **Validation**: {Input checks and authorization, citing source}
3. **Execution**: {Core mutation or pipeline steps, citing source}
4. **Settlement**: {State commit, cache invalidation, or background task dispatch}

## If you change this
- **Hits**: {First-order affected callers, UI feedback, or downstream events}
- **Does not hit**: {Decoupled systems that remain unaffected}

## Human Gates & Fallbacks
- **Check points**: {Where a human verifies intermediate state or overrides decisions}
- **Failure modes**: {Retry policies, dead-letter handling, rollback behavior}

## See
- [runner.ts](file:///absolute/path/to/runner.ts#L1-L50)

