# utils/reply-tracker

**Parent context:** `../AGENTS.md`
**Generated:** 2026-10-23 · **Updated:** 2026-10-23

## Purpose

Keeps track of where each email conversation stands: needs a reply (`TO_REPLY`), waiting on someone else (`AWAITING_REPLY`), informational (`FYI`), or finished (`ACTIONED`). It decides the status for incoming and outbound messages, moves the matching provider label and `ThreadTracker` rows, generates AI draft replies, and tracks whether a sent message came from an AI draft. These four statuses are system rules (see `../rule/`); the LLM sees them as a single "Conversations" option and this folder picks the specific one.

## Key Files

| File | Description |
| --- | --- |
| `conversation-status-config.ts` | `CONVERSATION_STATUS_TYPES`, the `ConversationStatus` type, `isConversationStatusType`, and the combined "conversation-tracking" meta rule id and instructions shown to choosers. |
| `handle-conversation-status.ts` | `determineConversationStatus` (inbound: which sub-rule applies, no side effects) and `updateThreadTrackers` (resolve old trackers, write the new one). |
| `handle-outbound.ts` | `handleOutboundMessage`: entry point when the user sends; takes a per-message lock, then runs `outbound.ts` and draft tracking. |
| `outbound.ts` | `handleOutboundReply`: determines status after the user's own message, updates trackers and labels. Skips filing-assistant messages. |
| `thread-status-context.ts` | Builds the thread messages sent to the LLM (length limits) and drops assistant-authored messages. |
| `label-helpers.ts` | `applyThreadStatusLabel`, `removeConflictingThreadStatusLabels`, `getLabelsFromDb`. One status label per thread at a time. |
| `generate-draft.ts` | `fetchMessagesAndGenerateDraft` and the confidence-threshold variant that call `../ai/reply/draft-reply.ts`. |
| `draft-tracking.ts` | `trackSentDraftStatus` (was the AI draft sent, edited, or ignored) and `cleanupThreadAIDrafts`. |
| `draft-similarity.ts` | Similarity fields logged when a draft is sent. |
| `sender-reply-examples.ts` | Collects past replies to a sender as drafting examples. |
| `check-sender-reply-history.ts` | `checkSenderReplyHistory`: has the user ever replied to this sender, via `EmailProvider`. |
| `error-logging.ts` | `logReplyTrackerError` so label failures are logged consistently. |

## Subdirectories

None. Tests sit beside the files.

## For AI Agents

### Working In This Directory

- Two flows exist. Inbound: `../ai/choose-rule/` selects the Conversations option, then `determineConversationStatus` picks the sub-rule and normal rule execution applies the label. Outbound: the webhook handler (`../webhook/process-history-item.ts`) calls `handleOutboundMessage`.
- Outbound handling is idempotent through Redis locks (`acquireOutboundThreadStatusLock` in `../redis/outbound-thread-status.ts`; `acquireOutboundMessageLock` and `markOutboundMessageProcessed` in `../redis/message-processing.ts`). Release or mark processed in every path, as the `finally` blocks do; a leaked lock silently drops later updates.
- Only enabled statuses are processed. If no status rule is enabled for the account, return early.
- Messages from the filing assistant are not part of the conversation (`excludeAssistantMessages`, `isFilebotConversationMessage`). Keep them out of any new status input.
- Thread content sent to the LLM is length-capped (`THREAD_STATUS_LATEST_MESSAGE_MAX_LENGTH` and related); keep new prompts within those caps.
- Use `EmailProvider` for all label and thread calls, never Gmail or Outlook clients directly.
- Label application can fail per provider; log with `logReplyTrackerError` and continue rather than failing the whole webhook.
- Decision-model and LLM paths both exist for thread status (`../ai/reply/determine-thread-status.ts`); behavior changes here need both covered.

### Testing Requirements

- Run from repo root: `pnpm test apps/web/utils/reply-tracker`, or one file such as `pnpm test apps/web/utils/reply-tracker/handle-outbound.test.ts`.
- Callers with mocks of this module: `../ai/choose-rule/run-rules.test.ts`, `../webhook/process-history-item.test.ts`, `../follow-up/process.test.ts`.
- Thread-status quality evals: `pnpm --filter inbox-zero-ai test-ai __tests__/eval/determine-thread-status.test.ts`.

### Common Patterns

- Options-object functions with `logger`; statuses are `SystemType` values narrowed with `isConversationStatusType`.
- Prisma writes go through `withPrismaRetry` and are scoped by `emailAccountId`.

## Dependencies

### Internal

- `../ai/reply/`, `../ai/choose-rule/`, `../decision-model/`, `../email/` (`EmailProvider`), `../label.server.ts`, `../redis/`, `../follow-up/`, `../cold-email/`, `../messaging/rule-notifications.ts`, `../filebot/`.

### External

- Prisma (`ThreadTracker`, `SystemType`).

## Manual Notes

Notes under this heading are written by humans and preserved on regeneration.
