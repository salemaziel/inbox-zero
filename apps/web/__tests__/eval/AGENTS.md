# __tests__/eval

**Parent context:** `../AGENTS.md`
**Generated:** 2026-10-23 · **Updated:** 2026-10-23

## Purpose

Benchmark-style evals for LLM features: the same scenario runs against one or more models with binary pass/fail scoring, optionally with an LLM judge for subjective output. Distinct from `../ai-regression/`, which holds live-LLM tests that do not use the eval helpers.

## Key Files

| File | Description |
| --- | --- |
| `models.ts` | `describeEvalMatrix(name, (model, emailAccount) => ...)` runs a describe block per model; `shouldRunEvalTests()` gates on `RUN_AI_TESTS` and configured provider keys |
| `model-catalog.ts` | `EVAL_MODEL_CATALOG`, `getEvalModels()` parsing `EVAL_MODELS` (`all`, comma shorthands, or a JSON array) |
| `reporter.ts` | `createEvalReporter({ evalName })`: `record`, `recordCached`, `printReport`; writes history under `.context/eval-results/` and honors `EVAL_REPORT_PATH`, `EVAL_HISTORY_DIR`, `EVAL_RESULT_CACHE` |
| `judge.ts`, `semantic-judge.ts`, `judge-provider.ts` | `judgeBinary` / `judgeMultiple` with `CRITERIA`; `judgeEvalOutput`; `getEvalJudgeUserAi()` |
| `assistant-chat-eval-utils.ts`, `assistant-chat-eval-env.ts`, `assistant-chat-episode-utils.ts` | Shared setup for the many `assistant-chat-*.test.ts` evals |
| `assistant-chat-*.test.ts` | Assistant chat behavior evals (rule editing, inbox workflows, memory safety, phishing hardening, attachments, calendar, ...). `*.scenarios.ts` files hold scenario data |
| `draft-reply*.test.ts`, `cold-email*.ts`, `choose-rule.test.ts`, `categorize-senders.test.ts`, `determine-thread-status.test.ts`, `meeting-*.test.ts`, ... | One eval per AI feature in `utils/ai/` |
| `debug-artifacts.ts`, `message-cache-key.ts` | Debug output and cache-key helpers |

## Subdirectories

| Directory | Description |
| --- | --- |
| `harness/` | Case-based eval framework: `case-schema.ts` (zod case envelope, `dev`/`test` splits, difficulty axes), `load-cases.ts`, `run-suite.ts` (concurrency, sharding, filters), `assertions.ts`, `criteria-judge.ts`, `send-ready-judge.ts`, `result-cache.ts`, `report.ts`, `stats.ts`, `taxonomy.ts`, `draft-reply-adapter.ts`; colocated `*.test.ts` unit-test the harness itself |
| `suites/` | Data-driven suites built on the harness (`draft-reply-data.test.ts`) |
| `decision-model/` | Evals for classification-style decisions (`choose-rule`, `cold-email`, `thread-status`, `recurring-pattern`, `categorize-sender`, `unsubscribe-page`, `reply-memory-selection`) with `helpers.ts` |

## For AI Agents

### Working In This Directory

- Evals must run from the repo root through `pnpm --filter inbox-zero-ai test-ai` (not `pnpm test`, which sets `RUN_AI_TESTS=false`).
- Gate with `describe.runIf(process.env.RUN_AI_TESTS === "true")` or `shouldRunEvalTests()`; use `describeEvalMatrix` rather than hand-rolled model loops.
- Do not pin per-user AI settings (`aiProvider`, `aiModel`, `aiApiKey`) in fixtures unless the eval is about model selection; use the `emailAccount` the matrix provides, or keep those fields `null`.
- Without `EVAL_MODELS`, the catalog default model runs so results compare across machines.
- Assert semantic failure modes with a judge criterion or structured contract, not English phrase checks (root `AGENTS.md`, LLM Features). Prompt changes should be backed by an eval here; see `.claude/skills/review-ai-prompt-changes/SKILL.md` and `.claude/skills/llm-test/SKILL.md`.
- Eval files and the harness are plain `.ts`; harness-internal tests (`harness/*.test.ts`, `judge-provider.test.ts`, `reporter.test.ts`) are not LLM-backed.

### Testing Requirements

```bash
pnpm --filter inbox-zero-ai test-ai __tests__/eval/choose-rule.test.ts
EVAL_MODELS=all pnpm --filter inbox-zero-ai test-ai __tests__/eval/choose-rule.test.ts
EVAL_MODELS=<shorthand>,<shorthand> pnpm --filter inbox-zero-ai test-ai __tests__/eval/<file>
EVAL_REPORT_PATH=eval-results/report.md EVAL_MODELS=all pnpm --filter inbox-zero-ai test-ai __tests__/eval/<file>
EVAL_RESULT_CACHE=readwrite pnpm --filter inbox-zero-ai test-ai __tests__/eval/<file>
pnpm --filter inbox-zero-ai eval-report --open     # HTML dashboard from recorded history
```

Provider keys (`OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, ...) must be set for the models selected.

### Common Patterns

- `evalReporter.record({ testName, model: model.label, pass })`, then `expect(...)`; call `evalReporter.printReport()` in `afterAll`.
- Use `evalReporter.recordCached` with `cacheKeyParts` for scenario/model pairs that can reuse a previous result.
- Judge-based: `judgeMultiple({ input, output, criteria: [CRITERIA.ACCURACY, ...] })`.

## Dependencies

### Internal

- `@/utils/ai/*`, `@/utils/llms/*`, `../helpers.ts` (`getEmailAccount`).

### External

- `vitest`, `zod`, AI SDK providers via `@/utils/llms`.

## Manual Notes

Notes under this heading are written by humans and preserved on regeneration.
