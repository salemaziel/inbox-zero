# Contract: email-field placeholders

Default syntax pending owner question Q2 in [../spec.md](../spec.md). If the owner picks another syntax, only the grammar regex in `apps/web/utils/integrations/placeholders.ts` and the editor hint change.

## Grammar

- Marker: `[[` optional spaces `name` optional spaces `]]`, where `name` matches `[A-Za-z][A-Za-z0-9]*`.
- Known names (case-sensitive): `subject`, `from`, `to`, `date`, `snippet`, `link`, `ruleName`.
- Text that does not match the marker pattern (for example `[[ two words ]]` or `[[]]`) is plain text.

## Where markers apply

- Only in integration-action args whose control is `text`.
- Never in `select` or `remote-select` args (they store option values).
- Never in non-integration action fields (`label`, `subject`, `content`, `to`, `cc`, `bcc`, `url`) in this phase.

## Values

| Name | Value |
| --- | --- |
| `subject` | Message subject header |
| `from` | Message From header (as received) |
| `to` | Message To header |
| `date` | Message date as ISO 8601 UTC (`internalDate`, falling back to the Date header); `""` if neither parses |
| `snippet` | Provider snippet |
| `link` | `getEmailUrlForOptionalMessage({ messageId, threadId, emailAddress, provider, externalUrl })` (Outlook: provider's own URL) |
| `ruleName` | Name of the matched rule |

Missing values resolve to `""`. The rule's AI-written `reason` is deliberately absent.

## Resolution rules

1. One post-processing call in `getActionItemsWithAiArgs`, applied on every exit (no-AI early return, draft-only, AI path), before actions are persisted (and also for test runs, which do not persist).
2. The decision for each arg is made from the **original** stored value, never the merged value.
3. Arg with `{{…}}` segments: split with `TEMPLATE_VARIABLE_PATTERN`; replace markers in the literal parts only; insert AI vars between them.
4. Arg without `{{…}}`: replace markers across the whole value.
5. Empty arg filled wholesale by AI: the AI output is used untouched.
6. Each arg is rendered exactly once; inserted values and AI output are never scanned for markers or `{{…}}`.
7. Unknown markers that reach execution (e.g. imported rules) stay as literal text.
8. The required-arg check in the executor runs on the resolved value.

## Save-time validation

`addIntegrationActionIssues` (in `apps/web/utils/actions/rule.validation.ts`) adds an issue at `integrationArgs.<key>` for each unknown marker name in a text arg: "Unknown field [[name]]. Available: subject, from, to, date, snippet, link, ruleName." Only the author-written literal parts are checked; markers inside `{{…}}` AI sections are never replaced, so they are skipped.
