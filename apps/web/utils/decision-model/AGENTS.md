# utils/decision-model

**Parent context:** `../AGENTS.md`
**Generated:** 2026-10-23 · **Updated:** 2026-10-23

## Purpose

An optional, cheaper path for classification-style decisions. Instead of asking a chat model to write JSON, the code sends structured state and a set of named questions (choice or yes/no) to a decision model and reads back probabilities. Each decision here has a matching LLM implementation in `../ai/` or `../cold-email/`; this folder only runs when a decision model is configured and enabled for the user, and falls back to the LLM path otherwise or on error.

## Key Files

| File | Description |
| --- | --- |
| `decision-model.ts` | Runtime: `getDecisionModelConfig`, `isDecisionModelEnabledForUser`, `isDecisionModelAvailable`, `runDecisionModel`, `runDecisionModelOrFallback`, `createDecisionModelConfig` (parses `provider:model`). |
| `system-one.ts` | HTTP client for the `typesafe` and `openrouter` decision endpoints; validates responses with Zod, 30 s timeout. |
| `email-state.ts` | `getDecisionEmailState`: the trimmed email shape sent as state (from, to, subject, truncated content, attachment names). |
| `choose-rule.ts` | `decisionModelChooseRule`: which rule fits an email. Rule names become question keys; `None` and the combined conversation option are special cases. |
| `thread-status.ts` | `decideThreadStatus`: TO_REPLY, AWAITING_REPLY, FYI, or ACTIONED, with a minimum confidence. |
| `cold-email.ts` | `decideColdEmail`: yes/no with a minimum probability. Only used when `DECISION_MODEL_COLD_EMAIL_ENABLED` is on. |
| `recurring-pattern.ts` | `decideRecurringPattern`: whether a sender's emails consistently match one rule. |
| `categorize-sender.ts` | `decideSenderCategory`, `decideBulkSenderCategories`. |
| `reply-memory-selection.ts` | `decideRelevantReplyMemories`. |
| `unsubscribe-page.ts` | `decideUnsubscribePageState`. |

## Subdirectories

None.

## For AI Agents

### Working In This Directory

- Configuration comes from env: `DEFAULT_DECISION_MODEL` (`typesafe|openrouter|aigateway|openai:<model>`), `DEFAULT_DECISION_MODEL_ENABLED`, `DECISION_MODEL_COLD_EMAIL_ENABLED`, plus the provider key (`TYPESAFE_API_KEY` etc.).
- Enablement rule (`isDecisionModelEnabledForUser`): an explicit `user.decisionModelEnabled` wins; otherwise the deployment default applies, except users with their own AI key are off by default because they chose where their data goes.
- Always call through `runDecisionModel`. It runs the same trial-limit check, sensitive-data policy, and usage accounting as the LLM path. Do not call the SDK model directly.
- Callers wrap a decide function and the LLM implementation in `runDecisionModelOrFallback`, so a decision-model failure never blocks the feature. Rule choice is the one place that calls `getDecisionModelConfig` directly (in `../ai/choose-rule/match-rules.ts`).
- Each decider sets a confidence or probability threshold constant (for example `MIN_CHOICE_CONFIDENCE`, `MIN_STATUS_CONFIDENCE`, `MIN_COLD_EMAIL_PROBABILITY`). Choice deciders (rule choice, thread status) throw below the threshold so `runDecisionModelOrFallback` hands the email to the LLM; `decideColdEmail` instead treats a probability under the threshold as not cold.
- Question keys must not collide with user data. `choose-rule.ts` uses `__rule_choice__` because rule names are user-controlled.
- Email text is truncated before sending (2000 to 4000 characters depending on the decision). Keep truncation in `email-state.ts` or the decider.
- Adding a decision: add a file here, a matching eval in `__tests__/eval/decision-model/`, and wrap the call site with `runDecisionModelOrFallback`.

### Testing Requirements

- Unit tests are co-located (`*.test.ts` for every decider and `decision-model.test.ts`, `system-one.test.ts`). Run from repo root: `pnpm test apps/web/utils/decision-model`.
- Evals against a real decision model: `apps/web/__tests__/eval/decision-model/*.test.ts` (shared setup in `helpers.ts`), run with `pnpm --filter inbox-zero-ai test-ai __tests__/eval/decision-model/<file>.test.ts`.

### Common Patterns

```ts
const response = await runDecisionModel({ config, emailAccount, state, questions, label, logger });
const answer = response.answers[KEY]; // { type: "choice", choice, confidence, probabilities } or { type: "boolean", probability }
```

- Prompt-like text (definitions) goes into `state` or question descriptions; there is no free-form output to parse.

## Dependencies

### Internal

- `../llms/model-usage-guard.ts`, `../llms/sensitive-content.ts`, `../usage.ts`, `../ai/` and `../cold-email/` (callers), `../reply-tracker/conversation-status-config.ts`, `@/env`.

### External

- `ai` (experimental decision-model types), `@ai-sdk/gateway`, `@ai-sdk/openai`, `zod`.

## Manual Notes

Notes under this heading are written by humans and preserved on regeneration.
