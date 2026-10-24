# Integrations design notes

Working notes for the rule-driven integrations layer (branch `feat/integrations`).

| File | Purpose |
| --- | --- |
| `00-current-state.md` | How a matched rule becomes an executed action today, existing extension points, gaps, risks, and the design recommendation |

The feature spec, plan and tasks live under `specs/` (spec-kit layout).

## Why there is no separate knowledge workspace

A separate OpenKnowledge workspace (codebase-wiki or software-lifecycle starter) was considered and skipped. The spec-kit workflow already produces the spec, plan and task documents for this feature, and the software-lifecycle starter would duplicate that and compete for the same root `specs/` folder. A full codebase wiki would map the entire monorepo when only the rule-to-action path and the MCP integration code matter here, and that path fits in one current-state document. This repository also tracks upstream closely, so keeping extra tooling folders out of the tree keeps upstream syncs simple. If more integrations follow and the design notes outgrow this folder, a scoped knowledge workspace can be added then.
