<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# apps/web

**Parent context:** `../../AGENTS.md`
**Generated:** 2026-10-23 · **Updated:** 2026-10-23

The main Inbox Zero Next.js app (package `inbox-zero-ai`). Repo-wide coding rules live in the root `AGENTS.md`; the files below add directory-specific guidance.

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `app/` | App router: authenticated app, API routes, marketing/landing pages (see `app/AGENTS.md`) |
| `utils/` | Server-side domain logic: AI, email providers, rules, actions, integrations (see `utils/AGENTS.md`) |
| `components/` | Shared React components and shadcn/ui primitives (see `components/AGENTS.md`) |
| `__tests__/` | Integration, E2E, Playwright, eval, and AI tests (see `__tests__/AGENTS.md`) |
| `prisma/` | Prisma schema and migrations (see `prisma/AGENTS.md`) |
| `hooks/` | Client React hooks: mostly thin SWR wrappers around API routes, plus UI helpers (see `hooks/AGENTS.md`) |
| `providers/` | React context providers and the SWR fetch layer (see `providers/AGENTS.md`) |
| `store/` | Jotai atoms and the batched per-sender bulk-action queues (see `store/AGENTS.md`) |
| `lib/` | Command palette (Cmd+K) and keyboard shortcut registry (see `lib/AGENTS.md`) |
| `ee/` | Commercially licensed billing code: Stripe, Lemon Squeezy, Apple IAP (see `ee/AGENTS.md`) |
| `scripts/` | One-off and maintenance scripts (see `scripts/AGENTS.md`) |
| `generated/` | Generated Prisma client; never hand-edit |
| `public/` | Static assets |
| `styles/` | Global CSS |
| `types/` | Global type declarations |

## Manual Notes

Notes under this heading are written by humans and preserved on regeneration.
