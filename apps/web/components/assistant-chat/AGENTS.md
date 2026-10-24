# components/assistant-chat

**Parent context:** `../AGENTS.md`
**Generated:** 2026-10-23 · **Updated:** 2026-10-23

## Purpose

Client UI for the AI assistant chat: the composer and history, message list, and rendering of every assistant tool call as a card or status line. Chat state comes from `ChatProvider` (`@/providers/ChatProvider`, wrapping `@ai-sdk/react`); the server side is `app/api/chat/route.ts` and `utils/ai/assistant/`.

## Key Files

| File | Description |
| --- | --- |
| `chat.tsx` | Main chat component: history dropdown, attachments (max 5 files, 4MB each, image types), prompt input, voice input, rename/delete dialogs. Reads state via `useChat()` |
| `messages.tsx` | Message list; renders `Overview` when empty and each message part via `MessagePart` |
| `message-part.tsx` | Large dispatcher (about 1,000 lines) from `part.type` (`tool-searchInbox`, `tool-createRule`, ...) to a tool card; unknown `tool-*` parts fall back to a generic "Running/Completed" line using `formatToolLabel` |
| `tools.tsx` | The tool result and approval cards: search/read/manage inbox results, send/reply/forward previews, created/updated rule cards, pending-create and save-memory cards, `htmlToText` |
| `types.ts` | `ChatTools` (map of tool name to server tool type imported from `utils/ai/assistant/tools/*`) and `ChatMessage` (`UIMessage` typed with `ChatTools`) |
| `inline-email-card.tsx`, `assistant-inline-email-response.tsx`, `assistant-tag-normalization.ts` | Inline email cards and the tag handling that turns assistant text into them |
| `email-lookup-context.tsx`, `inline-email-action-context.tsx` | React contexts: thread metadata lookup, and `queueAction(type, threadIds)` for inline archive-style actions |
| `inline-rule-suggestion-card.tsx`, `rule-summary-card.tsx` | Rule suggestion and summary cards |
| `ChatHistoryItem.tsx`, `RenameChatDialog.tsx`, `DeleteChatDialog.tsx`, `chat-history-types.ts` | Chat history UI |
| `helpers.ts` | `convertToUIMessages` (DB chat to UI messages), `getPendingEmailSubjectPrefix` |
| `tool-label.ts` | `formatToolLabel("tool-fooBar")` to a readable label |
| `overview.tsx`, `examples-dialog.tsx`, `messaging-channel-hint.tsx`, `preview-attachment.tsx` | Empty state, examples, hints, attachment chips |

## Subdirectories

None.

## For AI Agents

### Working In This Directory

- Adding or renaming an assistant tool touches several places: the server tool in `utils/ai/assistant/tools/`, its entry in `ChatTools` in `types.ts`, a `part.type === "tool-<name>"` branch in `message-part.tsx` (otherwise it renders only the generic fallback), and `tool-label.ts` if the label needs special casing. Adding a tool or parameter is a model-facing change and needs explicit user approval (root `AGENTS.md`, LLM Features).
- Tool outputs arrive as `unknown`; narrow with the guards in `message-part.tsx` (`isOutputWithError`, `getOutputField`, ...) rather than casting. Error outputs render through `ErrorToolCard`.
- Some persisted chats contain legacy parts (`tool-updateRuleState`, `tool-updateRuleConditions`, `tool-updateRuleActions`); keep their branches until old data is gone.
- Consequential actions (send, reply, forward, rule create/delete) are confirmed in the UI via the pending cards; the confirm endpoint is `app/api/chat/confirm-email-action`. Do not auto-execute from a card render.
- Do not mirror fetched props into local state with `useEffect` (root `AGENTS.md`).
- File naming here is mixed: PascalCase for dialogs and history items, kebab-case for the rest. Follow the neighbors.

### Testing Requirements

Colocated tests: `chat.test.tsx`, `ChatHistoryItem.test.tsx`, `inline-email-card.test.tsx`, `assistant-inline-email-response.test.tsx`, `tools.test.ts`, `tools.search-inbox-result.test.tsx`, `tool-label.test.ts`, `helpers.test.ts`, `assistant-tag-normalization.test.ts`. TSX tests use `// @vitest-environment jsdom` and stub `ResizeObserver`; `chat.test.tsx` mocks `useChat`/`useChats`.

```bash
pnpm test apps/web/components/assistant-chat
pnpm test apps/web/components/assistant-chat/tools.test.ts
```

Chat behavior with a real model is covered by evals, not here: `../../__tests__/eval/assistant-chat-*.test.ts` (see `../../__tests__/eval/AGENTS.md`). UI flows: `../../__tests__/playwright/emulated/chat/`.

### Common Patterns

- Branch on `part.type`, then `renderToolStatus({ part, loadingText, renderSuccess })` for the loading, error, and success states.
- Small `getXFromOutput` helpers live at the bottom of the file, below the component.

## Dependencies

### Internal

- `@/providers/ChatProvider`, `@/hooks/useChats`, `@/utils/ai/assistant/*` (tool types, `chat-context-validation`), `@/components/ai-elements/*`, `@/components/voice/VoiceInput`, `@/components/ui/*`, `@/components/Toast`.

### External

- `ai` and `@ai-sdk/react`, `nuqs`, `he`, `lucide-react`.

## Manual Notes

Notes under this heading are written by humans and preserved on regeneration.
