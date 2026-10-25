# tap2line

Dev-only inspector: switch it on in the running app, click any element, and the file and line
that builds it goes on the clipboard and into `.tap2line/last.txt` at the repo root.

Two parts:

- `apps/web/components/Tap2Line.tsx` runs in the browser. It is mounted in `app/layout.tsx`
  only when `NODE_ENV === "development"`, so it is never in a production build.
- `apps/web/scripts/tap2line/locator.mjs` is a zero-dependency Node script that turns what was
  clicked into a source line. It reads the source on every request (cached for 2 seconds), so
  answers follow your edits and nothing is stored in the code.

## Start it

Run the locator next to the dev server, from the repo root:

```bash
node apps/web/scripts/tap2line/locator.mjs
pnpm dev
```

The locator listens on `127.0.0.1:3939` and only accepts browser requests from
`http://localhost:3000`. Override with `T2L_PORT` and `T2L_ORIGIN`; if you change the port, also
change `LOCATOR` at the top of `Tap2Line.tsx` and the dev-only `connect-src` entry in
`apps/web/next.config.ts` (the app's CSP otherwise blocks the browser from reaching the
locator). If the locator is not running, the app shows nothing at all.

## Use it

- A small red `t2l` tab sits on the right edge of the window. Click it, or press **Alt+I**.
- While it is on, the window has a red border and clicks do nothing in the app: hover shows a
  frame with the element's tag and component, a click picks it.
- **Esc**, Alt+I or the tab switches it off. It also switches itself off after **3 minutes
  without a pick** and says so, and it never survives a reload.
- The answer shows at the bottom of the screen for about 9 seconds and is copied to the
  clipboard. If copying fails, the line is shown in a text field to copy by hand.
- Instead of pasting, you can tell Claude "look at my last tap": the last 20 answers are in
  `.tap2line/last.txt` (ignored by git).

## Reading the answer

```
apps/web/app/(app)/[emailAccountId]/mail/ListToolbar.tsx:137 · handler :139
```

- `file:line` is where the element is written. `handler :N` is the nearby event handler
  (the `onClick` on that element, or the function it points to).
- `also: …` lists other places with the same distinctive names.
- `(?)` means the locator is not sure: the first line is its best guess and the `also:` lines
  are the other candidates, followed by `sig:` (what was clicked). Check the list.
- `not found in …` means the element had nothing distinctive enough to search for.

## Where the line comes from

1. **Exact.** React 19 records, in development, the stack where each element's JSX was written
   (`_debugStack` on the fiber). The tapper sends those stack frames to the Next dev server's
   `/__nextjs_original-stack-frames` endpoint (the one Next's own error overlay uses), which
   maps them back to the original file and line. Turbopack only accepts client frames as
   `file://<distDir>/static/…`, so the tapper rewrites `/_next/static/…` URLs with
   `process.env.__NEXT_DIST_DIR`, as Next's overlay does. The first frame in our code wins; if that is a
   shadcn primitive in `components/ui/`, the place that used the primitive is preferred.
   This endpoint is an **internal Next.js API** with no stability promise. If a Next upgrade
   changes it, the tapper silently falls back to ranking.
2. **Ranked.** Otherwise the locator searches `apps/web/app`, `apps/web/components`,
   `packages/mail-ui/src`, `packages/mail-react/src` and `packages/email-editor/src` (not tests,
   `generated/`, or this tool) for the element's component names, uncommon classes, `id`,
   `data-*` and `aria-label` values and literal text, and boosts files next to the current
   route's `page.tsx`.

## Known limits

- Ranking is weak for Tailwind-only elements: shared utility classes are ignored as too common,
  so identical buttons in one component come back as `(?)` with each one listed.
- Text built at runtime (`` `${count} selected` ``) or from data is not in the source.
- Components loaded with `next/dynamic` show up twice in ranking (the `dynamic()` wrapper and
  the real definition).
- If the dev server has created more than ~10,000 elements recently, React stops recording
  stacks for new ones and those picks fall back to ranking.
- The locator only answers on loopback. A phone on the LAN cannot use it.
