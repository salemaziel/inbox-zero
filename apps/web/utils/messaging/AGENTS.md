# utils/messaging

**Parent context:** `../AGENTS.md`
**Generated:** 2026-10-23 · **Updated:** 2026-10-23

## Purpose

Chat-app integrations (Slack, Microsoft Teams, Telegram). Covers the shared Chat SDK bot that receives messages and button clicks, per-platform senders and formatters for notifications (rule results, digests, meeting briefs, document filings, follow-up reminders), channel routing (which Slack channel or DM receives which kind of notification), and account-link codes. These are separate from the email providers: a user's `MessagingChannel` rows (Prisma) connect an email account to a chat workspace.

## Key Files

| File | Description |
|------|-------------|
| `platforms.ts` | `MessagingPlatform` (`slack` / `teams` / `telegram`) vs Prisma `MessagingProvider` (`SLACK` / `TEAMS` / `TELEGRAM`) and display names |
| `chat-sdk/bot.ts` | Singleton Chat SDK bot (`getMessagingChatSdkBot`, `hasMessagingAdapter`, `withMessagingRequestLogger`): handles messages, reactions, button actions, and runs the assistant chat for inbound DMs |
| `chat-sdk/adapters.ts`, `chat-sdk/teams-config.ts` | Builds the Slack/Teams/Telegram adapters from env; cached on a global registry |
| `chat-sdk/webhook-route.ts` | `handleMessagingWebhookRoute`: shared handler for Teams and Telegram webhook routes (503 when unconfigured) |
| `chat-sdk/link-code.ts`, `chat-sdk/link-code-consume.ts` | Signed one-time codes that link a chat user to an email account; nonce consumed once via `../redis/messaging-link-code.ts` |
| `routes.ts`, `slack-routes.ts` | Notification route summaries by purpose (`MessagingRoutePurpose`: rule notifications, check-ins, meeting briefs, document filings, digests, follow-ups); Slack route upsert/validation |
| `channel-validity.ts` | Whether a channel connection has the fields it needs |
| `rule-notifications.ts` | Builds and sends rule-triggered notifications, including approve/edit buttons for pending actions |
| `pending-email-preview.ts` | Text preview of an assistant-proposed send/reply/forward |
| `prompt-commands.ts` | Slash commands (`/cleanup`, `/summary`, ...) mapped to assistant prompts |
| `action-event-identifiers.ts` | Parsing of action ids and Slack team ids from button events |
| `providers/slack/` | Slack Web API client, `send.ts`, Block Kit builders in `messages/`, `format.ts` (rich text to mrkdwn), `verify-signature.ts`, OAuth callback, slash commands, uninstall, app home |
| `providers/teams/welcome.ts` | Teams install welcome message |
| `providers/telegram/` | Raw Bot API calls (`api.ts`), bot config, formatting |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `chat-sdk/` | Platform-neutral bot, adapters, link codes, webhook handler |
| `providers/slack/` | Slack-specific client, senders, message builders (`messages/`) |
| `providers/teams/` | Teams-specific helpers |
| `providers/telegram/` | Telegram-specific helpers |

## For AI Agents

### Working In This Directory

- Two enums coexist: lowercase `MessagingPlatform` for URLs and adapter keys, uppercase Prisma `MessagingProvider` for database rows. `getMessagingProviderName` accepts both.
- Slack inbound requests must pass `validateSlackWebhookRequest` (`providers/slack/verify-signature.ts`: HMAC with a 5 minute replay window). Teams and Telegram go through the Chat SDK adapters in `webhook-route.ts`.
- Notifications are routed by purpose. Look up the destination via `routes.ts`/`slack-routes.ts` instead of hard-coding a channel; a route can target a channel or the user's DM (`MessagingRouteTargetType`).
- Link codes exist for Teams and Telegram only (`LINKABLE_MESSAGING_PROVIDERS`), expire after 10 minutes, and are single-use: `consumeMessagingLinkCode` rejects a code whose nonce was already consumed. Do not add a path that skips the nonce check.
- Anything an assistant proposes to send on a user's behalf (send, reply, forward) needs an explicit confirm button; `chat-sdk/bot.ts` routes the confirmation through `confirmAssistantEmailActionForAccount`.
- Slack text must be escaped with `escapeSlackText` / `richTextToSlackMrkdwn`; link unfurling is disabled with `disableSlackLinkUnfurls` (`providers/slack/send.ts`).
- Bot state uses ioredis when `REDIS_URL` is set, otherwise in-memory state (`chat-sdk/bot.ts`), so multi-instance behaviour differs.

### Testing Requirements

- Co-located `*.test.ts` (formatters, signature verification, slash commands, link codes, routes).
- Run from repo root: `pnpm test apps/web/utils/messaging`
- Single file: `pnpm test apps/web/utils/messaging/providers/slack/verify-signature.test.ts`

### Common Patterns

- Message builders are pure functions returning Block Kit blocks or Chat SDK `Card`s; senders in `send.ts` do the network call.
- Per-platform differences stay under `providers/<platform>/`; shared flow lives in `chat-sdk/` and top-level files.

## Dependencies

### Internal

- `../prisma`, `../redis/messaging-link-code.ts`, `../actions/messaging-channels.ts` and `../actions/automation-jobs.ts` (callers), `../ai/assistant/*` (assistant chat), `../automation-jobs/messaging`, `../follow-up/copy`, `../crypto-compare`, `../oauth/redirect`.

### External

- `chat`, `@chat-adapter/slack`, `@chat-adapter/teams`, `@chat-adapter/telegram`, `@chat-adapter/state-ioredis`, `@chat-adapter/state-memory`, `@slack/web-api`, `@slack/types`.

## Manual Notes

Notes under this heading are written by humans and preserved on regeneration.
