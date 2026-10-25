# ICM System Map Node Schema

This document defines the strict, closed schema for node files within the `map/` directory. Every card in `map/` must follow either the **Object** schema or the **Process** schema.

---

## 1. Object Card Schema (`map/objects/<cluster>/<noun>.md`)

An object card documents a durable domain noun (type, table, core abstraction, or file group).

### Frontmatter

```yaml
---
type: object
status: stub | verified | stale
cluster: mail | rules | triage | ai | calendar | auth
universe: live | leftover | ghost
verified_date: YYYY-MM-DD
git_ref: main # or specific commit/branch
sources:
  - path/to/file.ts:line
---
```

### Required Sections

1. **Title & One-Sentence Summary**: Name of the noun. Product name vs code/file name if they differ.
2. **Why this shape**: Load-bearing architectural rationale (why it exists, constraints it satisfies), not an exhaustive field listing.
3. **Shape**: Core keys, invariant types, and constraints citing source code (`file:line`).
4. **Connected to**:
   - `owns`: Objects directly owned or cascaded by this noun.
   - `owned-by`: Parent object or owning domain.
   - `joins`: Many-to-many or relational junction points.
   - `looks-like-but-is-not`: Explicit distinction from similar or easily confused entities.
5. **If you change this**:
   - `Hits`: First-order impacts (direct callers, schemas, UI forms).
   - `Does not hit`: Near-miss nouns or decoupled downstream systems that do *not* require changes.
6. **Surfaces**: Who reads and writes this object (UI web app, background worker, external webhook, agent, end user).
7. **See**: Direct links to owning source files (`[filename](file:///...)`).

---

## 2. Process Card Schema (`map/processes/<process>.md`)

A process card documents an active, verified movement/verb in the system.

### Frontmatter

```yaml
---
type: process
status: stub | verified | stale
universe: live | leftover | ghost
verified_date: YYYY-MM-DD
git_ref: main
sources:
  - path/to/runner.ts:line
---
```

### Required Sections

1. **Title & One-Sentence Summary**: The movement verb and its system purpose.
2. **Contracts**:
   - `consumes`: Links to Object cards read as inputs.
   - `produces`: Links to Object cards written or updated as outputs.
3. **Movement Cycle**: Numbered sequence of steps from trigger to settlement, citing code lines.
4. **If you change this**:
   - `Hits`: First-order dependencies affected by changing this flow.
   - `Does not hit`: Decoupled asynchronous listeners or independent subsystems.
5. **Human Gates & Failure Modes**: Error handling, retry logic, and points of manual intervention.
6. **See**: Links to source files orchestrating the process.

