# utils/calendar

**Parent context:** `../AGENTS.md`
**Generated:** 2026-10-23 · **Updated:** 2026-10-23

## Purpose

Calendar integrations for Google Calendar and Microsoft (Outlook) calendars. Handles the separate calendar OAuth connection (stored as `CalendarConnection` rows, independent of the email login), reading events and busy periods, writing events, parsing and replying to meeting invitations, and detecting video-conference links. Used by scheduling, meeting briefs, booking links and the assistant.

## Key Files

| File | Description |
|------|-------------|
| `event-types.ts` | `CalendarEvent`, `CalendarEventProvider` interface and write result types: the provider-neutral contract |
| `event-provider.ts` | `createCalendarEventProvider` / `createCalendarEventProviders(emailAccountId, logger)`: load connections from Prisma and build Google/Microsoft providers |
| `providers/google-events.ts`, `providers/microsoft-events.ts` | `CalendarEventProvider` implementations |
| `providers/google-availability.ts`, `providers/microsoft-availability.ts`, `availability-types.ts` | Free/busy (`BusyPeriod`) per provider |
| `providers/google.ts`, `providers/microsoft.ts` | Calendar listing and connection-level operations |
| `providers/google-calendar-id.ts` | Detects Google virtual calendars (birthdays and similar) |
| `unified-availability.ts` | `getUnifiedCalendarAvailability`: merges busy periods across all connected calendars; `failClosed` option |
| `fetch-events-in-window.ts` | Events within a time range across connections |
| `event-writer.ts` | Create/update events via the right provider, aligned with booking location type |
| `client.ts` | Google Calendar OAuth client with token refresh |
| `../outlook/calendar-client.ts` | Microsoft Graph calendar client (lives in the outlook folder) |
| `handle-calendar-callback.ts`, `oauth-callback-helpers.ts`, `oauth-types.ts`, `constants.ts` | OAuth callback flow: signed `state` validation, cookies, existing-connection check, connection creation |
| `save-calendar-tokens.ts` | Persists refreshed tokens, guarded by `expectedExpiresAt` |
| `timezone-helpers.ts`, `video-conference-link.ts` | Timezone conversion; Meet/Zoom/Teams link extraction |
| `availability-error.ts` | Log context for availability failures |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `invitations/` | Parse `.ics` invitations from mail attachments, detect invitation messages, build accept/decline replies (`service.ts`, `parser.ts`, `detection.ts`, `content.ts`) |
| `providers/` | Google and Microsoft implementations for events, availability and connection operations |

## For AI Agents

### Working In This Directory

- Calendar connections are independent of the mailbox: a Google mailbox can have a Microsoft calendar and the reverse. Branch on the `CalendarConnection.provider`, not on the email account's provider. The guards `isGoogleProvider` / `isMicrosoftProvider` come from `../email/provider-types.ts` and are reused here.
- Add event operations to `CalendarEventProvider` in `event-types.ts` and implement them in both `providers/*-events.ts`; callers should go through `event-provider.ts`.
- Calendar tokens are refreshed and saved separately from mail tokens. Use `saveCalendarTokens` with `expectedExpiresAt` so a slow refresh cannot overwrite a newer token, and expect Google's refresh to throw `invalid_grant` when access is revoked (see `client.ts`).
- Scopes differ from mail: Google calendar scopes are `CALENDAR_SCOPES` in `../gmail/scopes.ts`; Microsoft's are also `CALENDAR_SCOPES`, in `../outlook/scopes.ts`.
- OAuth state is a signed value validated with `validateSignedOAuthState`; keep `emailAccountId`, `type: "calendar"` and `nonce` in the payload when changing the flow.
- Availability: use `failClosed: true` where a missing calendar must not look like free time (public booking in `../booking/public.ts` does); `excludeGoogleVirtualCalendars` skips birthday-style calendars.
- `video-conference-link.ts` host list must stay in sync with `../meeting-recorder/normalize-meeting-url`.

### Testing Requirements

- Co-located `*.test.ts` throughout, including `providers/` and `invitations/`.
- Run from repo root: `pnpm test apps/web/utils/calendar`
- Single file: `pnpm test apps/web/utils/calendar/unified-availability.test.ts`

### Common Patterns

- Provider-per-file implementations behind a neutral interface, created through a factory that reads Prisma connections once and reuses them.
- Pure helpers for timezone and invitation parsing, tested without network.

## Dependencies

### Internal

- `../prisma`, `../email/provider-types.ts`, `../gmail/` (oauth, scopes), `../outlook/` (calendar client, scopes), `../oauth/` (state, redirect), `../booking/location`, `../meeting-recorder/normalize-meeting-url`, `../logger`, `../error`.

### External

- `@googleapis/calendar`, `@microsoft/microsoft-graph-client`, `ical.js`, `date-fns`, `@date-fns/tz`, `he`.

## Manual Notes

Notes under this heading are written by humans and preserved on regeneration.
