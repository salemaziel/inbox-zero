# Quickstart: Trello

## Server setup

1. Create a Trello Power-Up at https://trello.com/power-ups/admin, open its API key section, and copy the API key into `TRELLO_API_KEY` in `apps/web/.env`. The key is not a secret in Trello's model, but it is shared by every user of the deployment and counts against one rate limit (300 requests per 10 seconds per key).
2. On the Power-Up's Auth tab, add each origin the app runs on to the key's allowed origins, for example `http://localhost:3000` and the production domain. Without this, Trello's authorize page refuses to redirect back.
3. Turn on the Integrations page (`NEXT_PUBLIC_INTEGRATIONS_ENABLED=true`, or the `integrations` PostHog flag) and integration actions (`NEXT_PUBLIC_INTEGRATION_ACTION_ENABLED=true`, or its PostHog flag). Without the first, the page and its sidebar link are hidden; without the second, Trello can't be used in rules. Restart the dev server after changing either, since both are built into the client.

The return URL is `/<emailAccountId>/integrations/connect/trello`. Trello puts the token in the URL fragment; the app moves it out of the URL before any telemetry runs and never logs it.

## Tests

No network access, Trello account or database is needed; `fetch` is mocked. Run from `apps/web`:

```bash
node_modules/.bin/vitest run utils/integrations/trello.server.test.ts   # executor: auth URL, header, requests, options, errors, revoke
node_modules/.bin/vitest run utils/mcp/tool-specs.test.ts              # specs: payloads, due dates, archive vs move, option sources
node_modules/.bin/vitest run utils/integrations/token-fragment.test.ts  # token and denial capture
node_modules/.bin/vitest run utils/ai/rule/create-rule-schema.test.ts utils/rule/rule.test.ts utils/rule/mobile-rule.test.ts
node_modules/.bin/vitest run utils/integrations/editor.test.ts app/api/mcp/integrations/route.test.ts utils/sentry-scrub.test.ts
```

The rule-writer change is model-facing. Its live checks call a real model, so they need model keys in `apps/web/.env` and are skipped otherwise. Run from the repo root:

```bash
pnpm --filter inbox-zero-ai test-ai ai-regression/ai-prompt-to-rules-integrations  # picks the right app and tool; adds none unasked
pnpm --filter inbox-zero-ai test-ai ai-regression/ai-prompt-to-rules               # existing rule-writer regression
```

The browser spec `__tests__/playwright/emulated/automation/integration-action.spec.ts` covers the Todoist path through the new tool picker. It needs the emulated environment; see the layer quickstart.
