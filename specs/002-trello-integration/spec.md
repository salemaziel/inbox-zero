# Trello on the integrations layer

Status: built on `feat/integrations` (Phase 5). Builds on [the shared layer](../001-integrations-layer/spec.md); anything not stated here (retries, timeouts, rerun protection, history, placeholders) is the layer's behaviour.

Owner decisions: Trello's REST API, not the Trello MCP server or Composio. Three actions: add a card, comment on a card, move or archive a card. The AI rule writer gets one Integration option per tool.

## Connect

- Trello is a native app with `connectKind: "token-redirect"`. It is listed on the Integrations page only when integration actions are enabled for the account **and** the server has `TRELLO_API_KEY`. Connecting is refused with "Trello isn't set up on this server." when the key is missing.
- Connect sends the user to `https://trello.com/1/authorize` with `key`, `name=Inbox Zero`, `scope=read,write`, `expiration=never`, `callback_method=fragment`, `response_type=token` and `return_url=<app>/<emailAccountId>/integrations/connect/trello?state=…`.
- Trello returns the token in the URL fragment (`#token=…`). The early guard moves it to session storage before any telemetry runs; the connect page checks it with `GET /1/members/me?fields=id` and saves it only if that succeeds.
- If the user declines, Trello returns an empty `token=` with `error=`. The page says "Trello didn't grant access, so nothing was connected." and saves nothing.
- Disconnect calls `DELETE /1/tokens/{token}` (best effort). That URL is the only place the token appears outside the Authorization header; Sentry redacts `/1/tokens/<value>` in URLs and span descriptions.

## Requests

- Base URL `https://api.trello.com/1`. Every call sends `Authorization: OAuth oauth_consumer_key="<key>", oauth_token="<token>"`. The token is never put in a query string or log line.
- Ids taken from stored args or option requests (board, card) must be alphanumeric; anything else fails without a call.

## Actions

| Action | Label | Arguments | Request |
| --- | --- | --- | --- |
| `create-card` | Add Trello card | Board, List (depends on Board), Card title (AI-filled, required), Description (AI-filled), Label (depends on Board, default "No label"), Due date, Attach link to the email (Yes/No, default Yes) | `POST /1/cards` with `idList`, `name`, and when set `desc`, `idLabels`, `due`, `urlSource` |
| `add-comment` | Comment on Trello card | Board, Card (depends on Board), Comment (AI-filled, required) | `POST /1/cards/{cardId}/actions/comments` with `text` |
| `move-card` | Move or archive Trello card | Board, Card (depends on Board), Destination (the board's lists plus "Archive the card") | `PUT /1/cards/{cardId}` with `idList`, or `closed: true` for archive |

- Due date options: No due date (default), AI decides from email, Today, Tomorrow, In a week. Presets and AI-written date-only values become an ISO date at 12:00 UTC so they land on the same calendar day in nearly every time zone; the AI is asked for an ISO date or empty. Anything that does not parse as an ISO date, or rolls over (for example 2026-02-31), is dropped.
- Attach link: the Yes option stands for the `[[link]]` email field, which the placeholder layer fills in before the payload is built. `urlSource` is sent only when that resolves to an `https:` URL.
- Text args accept `[[subject]]`-style markers like any integration text arg.
- Results: card actions store `{ externalId: card.id, url: card.shortUrl }`; a comment stores `{ externalId: action.id, url: https://trello.com/c/<shortLink>#comment-<id> }` when the short link is present, and no URL otherwise.

## Option lists

| Arg | Request | Label |
| --- | --- | --- |
| Board | `GET /1/members/me/boards?filter=open&fields=name` | board name |
| List, Destination | `GET /1/boards/{boardId}/lists?filter=open&fields=name` | list name |
| Label | `GET /1/boards/{boardId}/labels?fields=name,color` | name, or the capitalised colour when the label has no name |
| Card | `GET /1/boards/{boardId}/cards/open?fields=name` | card name |

Unknown args and missing or malformed board ids fail without a call.

## Errors

Trello's error bodies are plain text.

| Response | Kind | Effect |
| --- | --- | --- |
| 401 saying "invalid token", "expired token" or "token not found" | `auth` | Connection deactivated; user asked to reconnect |
| 401 saying "invalid key" | `permanent` | Message says the server's `TRELLO_API_KEY` is wrong; connections stay active |
| Any other 401 (for example "unauthorized card permission requested") and any 403 | `permanent` | No access to that board; connection stays active |
| 400, 404 | `permanent` | |
| 429 | `rate_limit` | Waits for `Retry-After` when present |
| Timeouts, network errors, 5xx | layer default | `not_sent` / `maybe_sent` rules |

## AI rule writer

One Integration option per tool spec, each with literal `integrationName` and `integrationToolName` and only that tool's AI-settable fields (Trello: card title and description; comment text; none for move). Board, list, card and label are always picked in the rule editor, and each Trello description says so. A saved integration action that names no app and tool is rejected with "This integration action doesn't say which app and action to use. Choose one in the rule editor."

## Environment

`TRELLO_API_KEY` (optional, server-only): the API key of the Trello Power-Up the deployment uses. Setup: [quickstart.md](./quickstart.md).
