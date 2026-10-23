# Review Guide: Shared integrations layer for rule actions

**Generated**: 2026-10-23 | **Spec**: [spec.md](spec.md)

## Why This Change

The existing "Integration" rule action can only call a write tool through an app's remote MCP server. It supports exactly one tool in the editor and the AI rule writer, throws away what the app returns, never retries, and needs an AI call even to copy the email subject into a field. So apps without a usable MCP server can't be added, reruns create duplicates, and a transient error becomes a permanent failure with a generic message.

## What Changes

The same "Integration" action becomes a shared layer any future app can plug into with one small module. Apps can now run either through their MCP server or through a small built-in client. Results (item id and link) are stored and linked from rule history. Reruns don't duplicate items. Failures are classified, retried only when safe, and explained. Text fields can use email-field markers such as `[[subject]]` with no AI call. Native apps connect by pasting a token or via a token redirect. The rule editor picks between several tools and supports dependent choices (board, then list). No breaking changes: existing rules, the Todoist action and the feature gate behave as before. One additive, nullable database column is added.

## How It Works

- **Contract**: registry entries gain `execution: "mcp" | "native"` and `connectKind`. Per-tool specs stay the single browser-safe contract; remote-select fields gain `source` and `dependsOn`. A server-only table (`utils/integrations/executors.server.ts`) maps native integrations to `run / parseResult / listOptions / testConnection / revoke / buildAuthorizeUrl`, and MCP tools to an optional result parser.
- **Execution**: `actions.ts` keeps all existing pre-checks, then delegates to `runIntegrationAction`, which checks for a prior result (rerun protection), runs the native client or `callMcpTool` inside `runWithCallPolicy` (15 s per attempt, ≤3 attempts, ≤30 s total; retry only `not_sent`/`rate_limit`), parses the result, and maps error kinds to stored codes. `callMcpTool` now throws classified `IntegrationError`s.
- **Persistence**: `ExecutedAction.integrationResult` (nullable JSON) is written on success and on rerun-skip; history renders `https:` links only.
- **Placeholders**: resolved in `choose-args.ts` only in author-written text (via `parseTemplate`'s fixed parts), after AI fill, before persistence; values are never re-parsed. Validation rejects unknown markers.
- **Connect**: paste or redirect flows verify the token with the app, check the plan tier, and upsert the existing `McpConnection` (encrypted). Test/disconnect branch on execution kind.
- **Testing**: a test-only fixture integration under `apps/web/__tests__/fixtures/` drives every path; no real app, database or `.env` is needed.

## When It Applies

**Applies when**:
- A rule has an `INTEGRATION` action and integration actions are enabled for the user.
- An integration declares `execution: "native"` (none in production in this phase; Trello comes next).
- An integration text field contains `[[…]]` markers.
- A rule is re-run on an email whose earlier integration action stored an item id.

**Does not apply when**:
- Delayed actions, the outbound webhook action, automation-hub integrations (deferred by the design).
- The public v1 rules API for integration actions (out of scope, unchanged).
- Plan-tier checks at execution time (only at connect, as today).
- AI rule writer changes, unless the owner approves Q1.

## Key Decisions

1. **Extend `INTEGRATION`, no new `ActionType`.** Alternatives: a parallel per-app pipeline, MCP-only, webhook-only. Chosen because validation, AI fill, risk, display, import/export already run off the per-tool spec (design §5, §6).
2. **Native connections reuse `McpConnection`.** Alternative: a new table. Chosen so the integrations page, status and tier gating work unchanged (design §6.4). A deliberate exception to the per-feature-table house pattern.
3. **Never retry a write that may have landed.** Timeouts and 5xx on writes are `maybe_sent` and recorded as "may have been created". Chosen because target apps often have no idempotency key.
4. **Placeholders resolved in literal text only.** Alternative: resolve on the merged string or before AI fill. Rejected because either lets email content or AI output inject markers or prompts.
5. **Fixture injected by mocking lookup modules.** Alternative: a test-only registry entry behind `NODE_ENV`. Rejected to keep product code free of test branches.
6. **Single-spec fallbacks removed in two steps.** Editor fallbacks go now; rule-save and rule-writer fallbacks only with the owner-gated rule-writer change, so AI-authored Todoist actions keep working.

## Areas Needing Attention

- `callMcpTool` error classification depends on the installed MCP SDK's error shape (confirmed in T001); a wrong mapping could make a retryable error permanent or, worse, a maybe-sent error retryable.
- Rerun protection matches on mailbox + message + rule + integration + tool, from earlier runs only (the current run is excluded, so two identical actions in one rule both run the first time). On rerun they share a match, and two simultaneous reruns can both create (accepted limits).
- The app's own error text is now stored and shown in history. An existing upstream test that kept it out of the thrown error is rewritten, not deleted: the thrown message stays generic, and logs keep the text at trace level only.
- Deviations from the approved design, with code evidence, are listed in spec.md "Design notes found while specifying" (Outlook link, auth-deactivation scope, redirect state placement, showing the app's message).
- `rule.validation.ts`, `actions.ts`, `choose-args.ts`, `tool-specs.ts` and `schema.prisma` are frequently changed upstream; check that edits stay at small seams.
- The token-redirect capture page reads a token from the URL fragment; check it is cleared from history immediately and never logged.
- `build:ci` runs with CI's placeholder env because `.env` is absent in this worktree.

## Open Questions

From the spec's "Questions for the owner" (work proceeds on the defaults):

1. Approve the AI rule writer schema change (one option per tool naming app and tool)? Default: not applied; task T026 is droppable.
2. Marker syntax? Default `[[subject]]` style.
3. Hide native apps on the Integrations page when integration actions are disabled? Default: hide.
4. Which planning files are committed? Default: `docs/integrations/` and `specs/001-integrations-layer/` yes; `.omc/`, `.specify/` never.

## Review Checklist

- [ ] Key decisions are justified
- [ ] Breaking changes are documented with migration guidance (none expected; one additive column)
- [ ] Scope matches the stated boundaries (no app-specific code)
- [ ] Success criteria are achievable
- [ ] No unstated assumptions
- [ ] Hot upstream files touched only at seams
- [ ] No model-facing change without owner approval
- [ ] No secrets, private names or local paths in code, docs or tests

---

<!-- Code phase sections are appended below this line by the phase-manager command -->
