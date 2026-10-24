# __tests__/ai-regression

**Parent context:** `../AGENTS.md`
**Generated:** 2026-10-23 · **Updated:** 2026-10-23

## Purpose

Live-LLM regression tests: one function from `utils/ai/` is called against a real model and the result is asserted. They use `RUN_AI_TESTS` but not the eval helpers (model matrix, reporter, judge). If you need cross-model comparison or LLM-as-judge scoring, write an eval in `../eval/` instead.

## Key Files

| File | Description |
| --- | --- |
| `ai-choose-rule.test.ts`, `ai-choose-args.test.ts` | Rule selection and action-argument generation |
| `ai-prompt-to-rules.test.ts`, `ai-prompt-to-split.test.ts` | Prompt-to-rule and prompt-to-split parsing |
| `ai-categorize-senders.test.ts`, `ai-persona.test.ts`, `ai-writing-style.test.ts`, `ai-detect-recurring-pattern.test.ts` | Sender and user analysis |
| `ai-extract-knowledge.test.ts`, `ai-extract-from-email-history.test.ts`, `ai-summarize-email-for-digest.test.ts` | Extraction and summarization |
| `ai-calendar-availability.test.ts`, `ai-meeting-briefing.test.ts`, `ai-mcp-agent.test.ts` | Calendar, meetings, MCP agent |
| `determine-thread-status.test.ts`, `ai-assistant-chat-send-disabled-regression.test.ts` | Thread status and a specific assistant-chat regression |

## Subdirectories

| Directory | Description |
| --- | --- |
| `reply/` | Draft-reply tests: `draft-reply.test.ts`, `draft-follow-up.test.ts`, `reply-context-collector.test.ts` |

## For AI Agents

### Working In This Directory

- Gate with `describe.runIf(process.env.RUN_AI_TESTS === "true")`; the default `pnpm test` sets `RUN_AI_TESTS=false` and skips these.
- Set an explicit per-test timeout (these call real models; existing files use 15 to 60 seconds).
- Use `getEmailAccount()` from `../helpers.ts` with `aiProvider`/`aiModel`/`aiApiKey` left `null`, so the global default model is used.
- Assert on structure and semantics, not exact prose. Do not add English keyword or phrase checks for model wording (root `AGENTS.md`, LLM Features).
- A prompt change should be accompanied by an eval or regression here; see `.claude/skills/review-ai-prompt-changes/SKILL.md` and `.claude/skills/llm-test/SKILL.md`.
- A real LLM key must be configured in the environment; keep keys out of logs and files.

### Testing Requirements

```bash
pnpm --filter inbox-zero-ai test-ai __tests__/ai-regression/ai-choose-rule.test.ts
pnpm --filter inbox-zero-ai test-ai __tests__/ai-regression/reply/draft-reply.test.ts
```

These run only from the package script (`RUN_AI_TESTS=true vitest --run`), never with `pnpm test`.

### Common Patterns

- Local helper builders (for example `getMessages(n)` in `reply/draft-reply.test.ts`) sit at the bottom of the file, per root `AGENTS.md`.
- Each file starts with a comment giving its own run command.

## Dependencies

### Internal

- `@/utils/ai/*`, `@/utils/llms/*`, `../helpers.ts`.

### External

- `vitest`, a configured LLM provider.

## Manual Notes

Notes under this heading are written by humans and preserved on regeneration.
