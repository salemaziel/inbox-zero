# app/(app)/[emailAccountId]/assistant

**Parent context:** `../AGENTS.md`
**Generated:** 2026-10-23 · **Updated:** 2026-10-23

## Purpose

The AI assistant area. `page.tsx` renders the assistant chat (`@/components/assistant-chat/chat`). The rest of the folder is the rules UI: list, create and edit a rule, test rules against emails, bulk-run rules over past mail, review execution history, and tune assistant settings (drafts, digest, signatures, learned patterns). The `../automation/` tab page reuses many components from here.

## Key Files

| File | Description |
| --- | --- |
| `page.tsx`, `page.test.ts` | Chat entry. Awaits params, calls `checkUserOwnsEmailAccount`, wraps in `EmailLabelsProvider`, mounts `PermissionsCheck`. `maxDuration = 300`. |
| `Rules.tsx`, `RulesTabNew.tsx`, `RulesPromptNew.tsx` | Rules list and the tab that hosts it with `AddRuleDialog` and `BulkRunRules`. |
| `RuleForm.tsx`, `RuleDialog.tsx`, `RuleSteps.tsx`, `ConditionSteps.tsx`, `ActionSteps.tsx`, `RuleStep.tsx` | Rule editor, built as a sequence of condition and action steps. |
| `ruleFormActions.ts`, `draftReplyActions.ts` | Pure transforms between form state and `CreateRuleBody` actions. Draft-reply actions are normalized and denormalized here; webhook actions are filtered unless enabled. |
| `attachment-source-selection.ts`, `ActionAttachmentsField.tsx` | Attachment sources for send and draft actions. |
| `BulkRunRules.tsx`, `bulk-run.ts`, `bulk-run-rules-reducer.ts`, `BulkProcessActivityLog.tsx` | Run rules over a date range. `bulk-run.ts` pages through `/api/threads` in batches of 25 and queues `runAiRules` from `@/utils/queue/email-actions`. State lives in the reducer. |
| `History.tsx`, `ResultDisplay.tsx`, `Process.tsx`, `ProcessRules.tsx`, `TestCustomEmailForm.tsx` | Executed-rule history and test runs. |
| `consts.ts`, `constants.ts` | `NONE_RULE_ID` / `NEW_RULE_ID` sentinels; action-type icons and colors. |
| `examples.ts`, `ExamplesList.tsx` | Example rule prompts. |
| `rule-fetch-error.ts` | Maps rule fetch failures to a not-found or error state (`RuleNotFoundState.tsx`). |

## Subdirectories

| Directory | Description |
| --- | --- |
| `rule/create/`, `rule/[ruleId]/` | Pages for creating and editing a rule; `[ruleId]/error.tsx` handles load errors. They render `RuleForm`. |
| `settings/` | One component per assistant setting (about, digest, draft replies, draft confidence and knowledge, follow-up reminders, learned patterns, multi-rule, signatures, snippets, writing style, sensitive data policy, rule import and export). `SettingsTab.tsx` composes them. |
| `knowledge/` | Knowledge base used for draft replies (`KnowledgeBase.tsx`, `KnowledgeForm.tsx`, `DraftDocsSites.tsx`). |
| `group/` | Learned patterns (sender groups) UI (`LearnedPatterns.tsx`, `ViewLearnedPatterns.tsx`). |

## For AI Agents

### Working In This Directory

- Rule shapes come from `@/utils/actions/rule.validation` (`CreateRuleBody`). Change the Zod schema there, not a local type. Rule engine logic lives in `@/utils/rule`, not here.
- Keep form logic in the pure files (`ruleFormActions.ts`, `draftReplyActions.ts`, `bulk-run-rules-reducer.ts`) and test it there; the `.tsx` files should stay thin.
- Action types come from `ActionType` in `@/generated/prisma/enums`. Adding one needs updates in `constants.ts` (icon and color), `ActionSteps.tsx`, and the rule validation schema.
- Settings that change what the assistant does are model-facing in some cases (draft knowledge, writing style, sensitive data policy). Changes to prompts or tool behavior need the checks in root `AGENTS.md` ("LLM Features").
- The chat itself is in `components/assistant-chat`, backed by `app/api/chat`. Do not add chat logic in this folder.
- `FixWithChat.tsx` lets the user send a wrong rule result to the chat; it relies on `NEW_RULE_ID` and `RunRulesResult`.

### Testing Requirements

- Colocated tests: `RuleForm.test.ts`, `RuleForm.render.test.tsx`, `Rules.test.tsx`, `ruleFormActions.test.ts`, `draftReplyActions.test.ts`, `bulk-run*.test.ts`, `BulkRunRules.test.ts`, `ResultDisplay.test.tsx`, `ActionAttachmentsField.test.tsx`, `rule-fetch-error.test.ts`, `page.test.ts`.
- From repo root: `pnpm test "apps/web/app/(app)/[emailAccountId]/assistant"`.
- Rule-related browser flows: `pnpm -F inbox-zero-ai test:playwright:emulated automation` (see `__tests__/playwright/emulated/automation`).

### Common Patterns

- Form: React Hook Form with `zodResolver(createRuleBody)`; `RuleForm.tsx` calls `createRuleAction` and `updateRuleAction` from `@/utils/actions/rule`, passing `emailAccountId` first.
- Data: SWR hooks in `@/hooks` (for example `useRules`, `useExecutedRules`) with `mutate()` after mutations.
- Settings: one self-contained component per setting, each owning its own action call.

## Dependencies

### Internal

- `@/utils/rule`, `@/utils/actions/*`, `@/utils/queue/email-actions`, `@/components/assistant-chat`, `@/providers/EmailLabelsProvider`, `@/hooks`, `@/app/api/threads/route` (types).

### External

- `react-hook-form`, `zod`, `next-safe-action`, `swr`, `date-fns`.

## Manual Notes

Notes under this heading are written by humans and preserved on regeneration.
