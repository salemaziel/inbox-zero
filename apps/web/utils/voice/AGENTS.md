# utils/voice

**Parent context:** `../AGENTS.md`
**Generated:** 2026-10-23 · **Updated:** 2026-10-23

## Purpose

Provider-agnostic voice layer: dictation (speech-to-text), spoken replies (text-to-speech), and OpenAI full-duplex "live" calls. Server code resolves which provider is configured and wraps it in an adapter; client-safe helpers (recording, error text, transcript assembly) live next to it. Consumed by `app/api/voice/{status,transcribe,speak,live/session}/route.ts`, `hooks/useVoiceDictation.ts`, `hooks/useVoiceLive.ts`, `hooks/useVoiceStatus.ts`, and `components/voice/`.

## Key Files

| File | Description |
| --- | --- |
| `types.ts` | `VoiceProviderId`, capability flags, request/response types, and the `VoiceProvider` adapter interface |
| `catalog.ts` | `VOICE_CATALOG`: static list of providers and what each can do (`transcribe` / `synthesize` / `live`) |
| `factory.ts` | `resolveVoiceRuntime` (env + user AI key -> config), `createVoiceProvider`, `toVoiceStatus`, `requireVoiceCapability` |
| `runtime.ts` | Reads `@/env` and calls the factory: `getVoiceRuntime`, `getVoiceStatus`, `getConfiguredVoiceProvider` |
| `limits.ts` | Size, character, and timeout caps plus default model and voice names |
| `errors.ts` | `VoiceUnavailableError` (not configured / missing key / unsupported capability) and `VoiceRequestError` (upstream failure with HTTP status) |
| `api-error.ts` | `voiceErrorResponse`: maps the two error classes to a `NextResponse`; rethrows anything else |
| `client-error.ts` | Client-side error text helpers (use the client logger) |
| `http.ts` | Shared fetch helpers: deadlines, upload file names, JSON body reading, upstream error shaping, OpenAI-compatible transcription |
| `validation.ts` | Zod bodies for transcribe, speak, and live-session routes; `decodeAudioBase64` |
| `instructions.ts` | System instructions sent to the live voice model |
| `live-events.ts` | `parseLiveEvent`: normalizes raw realtime data-channel events |
| `live-history.ts` | Trims chat UI messages down to the history seeded into a live session |
| `transcript.ts` | Appends transcript deltas and groups fragments into speaker turns |
| `recording.ts` | Browser-only: recorder MIME type pick, blob to base64, microphone level meter |
| `speakable.ts` | Converts markdown/assistant output into text that reads aloud well |

## Subdirectories

| Directory | Description |
| --- | --- |
| `providers/` | `openai.ts` (transcribe, synthesize, live) and `groq.ts` (transcribe only) implementing `VoiceProvider` |

## For AI Agents

### Working In This Directory

- Adding a provider takes four edits: an id in `types.ts`, an entry in `catalog.ts`, an adapter class in `providers/`, and a `case` in `createVoiceProvider` (`factory.ts`). The catalog's capability flags must match the adapter's `capabilities`, because `toVoiceStatus` reports from the catalog.
- Capability checks go through `requireVoiceCapability` so unsupported actions (for example speaking with Groq) fail as `VoiceUnavailableError` rather than a missing method.
- `factory.ts` takes a plain `VoiceEnv` object so it stays unit-testable; only `runtime.ts` touches `@/env`. Keep it that way.
- The OpenAI key can come from the server env or the user's own AI key (`UserAIFields`); Groq uses `GROQ_API_KEY` only. `NEXT_PUBLIC_VOICE_ENABLED=false` disables voice even when keys exist.
- Route handlers must catch with `voiceErrorResponse`. Upstream error bodies are logged server-side and replaced by a generic client-safe message; do not return provider error text to the browser.
- Voice routes use `withEmailAccount` and `assertHasAiAccess` (see `app/api/voice/transcribe/route.ts`). New routes should follow the same auth and premium checks.
- `recording.ts` and `client-error.ts` run in the browser; do not import server-only modules (`@/env`, `runtime.ts`) into them or into hooks.
- New limits and default model names go in `limits.ts`, not inline in a provider.
- The live instructions deliberately forbid claiming mail actions were performed; keep that when editing `instructions.ts`.

### Testing Requirements

- Colocated unit tests: `factory.test.ts`, `http.test.ts`, `validation.test.ts`, `live-events.test.ts`, `live-history.test.ts`, `recording.test.ts`, `speakable.test.ts`, `transcript.test.ts`, `api-error.test.ts`, `client-error.test.ts`, `providers/openai.test.ts`.
- Run from repo root: `pnpm test apps/web/utils/voice`
- Provider tests mock `fetch`; no real provider keys are needed.

### Common Patterns

- Errors: throw `VoiceUnavailableError` for configuration problems and `VoiceRequestError` for upstream failures; never throw bare `Error` from a provider.
- Every outbound request is wrapped with `voiceDeadline(signal, timeoutMs)` to combine the caller's abort signal with a timeout.
- Providers expose a readonly `id` and `capabilities` and take their config in the constructor.

## Dependencies

### Internal

- `@/env`, `@/utils/llms/config` and `@/utils/llms/types` (provider constants, `UserAIFields`), `@/utils/logger`, `@/utils/error`.
- Consumers: `app/api/voice/*`, `hooks/useVoice*.ts`, `components/voice/`, `components/assistant-chat/chat.tsx`.

### External

- OpenAI HTTP API (transcriptions, speech, realtime/live) and Groq's OpenAI-compatible transcription endpoint, called with plain `fetch`.
- `zod`, `next/server` (`api-error.ts`).

## Manual Notes

Notes under this heading are written by humans and preserved on regeneration.
