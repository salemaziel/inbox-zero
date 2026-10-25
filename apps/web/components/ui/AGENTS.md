# components/ui

**Parent context:** `../AGENTS.md`
**Generated:** 2026-10-23 · **Updated:** 2026-10-23

## Purpose

shadcn/ui primitives (style `default`, base color `slate`, CSS variables, lucide icons, per `../../components.json`) built on Radix UI and Tailwind. Low-level, presentation-only building blocks the rest of the app composes.

## Key Files

| File | Description |
| --- | --- |
| `button.tsx` | Primary button; `cva` variants including app-specific `destructiveSoft`, `destructiveGhost`, `ghostMuted`, `green`; has a loading state. The default variant is blue, not the stock shadcn color |
| `form.tsx` | react-hook-form integration (`FormProvider`, `FormField`, ...) |
| `sidebar.tsx` | Large (about 840 lines) app sidebar system; covered by `sidebar.test.tsx` |
| `chart.tsx` | Recharts wrapper; `ChartStyle` is covered by `chart.test.ts` (config keys must not escape the `<style>` element) |
| `dialog.tsx`, `alert-dialog.tsx`, `sheet.tsx`, `popover.tsx`, `dropdown-menu.tsx`, `context-menu.tsx`, `command.tsx`, `tooltip.tsx`, `hover-card.tsx` | Overlays |
| `input.tsx`, `textarea.tsx`, `select.tsx`, `checkbox.tsx`, `switch.tsx`, `label.tsx` | Form controls |
| `table.tsx`, `tabs.tsx`, `card.tsx`, `badge.tsx`, `avatar.tsx`, `skeleton.tsx`, `progress.tsx`, `pagination.tsx`, `resizable.tsx`, `scroll-area.tsx`, `separator.tsx`, `collapsible.tsx`, `calendar.tsx`, `navigation-menu.tsx`, `alert.tsx`, `empty.tsx`, `item.tsx` | Layout and display |

## Subdirectories

None.

## For AI Agents

### Working In This Directory

- Add new primitives with the shadcn CLI, not by hand: `pnpm dlx shadcn@latest add <component>` (see `.claude/skills/ui-components/SKILL.md`). Review the generated file against nearby ones; local files use `cn` from `@/utils` and import from `@/utils`, not `@/lib/utils`.
- These files have been customized (button variants, avatar color fallback, chart hardening). Re-running the CLI over an existing file overwrites that work; diff before accepting.
- Keep primitives free of data fetching, app state, and feature logic. App-level wrappers (`../Tooltip.tsx`, `../Toast.tsx`, `../Input.tsx`) live one level up.
- About two thirds of the files start with `"use client"` (those wrapping stateful Radix parts); keep it where a file needs it, and leave it off purely presentational ones such as `card.tsx`.
- Use lucide-react icons; do not add other icon sets.

### Testing Requirements

Only `chart.test.ts` and `sidebar.test.tsx` exist; primitives are normally exercised through the components and Playwright specs that use them. Add a test here only for non-trivial logic or a security-sensitive behavior (as `chart.test.ts` does).

```bash
pnpm test apps/web/components/ui/chart.test.ts
pnpm test apps/web/components/ui/sidebar.test.tsx
```

### Common Patterns

- `React.forwardRef` wrappers around Radix parts (most files; a few newer ones use plain function components with `data-slot`), `cn(...)` for class merging, `cva` for variants, `asChild` through `Slot`.

## Dependencies

### Internal

- `@/utils` (`cn`).

### External

- `@radix-ui/*`, `class-variance-authority`, `lucide-react`, `react-hook-form`, `recharts`, `cmdk`, `react-day-picker`.

## Manual Notes

Notes under this heading are written by humans and preserved on regeneration.
