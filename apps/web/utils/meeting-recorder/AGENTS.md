# utils/meeting-recorder

**Parent context:** `../AGENTS.md`
**Generated:** 2026-10-23 · **Updated:** 2026-10-23

## Purpose

The meeting notetaker: a cron reconciles upcoming calendar events with bot bookings, a meeting bot (currently Recall) joins and records, webhooks move the recording forward, and queued jobs fetch the transcript, summarize it, and email a recap. This directory holds the provider-neutral logic; the Recall-specific client is in `utils/recall/`, the summarization and follow-up drafting prompts are in `utils/ai/meeting-recorder/`, and the HTTP entry points are `app/api/meeting-recorder/{schedule,process,transcript}/` and `app/api/recall/webhook/`.

Two Prisma models carry the state: `MeetingRecording` (one bot booking, with a `MeetingRecordingStatus`) and `Meeting` (the processed result, with a `MeetingProcessingStatus` and `processingAttempts`).

## Key Files

| File | Description |
| --- | --- |
| `bot-provider.ts` | `MeetingBotProvider` interface, `MeetingBotProviderError` (with `permanent` flag), provider-neutral `NormalizedTranscript`, bot display name |
| `create-bot-provider.ts` | Provider lookup by name and `isMeetingBotProviderConfigured`; the only file in this directory that imports the Recall client |
| `config.ts` | Tier gate, reconcile window, lookahead, stuck-job timeouts, max processing attempts; each constant carries a "why" comment |
| `reconcile.ts` | `reconcileAccount`, `reconcileSingleEvent`, `upsertMeeting`, `releaseAccountBookings`: books, reschedules, and cancels bots against calendar events |
| `join-rule.ts` | `shouldAutoJoin`: the single decision for whether the bot joins a meeting |
| `recording-lifecycle.ts` | Status groupings (`LIVE_STATUSES`, `CANCELLABLE_STATUSES`, `CHANGEABLE_STATUSES`, and others), `getStatusesBelow`, `recordingStatusData` |
| `transition-recording.ts` | `transitionRecording`: forward-only status update via `updateMany` |
| `webhook-handlers.ts` | Provider-neutral `handleBotStatusChange`, `handleRecordingReady`, `handleTranscriptReady` |
| `enqueue-processing.ts` | Queues the transcript-fetch and meeting-processing background jobs |
| `process-meeting.ts` | `processMeetingForAccount`: claims a meeting, summarizes it, sends the recap |
| `send-recap.ts` | `sendMeetingRecapEmail` |
| `delete-media.ts` | `deleteRecordingMedia`, `releaseAccountRecordings`: removes provider-held media while keeping transcripts |
| `attendees.ts` | Attendee snapshot schema, parse, and follow-up recipient selection |
| `normalize-meeting-url.ts` | `normalizeMeetingUrl` and `isHost`: canonical meeting URL used for dedup |
| `transcript-prompt.ts` | Turns a `NormalizedTranscript` into prompt text |
| `reply-context.ts` | `getRecordedMeetingContext` and prompt formatting so email replies can reference a recorded meeting |

## Subdirectories

None.

## For AI Agents

### Working In This Directory

- Only `create-bot-provider.ts` (and the vendor's own `utils/recall/`) should depend on a specific bot vendor. Webhook routes translate vendor payloads into `handleBotStatusChange`, `handleRecordingReady`, and `handleTranscriptReady`.
- Status only moves forward. Always change `MeetingRecording.status` through `transitionRecording` (it defaults to `getStatusesBelow(next)`), never a bare `update`, because webhooks arrive at least once and out of order. A zero update count means the row already moved on; that is not an error.
- Claims are `updateMany` with a condition and a count check (see `processMeetingForAccount`). Keep new background steps idempotent and guarded by the field they write, since a killed run is retried after `STUCK_PROCESSING_MINUTES`.
- Every retry is capped: `MAX_PROCESSING_ATTEMPTS` bounds paid summarization, `STUCK_TRANSCRIPT_REQUEST_MINUTES` avoids paying twice for a transcript. Read the comments in `config.ts` before changing a number.
- `MeetingBotProviderError.permanent` tells the reconciler whether to release its claim or leave the row for the next pass. Set it deliberately.
- Join decisions go through `shouldAutoJoin` only; both the cron and the upcoming-meetings API use it so the UI toggle matches what will happen. A per-meeting `joinOverride` beats the account's `MeetingJoinRule`.
- `MEETING_RECORDER_MIN_TIER` gates every layer that can put a bot in a call; keep new entry points consistent with it.
- Media is deleted from the provider but transcripts are kept. `mediaDeletedAt` unset is what the cron sweep retries.
- The raw meeting URL can contain a password and is encrypted at rest (see `ENCRYPTED_FIELDS` in `utils/prisma-extensions.ts`). Dedup uses `normalizedMeetingUrl` and `activeKey`, never the raw `meetingUrl`.
- Background jobs go through `enqueueBackgroundJob` from `@/utils/queue/dispatch`; the topic names are constants in `enqueue-processing.ts` and the route paths are under `app/api/meeting-recorder/`.

### Testing Requirements

- Colocated tests exist for most files: `reconcile.test.ts`, `process-meeting.test.ts`, `recording-lifecycle.test.ts`, `join-rule.test.ts`, `send-recap.test.ts`, `delete-media.test.ts`, `attendees.test.ts`, `bot-provider.test.ts`, `normalize-meeting-url.test.ts`, `reply-context.test.ts`, `transcript-prompt.test.ts`.
- Route tests: `app/api/meeting-recorder/schedule/route.test.ts`, `app/api/meeting-recorder/transcript/route.test.ts`, `app/api/recall/webhook/route.test.ts`.
- Run from repo root: `pnpm test apps/web/utils/meeting-recorder`

### Common Patterns

- Functions take `{ ..., logger }` as a named-argument object and log skipped or ignored work at info level.
- Status sets are exported arrays in `recording-lifecycle.ts` and used in Prisma `in:` filters; add a new set there instead of inlining status lists.
- Best-effort side effects (media deletion) catch and log so the main state change still commits.

## Dependencies

### Internal

- `@/utils/recall/` (vendor client), `@/utils/ai/meeting-recorder/` (summarize, draft follow-up), `@/utils/calendar/` (event fetch), `@/utils/meeting-briefs/attendees`, `@/utils/queue/dispatch`, `@/utils/premium`, `@/utils/prisma`.
- Consumers: `app/api/meeting-recorder/*`, `app/api/user/meeting-recorder/*`, `app/api/recall/webhook`, and the meetings UI under `app/(app)/[emailAccountId]/meetings/`.

### External

- Recall.ai (via `utils/recall/client.ts`), `date-fns`, `zod`.

## Manual Notes

Notes under this heading are written by humans and preserved on regeneration.
