# utils/rule

**Parent context:** `../AGENTS.md`
**Generated:** 2026-10-23 · **Updated:** 2026-10-23

## Purpose

Rule persistence and rule-adjacent logic that has no LLM call in it: creating, updating, toggling, and deleting rules with their actions; system rule definitions and ordering; learned sender patterns; classification feedback; and safety checks on outbound actions. Matching and AI selection live in `../ai/choose-rule/`; the model-facing rule schema is in `../ai/rule/`.

## Key Files

| File | Description |
| --- | --- |
| `rule.ts` | Core write path: `createRule`, `updateRule`, `partialUpdateRule`, `replaceRuleWithResolvedActions`, `upsertSystemRule`, `updateRuleActions`, `deleteRule`, `setRuleEnabled`. Every write queues a rule-history snapshot. |
| `rule-history.ts` | `createRuleHistory` snapshots and `RuleHistoryTrigger` values. |
| `consts.ts` | System rule definitions (`ruleConfig`: name, instructions, label, draftReply), `STANDARD_CATEGORY_SYSTEM_TYPES`, `DEFAULT_MAIL_SPLIT_SYSTEM_TYPES`, `OPT_IN_SYSTEM_TYPES`. |
| `sort.ts` | `SYSTEM_RULE_ORDER`, `sortRulesByCanonicalOrder`, `shouldShowSystemRule`. Order feeds both the Rules list and LLM prompts. |
| `toggle-rule.ts` | `toggleRule` by id or system type. Refuses org-managed rules. |
| `learned-patterns.ts` | `saveLearnedPattern`: adds or excludes a sender in the rule's group. |
| `ai-sender-pattern-learning.ts` | Gates writing new AI-sourced sender patterns (`shouldLearnAiSenderPatterns`). |
| `classification-feedback.ts` | Stores label added/removed feedback and feeds up to 10 items back into the choose-rule prompt. |
| `record-label-removal-learning.ts` | Turns a user removing a rule label into learning data. |
| `check-sender-rule-history.ts` | `checkSenderRuleHistory`: which rules have historically matched a sender's emails. |
| `sender-scope-overlap.ts` | Rejects a new sender-only rule that overlaps an existing one. |
| `static-from-risk.ts` | Blocks reply, send, and forward actions on name-based or wildcard From conditions (spoofable). |
| `email-from-pattern.ts` | `splitEmailPatterns`, glob-to-regex helpers for from/to patterns. |
| `recipient-validation.ts` | Requires a recipient for FORWARD and SEND_EMAIL actions. |
| `create-rule-condition.ts`, `mobile-rule.ts`, `mapRulesToExtensionTabs.ts` | Shape converters for the chat, mobile, and extension surfaces. |
| `types.ts` | `RuleWithRelations` (rule with actions and group). |

## Subdirectories

None. Tests sit beside the files (`*.test.ts`).

## For AI Agents

### Working In This Directory

- Always scope by `emailAccountId`. `prisma.rule.update({ where: { id, emailAccountId } })` is the pattern; never trust a bare rule id.
- Rules managed by an organization cannot be edited by members. Call `assertRuleIsNotOrgManaged` (from `../organizations/rules`) before mutating, as `toggle-rule.ts` does.
- Actions that point at a messaging channel need `addActionOwnershipToInput` so the channel's owning account is recorded.
- Outbound actions (reply, send, forward) go through `static-from-risk.ts`; the chat flow asks the user to confirm via `actionsNeedChatRiskConfirmation`. Do not weaken either check.
- New writes must call `queueRuleHistory` (see how `createRule` does it) so history stays complete.
- System rules (`SystemType`) are unique per account (`emailAccountId_systemType`). Opt-in types such as OTP stay hidden and unseeded until the user enables them.
- Changing `SYSTEM_RULE_ORDER` changes prompt order for every classification; update `sort.test.ts` and re-run the choose-rule evals.
- Conversation status rules (TO_REPLY, AWAITING_REPLY, FYI, ACTIONED) are handled by `../reply-tracker/`, and the LLM sees them as one combined option.

### Testing Requirements

- Run from repo root: `pnpm test apps/web/utils/rule` or one file such as `pnpm test apps/web/utils/rule/rule.test.ts`.
- Tests mock Prisma with `vi.mock("@/utils/prisma")`.
- Changes to ordering, instructions, or feedback prompts need the choose-rule eval: `pnpm --filter inbox-zero-ai test-ai __tests__/eval/choose-rule.test.ts`.

### Common Patterns

- Options-object functions, `logger` passed in, `SafeError` for user-visible failures.
- Pure helpers (`sort.ts`, `email-from-pattern.ts`, `static-from-risk.ts`) do not touch Prisma, and `email-from-pattern.ts` is also used by `../group/find-matching-group.ts` and `../ai/choose-rule/match-rules.ts`.

## Dependencies

### Internal

- `../ai/rule/` and `../ai/choose-rule/` (consumers and schema), `../actions/rule.validation.ts`, `../organizations/`, `../reply-tracker/`, `../group/`, `../prisma.ts`, `@/generated/prisma`.

### External

- `zod`, Prisma.

## Manual Notes

Notes under this heading are written by humans and preserved on regeneration.
