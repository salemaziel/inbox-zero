# lib

**Parent context:** `../AGENTS.md`
**Generated:** 2026-10-23 · **Updated:** 2026-10-23

## Purpose

Small client-side libraries for the command palette (Cmd+K) and keyboard shortcuts. This is not a general-purpose utilities folder; server and domain logic belongs in `utils/`. Everything here runs in the browser and is imported as `@/lib/...`.

## Key Files

| File | Description |
| --- | --- |
| `shortcuts/registry.ts` | Single list of every keyboard shortcut (private `SHORTCUT_DEFINITIONS`, exported as `SHORTCUTS`), scopes, groups, conflict detection, key formatting, typing-target check, sequence timeout (`SEQUENCE_TIMEOUT_MS`), and `buildShortcutPaletteCommands` |
| `shortcuts/useShortcuts.ts` | `useShortcuts(handlers, ...)`: registers handlers for shortcut ids on top of `react-hotkeys-hook`, including multi-key sequences like `g>a` |
| `shortcuts/ShortcutsProvider.tsx` | Enables a set of shortcut scopes for a subtree |
| `commands/types.ts` | `Command` and `CommandSection` types used by the palette |
| `commands/fuzzy-search.ts` | `fuzzySearch(query, commands)`: weighted label, description, and keyword matching |

## Subdirectories

| Directory | Description |
| --- | --- |
| `commands/` | Command palette types and search |
| `shortcuts/` | Shortcut registry, hook, and provider |

## For AI Agents

### Working In This Directory

- A new shortcut is one entry in `SHORTCUT_DEFINITIONS` in `registry.ts` (id, keys, scope, group, label), then a handler passed to `useShortcuts` where the behavior lives. Prefer the registry over ad hoc `useHotkeys` calls (one exists in `components/email-list/EmailThread.tsx`); the registry is how conflicts and the shortcuts help dialog (`app/(app)/[emailAccountId]/mail/ShortcutsDialog.tsx`) stay correct.
- Conflicts throw at module load in development and tests (`assertNoShortcutConflicts`) and are only logged in production, so a conflict shows up as a failing run rather than a runtime surprise. Run the registry test after adding keys.
- Keys are `react-hotkeys-hook` strings matched against `event.key`, so they follow the typed character, not the physical key. Sequences use `>` (`g>a`).
- Scopes: `global` shortcuts work anywhere a `ShortcutsProvider` is mounted; `mail` shortcuts only where the mail scope is enabled (`MAIL_SHORTCUT_SCOPES`). Pass `ShortcutsProvider` a stable `scopes` array (module constant) because it drives an effect.
- `allowWhileTyping` is only for modifier combos and Escape; plain keys must stay inert in inputs. `desktopOnly` entries never fire in a browser tab. `capture` is for keys that must run before rich-text editors consume them.
- Shortcut ids are also used as the `action` property of the `mail_action` analytics event (see `utils/analytics/product.ts`), so renaming an id changes analytics data.
- An entry with a `palette` field appears in Cmd+K once a handler is registered for it; `components/CommandK.tsx` consumes `Command` and `fuzzySearch`.
- Keep these files free of server imports. `registry.ts` uses the client logger (`@/utils/logger-client`).

### Testing Requirements

- `shortcuts/registry.test.ts` and `shortcuts/useShortcuts.test.tsx` (the second needs a DOM). `commands/` has no test of its own; `components/CommandK.test.tsx` exercises search.
- Run from repo root: `pnpm test apps/web/lib`

### Common Patterns

- Registry data is declarative and `ShortcutId` is derived from the definitions, so ids are checked at compile time.
- `useShortcuts` groups bindings into buckets by scope, typing behavior, and capture, because the underlying library takes those options per hook rather than per key.

## Dependencies

### Internal

- `@/utils/logger-client`. Consumers: `components/CommandK.tsx`, `hooks/useCommandPaletteCommands.ts`, `app/(app)/[emailAccountId]/mail/layout.tsx`, `app/(app)/[emailAccountId]/compose/ComposeEmailForm.tsx`.

### External

- `react-hotkeys-hook`, `lucide-react` (palette icons).

## Manual Notes

Notes under this heading are written by humans and preserved on regeneration.
