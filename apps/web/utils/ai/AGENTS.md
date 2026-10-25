# utils/ai

**Parent context:** `../AGENTS.md`
**Generated:** 2026-10-23 · **Updated:** 2026-10-23

## Purpose

Every LLM-backed feature: choosing which rule applies to an email, executing rule actions, drafting replies, the assistant chat and its tools, sender categorization, digests, meeting briefs, reports, and MCP tool use. Modules here build prompts and Zod output schemas and call the wrappers in `../llms/`. They never talk to a model provider directly. Prompt, tool, and eval rules are in root `AGENTS.md` ("LLM Features") and `.claude/skills/llm/SKILL.md`.

## Key Files

| File | Description |
| --- | --- |
| `choose-rule/run-rules.ts` | `runRules`: top-level pipeline that matches rules, picks one with the AI, builds action args, and saves the executed rule. |
| `choose-rule/match-rules.ts` | `findMatchingRules`: static (from/to/subject/body, group, category) matching before any AI call. |
| `choose-rule/ai-choose-rule.ts` | `aiChooseRule`: asks the model to pick among AI-instruction rules. Has a decision-model alternative in `../decision-model/choose-rule.ts`. |
| `choose-rule/choose-args.ts`, `ai-choose-args.ts` | Fill action fields (reply text, labels, MCP tool args) for the chosen rule. |
| `choose-rule/execute.ts` | `executeAct`: performs the action list through the email provider. |
| `actions.ts` | Per-action implementations (label, archive, reply, forward, draft, and more). |
| `security.ts` | `PromptHardening` (`trusted` or `untrusted` with `none`/`compact`/`full`) applied to system prompts. |
| `helpers.ts` | Shared prompt pieces: `getUserInfoPrompt`, `getUserRulesPrompt`, `getEmailListPrompt`, `getTodayForLLM`. |
| `types.ts` | Action execution types (`ActionItem`, `ExecutedRuleForAction`). |
| `reply/draft-reply.ts` | `aiDraftReply` / `aiDraftReplyWithConfidence` and formatting normalization. |
| `assistant/chat.ts` | `aiProcessAssistantChat`, the assistant chat agent loop; `ASSISTANT_CHAT_PIPELINE_VERSION` is bumped when its behavior changes. |
| `rule/create-rule-schema.ts`, `rule/prompt-to-rules.ts` | Model-facing rule schema and prompt-to-rules generation. |
| `public-contact-context*.ts` | Public contact lookup context, schema, and store. |
| `draft-cleanup.ts` | Removes stale AI drafts. |

## Subdirectories

| Directory | Purpose |
| --- | --- |
| `assistant/` | Chat loop, compaction, memory policy, response guard; `tools/rules` and `tools/settings` hold rule and settings tools. |
| `automation-jobs/` | Check-in message generation. |
| `calendar/` | Availability reasoning. |
| `categorize-sender/` | Single and bulk sender categorization. |
| `choose-rule/` | Rule matching, selection, arg filling, execution. |
| `clean/` | Inbox cleaner decisions. |
| `digest/` | Per-email digest summaries. |
| `document-filing/` | Attachment analysis and filing reply parsing. |
| `group/` | Newsletter and receipt detection. |
| `knowledge/` | Knowledge extraction, persona, writing-style samples. |
| `mcp/` | MCP agent and tool wiring for rule actions. |
| `meeting-briefs/`, `meeting-recorder/` | Briefing generation, meeting summaries and follow-up drafts. |
| `reply/` | Drafts, reply memory, confidence, thread status, nudges. |
| `report/` | Email report analysis steps. |
| `rule/` | Rule schema, action availability, prompt-to-rules. |
| `senders/` | Unsubscribe page state detection. |
| `split/` | Prompt-to-split for inbox tabs. |

## For AI Agents

### Working In This Directory

- Make LLM calls with `createGenerateObject` / `createGenerateText` from `@/utils/llms`, passing `emailAccount`, a `label`, `modelOptions` from `getModelForUseCase(emailAccount, LlmUseCase.X)`, and `promptHardening`.
- Choose `promptHardening` by trust: `untrusted` with `full` for flows that read email and can act (draft reply, chat, MCP); `compact` for read-only classification; `none` only for analytics. Email content is hostile input.
- A new feature needs a new `LlmUseCase` entry in `../llms/use-cases.ts`, which also maps it to a model type.
- Model-facing schemas are costly surface. Do not add tools or parameters without user approval (root `AGENTS.md`). Use `strictOptional` from `../llms/strict-optional.ts` where providers need it.
- Rule order for prompts comes from `sortRulesByCanonicalOrder` (`../rule/sort.ts`); keep it stable so classification is deterministic.
- Several decisions have a decision-model variant (`../decision-model/`). Rule choice is routed in `choose-rule/match-rules.ts` via `getDecisionModelConfig`; thread status, recurring pattern, sender categorization, reply-memory selection, and unsubscribe-page state wrap the call in `runDecisionModelOrFallback` so the LLM path remains the fallback.
- Use `appendOllamaOnlySystemGuidance` for structured output prompts so Ollama models behave.
- Reply drafting changes also affect `../reply-tracker/` (draft tracking and similarity).

### Testing Requirements

- Unit tests are co-located (`*.test.ts`), with the LLM mocked. Run from repo root: `pnpm test apps/web/utils/ai/choose-rule`.
- Prompt or behavior changes need an eval in `apps/web/__tests__/eval/` (for example `choose-rule.test.ts`, `draft-reply.test.ts`, `assistant-chat-*.test.ts`) run with `pnpm --filter inbox-zero-ai test-ai __tests__/eval/<file>.test.ts`. See `.claude/skills/llm-test/SKILL.md`.
- `security.test.ts` and `choose-args.security.test.ts` cover prompt hardening; keep them green.

### Common Patterns

- Options-object function signature with `emailAccount: EmailAccountWithAI` and `logger: Logger`.
- Zod schema with `.describe()` on each field, output parsed by `createGenerateObject`.
- Failures from provider limits or bad keys are classified in `../error.ts` and surfaced via `../error-messages`, not handled per feature.

## Dependencies

### Internal

- `../llms/` (models, retries, usage), `../rule/`, `../decision-model/`, `../email/` (`EmailProvider`), `../reply-tracker/`, `../mcp/`, `../redis/`, `@/generated/prisma`.

### External

- `ai` (Vercel AI SDK), `zod`, `@posthog/ai`.

## Manual Notes

Notes under this heading are written by humans and preserved on regeneration.
