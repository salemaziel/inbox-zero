# components/new-landing

**Parent context:** `../AGENTS.md`
**Generated:** 2026-10-23 · **Updated:** 2026-10-23

## Purpose

Building blocks for the current public marketing site: page sections (header, footer, pricing, testimonials, ...), a small design-system layer, and landing-only icons. Consumed by `app/(landing)/` (`page.tsx`, `home/`, `pricing/`, `app/`, `oss-friends/`). Not used inside the authenticated app.

## Key Files

| File | Description |
| --- | --- |
| `CallToAction.tsx`, `DesktopDownloadCta.tsx` | Call-to-action blocks; `DesktopDownloadCta` takes a `downloads: DesktopDownloadLinks \| null` prop and is used by the marketing `/download` page that is cloned into this app at build time |
| `HeaderLinks.tsx` | Navigation links and icons for `sections/Header.tsx` |
| `BrandScroller.tsx`, `PatternBanner.tsx`, `FooterLineLogo.tsx` | Decorative strips and footer artwork |
| `LiquidGlassButton.tsx` | Glass-effect button variant |
| `UnicornScene.tsx` | Loads the Unicorn Studio WebGL scene from a pinned CDN script after page load (`scheduleAfterPageLoad`) |

## Subdirectories

| Directory | Description |
| --- | --- |
| `common/` | Primitives: `Section`/`SectionContent`, `Typography` (`SectionHeading`, `SectionSubtitle`, `Paragraph`, `Heading`, ...), `Card`/`CardContent`/`CardHeader`, `CardWrapper`, `DisplayCard`, `Button` (variants `primary`, `secondary`, `secondary-two`; sizes `md`/`lg`/`xl`), `Badge`, `Anchor`, `Logo`, `SectionLink`, and motion helpers `BlurFade`, `HeroReveal`, `WordReveal` |
| `sections/` | Full-width page sections: `Header`, `Footer`, `Pricing`, `Testimonials`, `Awards`, `EmailClient`, `OrganizedInbox`, `PreWrittenDrafts`, `BulkUnsubscribe`, `ManageFromAnywhere`, `StartedInMinutes`, `EverythingElseSection` |
| `icons/` | Landing-specific SVG icon components (`Gmail`, `Outlook`, `Sparkle`, `Zap`, ...) |

## For AI Agents

### Working In This Directory

- This is a separate visual system from `../ui/`. Use `common/Button`, `common/Typography`, and `common/Section` here, not `ui/button` or the app `Button.tsx`; their APIs differ (for example `variant="primary"` with a gradient border wrapper).
- Compose pages as `<Section>` containing `SectionHeading`, `SectionSubtitle`, `SectionContent`. Pass `className` through `cn` from `@/utils`.
- Images are referenced as `/images/new-landing/...` under `apps/web/public/` and rendered with `next/image`.
- Default to server components for marketing pages; only add `"use client"` for sections with state or effects (`Header`, `Pricing`, `Testimonials`, `UnicornScene` do). Keep animation and third-party scripts deferred so they do not hurt first load.
- Copy changes (pricing, testimonials, awards) are content edits in the section file; keep plan names and prices consistent with `app/(landing)/pricing/`.

### Testing Requirements

No tests live in this directory, and nothing under `../../__tests__/playwright` currently references landing or pricing text. Verify visually in the browser when a change is user-visible.

```bash
pnpm lint
```

Do not run `dev` or `build` unless asked (root `AGENTS.md`).

### Common Patterns

- Section files are one exported function per section, with local data arrays (for example the `Award` list in `sections/Awards.tsx`) defined above the component.
- Motion via `BlurFade` / `HeroReveal` / `WordReveal` from `common/`.

## Dependencies

### Internal

- `@/utils` (`cn`), `@/utils/schedule-after-page-load`, `app/(landing)/home/HeroVideoDialog`.

### External

- `next/image`, `next/link`, `motion`, `class-variance-authority`, `@radix-ui/react-slot`, `lucide-react`.

## Manual Notes

Notes under this heading are written by humans and preserved on regeneration.
