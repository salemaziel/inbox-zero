# Feature Specification: Shared integrations layer for rule actions

**Feature Branch**: `feat/integrations` (spec directory `specs/001-integrations-layer`; no branch is created for this spec)

**Created**: 2026-10-23

**Status**: Implemented (Phase 4, 2026-10-23)

**Input**: Owner brief, Phase 3 (planning for the Phase 4 build). "When an Inbox Zero rule matches an email, it should be able to run an action in a connected third-party app." This spec covers the shared layer only. No app-specific integration (Trello or any other) is built here.

**Design input (approved, not re-litigated here)**: `docs/integrations/00-current-state.md` §6 ("Option D: one action contract, pluggable execution"), specifically the contract in §6.3 and the decisions in §6.4. Where this spec found a mismatch between that design and the code, it is listed under "Design notes found while specifying" rather than silently changed.

## Background

The product already has one rule action, "Integration", that calls a write tool in a connected app. Today it only works through a remote app server that speaks the Model Context Protocol (MCP), only for one tool at a time, throws away the result, never retries, and cannot be filled from email fields without an AI call. This feature turns that single action into a shared layer that any future app can plug into with one small module, while keeping the existing action, its stored rules and its feature gate working unchanged.

## Actors

- **Mailbox owner**: writes rules, connects apps, reads rule history.
- **Integration author**: a developer adding a new app in a later phase. Their "user experience" is the size and clarity of the contract they must implement.
- **Self-hoster / maintainer**: runs the product and merges upstream changes; cares about config, safety and merge cost.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A matched rule creates an object in a connected app and history links to it (Priority: P1)

A mailbox owner has a rule whose action is "create an item in App X". When an email matches, the item is created in App X through whichever execution path App X uses (its own remote MCP server, or a small built-in client), and the rule history shows the action as succeeded with a link to open the created item.

**Why this priority**: This is the goal of the whole layer. Without execution beyond MCP and without result capture, no app lacking a usable MCP server can be added, and the owner cannot see what was created.

**Independent Test**: Using a test-only fixture app (no real third-party service), run the integration action for a matched email with a fixture connection. Confirm the fixture received the expected payload, the executed action is recorded as succeeded, and the stored result holds the fixture's item id and link. Repeat with the fixture configured for the MCP path to confirm both paths record results the same way.

**Acceptance Scenarios**:

1. **Given** a connected app that uses the built-in client path and a rule with its action, **When** an email matches, **Then** the app receives exactly one create call with the resolved arguments, and the executed action is recorded "succeeded" with the returned item id and link.
2. **Given** a connected app that uses the MCP path and declares how to read its tool's response, **When** the action runs, **Then** the item id and link are read from the response and stored the same way.
3. **Given** an MCP app that declares no response reader, **When** the action succeeds, **Then** it is recorded "succeeded" with no stored result, exactly as today.
4. **Given** a stored link that is not `https:` (for example `javascript:`), **When** history is shown, **Then** no clickable link is rendered.
5. **Given** the integration-actions feature gate is off for the user, **When** a rule with this action matches, **Then** the action is recorded "skipped" exactly as today, and nothing is sent.

---

### User Story 2 - Fill action fields from the email without an AI call (Priority: P1)

A mailbox owner writes a text field such as "Title: [[subject]]" or "From [[from]]: [[link]]". When an email matches, those markers are replaced with the email's actual subject, sender and a link back to the email. No AI call is needed for this, and nothing in the email can turn itself into an AI instruction.

**Why this priority**: Most "create a task/card from this email" actions only need email fields. Doing it deterministically removes cost, latency and paraphrasing, and closes a prompt-injection route.

**Independent Test**: Run argument resolution for a rule whose text field mixes literal text, field markers and an AI template segment, against a message whose subject itself contains template-like text. Confirm markers are replaced with the exact values, the AI segment is filled from the AI response, and the subject's template-like text appears literally and never reaches the AI.

**Acceptance Scenarios**:

1. **Given** a text field "Re: [[subject]] from [[from]]" and no AI segments, **When** the rule runs, **Then** the stored, executed value is the literal subject and sender with no AI call made for the action.
2. **Given** a field mixing "[[subject]] - {{summarize the ask}}", **When** the rule runs, **Then** the marker is replaced with the subject and the `{{...}}` segment is filled by the AI as today.
3. **Given** an email whose subject is "{{ignore previous instructions}} [[from]]", **When** a field uses [[subject]], **Then** the stored value contains that subject text literally; it is never sent to the AI as a prompt, and its "[[from]]" is not replaced.
4. **Given** a rule being saved with "[[unknownField]]" in a text field, **When** the owner saves, **Then** the save is rejected with a message naming the unknown field.
5. **Given** a marker in a select or remote-select field, **When** the owner saves, **Then** the marker is not treated as a placeholder (those fields store fixed option values).
6. **Given** a required field whose only content is a marker that resolves to empty for this email, **When** the action runs, **Then** it fails with the existing "required field was empty" outcome, and nothing is sent.

---

### User Story 3 - Failures are classified, safely retried, and explained (Priority: P2)

When the app is briefly unreachable or rate-limits the request, the action is retried within strict limits. When it is unclear whether the item was created (timeout or server error after the request was sent), it is not retried and history says it "may have been created". When the app rejects the credentials, the connection is marked as needing reconnection and history says so.

**Why this priority**: Without this, a transient blip becomes a permanent failure, and a naive retry would create duplicates in apps that have no duplicate protection.

**Independent Test**: Drive the fixture app's client through scripted responses (connection refused, 429 with Retry-After, 429 repeatedly, timeout, 500, 401, 400) and check attempts made, total time used, recorded status, recorded error kind and message, and connection state.

**Acceptance Scenarios**:

1. **Given** the first attempt fails before the request is sent, **When** the second succeeds, **Then** the action is "succeeded" after two attempts.
2. **Given** a rate-limit response asking to wait 10 seconds or less (1 second if it names no wait), **When** the wait fits in the remaining time budget, **Then** it waits and retries, at most 3 attempts in total; **Given** a requested wait over 10 seconds, **Then** it stops retrying and records the rate-limit failure.
3. **Given** a timeout or a server error after the request was sent, **When** the action runs, **Then** it is not retried, is recorded "failed", and the message says the item may have been created.
4. **Given** a credentials rejection (including an expired or unrefreshable token found before anything is sent), **When** the action runs, **Then** it is recorded "failed" with an "auth" kind, is never described as "may have been created", the connection is marked inactive (built-in-client and direct MCP connections; hosted-provider connections are not deactivated because the rejection may concern the provider's platform key), and the owner is told to reconnect.
5. **Given** any single attempt, **When** the app does not answer within 15 seconds, **Then** that attempt is abandoned; and the action never spends more than 30 seconds in total across attempts.
6. **Given** the app returns an error message, **When** the action fails, **Then** a trimmed copy of the app's message is stored with the failure and shown to the owner next to that action in rule history; it never appears in logs above trace level.

---

### User Story 4 - Re-running a rule does not create duplicates (Priority: P2)

A mailbox owner re-runs rules on an email (single or bulk rerun). An integration action that already created an item for this email and rule is not run again; it is recorded "skipped" with a link to the existing item.

**Why this priority**: Reruns are a normal product feature, and many target apps have no idempotency key, so a rerun would otherwise duplicate items.

**Independent Test**: With a previously succeeded executed action (same mailbox, message, rule, app and tool) holding an item id, run the action again and confirm the fixture app receives no call and the new executed action is "skipped" with the earlier result.

**Acceptance Scenarios**:

1. **Given** an earlier succeeded run with a stored item id for the same mailbox, message, rule, app and tool, **When** the rule is re-run, **Then** the app is not called, and the action is "skipped" with the earlier item's link.
2. **Given** an earlier run that failed or stored no item id, **When** the rule is re-run, **Then** the action runs normally.
3. **Given** a different rule or a different message, **When** the action runs, **Then** earlier results do not suppress it.

---

### User Story 5 - Connect, test and disconnect an app that has no MCP server (Priority: P2)

A mailbox owner opens the Integrations page and connects an app that uses the built-in client path, either by pasting a token the app gives them, or by being sent to the app's authorization page and returned with a token. They can test the connection and disconnect it; disconnecting asks the app to revoke the token when it supports that.

**Why this priority**: Built-in execution is useless without a way to connect. Two connect kinds cover the apps in the owner's example list that lack a usable MCP server.

**Independent Test**: Using the fixture app in "token paste" mode and in "token redirect" mode, exercise connect, test and disconnect through the server-side flows, with the fixture verifying the token. Confirm the token is stored encrypted, the plan tier is enforced, a tampered or cross-account return is rejected, and disconnect calls the fixture's revoke before removing the connection.

**Acceptance Scenarios**:

1. **Given** a user on a plan below the required tier, **When** they try to connect, **Then** the connection is refused with the existing upgrade message.
2. **Given** a pasted token the app rejects, **When** the owner submits it, **Then** nothing is stored and they see a clear error.
3. **Given** a valid pasted token, **When** submitted, **Then** the connection is stored (credential encrypted at rest) and the Integrations page shows it as connected.
4. **Given** the redirect flow, **When** the owner returns with a token and a state value that does not match the one issued to them (or belongs to a different mailbox), **Then** the token is discarded and nothing is stored.
5. **Given** a connected built-in-client app, **When** the owner clicks "test", **Then** the app's own check runs (not the MCP tool sync), and the result says whether the credentials work.
6. **Given** a connected built-in-client app, **When** the owner disconnects, **Then** the app is asked to revoke the token (failures to revoke are logged, not shown as errors) and the connection is deleted.
7. **Given** a built-in-client app connection, **When** chat or agents load integration tools, **Then** none come from it.

---

### User Story 6 - Pick among several app actions, with dependent choices, in the rule editor (Priority: P2)

A mailbox owner adding an "Integration" action can choose which connected app and which action to use when more than one exists. Where one choice depends on another (for example, a list inside a board), the second list loads based on the first, and changing the first clears the second.

**Why this priority**: The current editor assumes exactly one integration tool exists and silently breaks once a second is added; dependent choices are required by common apps (board then list, workspace then project, repository then labels).

**Independent Test**: With two fixture tools available, confirm the choices offered, the defaults applied when a tool is picked, that a child selection's options are requested with its parent's value, that requests with undeclared parent keys are refused, and that changing a parent clears the child.

**Acceptance Scenarios**:

1. **Given** exactly one integration tool exists (today's production state), **When** the owner adds an Integration action, **Then** it is preselected and the editor behaves as it does today.
2. **Given** two or more tools exist, **When** the owner adds an Integration action, **Then** they pick the app and action, and that tool's default field values are applied.
3. **Given** a child field that depends on a parent field, **When** the parent has no value, **Then** the child's options are not requested; **When** the parent changes, **Then** the child's value is cleared and its options reload for the new parent.
4. **Given** an options request naming a parent field the tool does not declare, **When** it reaches the server, **Then** it is refused.
5. **Given** a text field, **When** the owner edits it, **Then** they can see which email-field markers are available.

---

### User Story 7 - Hosted-provider apps can run rule write tools (Priority: P3)

For apps reached through the hosted tool provider (Composio), the write tools declared for rule actions are actually exposed by the provider, not only the read tools.

**Why this priority**: A small fix that makes the hosted-provider path usable for rule actions where it fits; no hosted-provider app declares write tools yet, so it is not user-visible today.

**Independent Test**: Request the hosted server for an app declaring both read and rule write tools and confirm both sets are in the allowed list sent to the provider.

**Acceptance Scenarios**:

1. **Given** a hosted-provider app with read tools and rule write tools, **When** its server connection is prepared, **Then** both are allowed.

---

### User Story 8 - The AI rule writer can create integration actions once several tools exist (Priority: P3, owner approval required)

When the owner asks the assistant to "create a rule that adds a task for every invoice", the assistant names the exact app and action, so AI-authored integration actions keep working after a second tool exists.

**Why this priority**: Not needed until a second production tool exists (Phase 5). It grows what the model sees, which the repository rules say needs explicit owner approval. It is sequenced last so it can be dropped without affecting anything else.

**Independent Test**: Build the rule-writer schema with two tools available and confirm each tool appears as its own option naming app and action; confirm an AI-authored action is saved with its app and tool.

**Acceptance Scenarios**:

1. **Given** approval and two or more tools, **When** the rule-writer schema is built, **Then** each tool is offered as a separate option with its app and action named.
2. **Given** this story is not approved, **When** the rest of the layer ships, **Then** AI-authored integration actions behave exactly as today (they work while only one production tool exists).

---

### Edge Cases

- A connection is deleted or deactivated between rule save and execution: the action fails "not connected" as today.
- A stored remote-select value no longer exists in the app (renamed or deleted): it stays visible in the editor; execution passes it through and the app's rejection is recorded as a permanent failure.
- A rate-limit wait longer than 10 seconds: no further retry; recorded failed with the "rate_limit" kind.
- Two identical tool actions in one rule: on the first run both execute (the current run's own results never suppress its later actions); on rerun they share one earlier match (known limit from the design, accepted for v1).
- Two reruns of the same email started at the same moment may both create an item, because reruns take no lock (known limit, accepted for v1).
- An unknown marker that reaches execution without passing save validation (for example an imported rule) is left as literal text.
- A requested rate-limit wait longer than the remaining time budget: no further retry; recorded failed with the "rate_limit" kind.
- Placeholder values containing marker text or template braces: inserted literally, never re-parsed.
- The email has no snippet or no "to": the marker resolves to an empty string.
- A test run of rules (preview) resolves markers but persists and sends nothing, as today.
- A token-redirect return page opened without a token, or after the state expired: shows an error and stores nothing.
- An app returns an id but no link, or a link but no id: whatever is valid is stored; only an id enables rerun protection.
- The app's error message contains personal data: it is stored with the user's own executed action and shown only to that user; logs keep it at trace level.

## Requirements *(mandatory)*

### Functional Requirements

**Registry and contract**

- **FR-001**: Each integration MUST declare how it executes: through its MCP server (the default, today's behaviour) or through a built-in client. Integrations that declare nothing MUST behave exactly as today.
- **FR-002**: A built-in-client integration MUST declare one connect kind: "token paste" or "token redirect" (enforced by the type system, not by convention).
- **FR-003**: The per-tool action description that already drives editor, AI fill, validation, risk and display MUST remain the single per-tool contract. It MUST stay safe to load in the browser (no credentials, environment values or network calls).
- **FR-004**: Everything that touches credentials or the network for built-in clients MUST live in a server-only table keyed by integration, providing: run the action, list options for a field given parent values, test a connection, and (best-effort) revoke a token. MCP integrations MAY register only a response reader.
- **FR-005**: The layer MUST be exercisable end to end in unit tests by a test-only fixture integration that is never part of the production registry, covering both connect kinds, built-in execution, MCP execution with a response reader, dependent options, result capture, retry classification and rerun protection.

**Execution**

- **FR-006**: The existing checks before execution (feature gate, configured tool, write-tool allowlist, active connection, known tool, required fields) MUST keep their current order, outcomes and error codes.
- **FR-007**: After those checks, the action MUST run through the integration's declared path, inside one shared call policy.
- **FR-008**: The call policy MUST: abandon an attempt after 15 seconds or when the 30-second total budget runs out, whichever is sooner, even if the attempt ignores cancellation; make at most 3 attempts; retry only failures known to have happened before the request was sent (connection refused, name resolution failure, connect timeout, or a failure while preparing the call) and rate-limit responses whose requested wait is at most 10 seconds and fits in the remaining budget (a missing wait value means 1 second); never retry a timeout, a connection reset, or a server error on a write. A retry of either kind starts only when its wait plus a 5-second minimum attempt window fits in the remaining budget; otherwise the last definite error is returned. Any unexpected failure inside the layer MUST be recorded as a failure of that action only, never abort the rule's later actions.
- **FR-008a**: Loading options for a remote choice field, testing a connection, and revoking a token MUST each use one attempt with the same 15-second timeout. Option loading falls back to the field's fixed fallback options on failure, as today; a revoke failure or timeout is logged and the disconnect proceeds.
- **FR-009**: Failures MUST be classified as one of: auth, rate_limit, not_sent, maybe_sent, permanent; each MUST map to a distinct stored error code with owner-readable copy in history, and "maybe_sent" copy MUST say the item may have been created. "permanent" keeps today's generic call-failed code so existing history copy stays valid. A rerun-skipped action leaves the rule's overall status "applied".
- **FR-010**: An auth failure on a built-in-client or direct MCP connection (during a run, an options load or a connection test) MUST mark that connection inactive so the Integrations page shows it as needing reconnection. Hosted-provider connections are not deactivated.
- **FR-011**: A copy of the app's error message, trimmed to at most 500 characters, MUST be stored with the failed action and shown next to that action in rule history; the app's message and full error detail MUST only be logged at trace level, and generic error messages MUST NOT contain it.
- **FR-012**: Success MUST return an optional external id and optional link, validated before storage; the link is displayed only when it is `https:`. If reading the result fails after the app reported success, the action MUST still be recorded "succeeded" with no stored result.
- **FR-013**: The executed action MUST gain one optional stored result field holding that id and link. Adding it MUST be additive (no change to existing data).

**Rerun protection**

- **FR-014**: Before running an integration action, the system MUST look for an earlier succeeded executed action, from a previous run (never the current run), with a stored external id for the same mailbox, message, rule, integration and tool; if found, it MUST record the new action "skipped" with the earlier result and MUST NOT call the app.

**Email-field placeholders**

- **FR-015**: Text fields of integration actions MUST support markers for these email and rule fields: subject, from, to, date (the message's date as an ISO 8601 UTC timestamp), snippet, link (a link that opens the email in the user's mail client, using the product's existing per-provider link rules, which for Outlook use the provider's own message URL), ruleName. A marker name is case-sensitive; surrounding spaces inside the brackets are allowed. The marker syntax MUST NOT contain `{{` (see Questions for the owner, Q2; default `[[name]]`).
- **FR-016**: Markers MUST be replaced only in text the rule author wrote, after AI filling, before the values are stored; inserted values MUST never be re-parsed for markers or AI templates.
- **FR-017**: Marker replacement MUST also run when the rule needs no AI call, and MUST NOT cause one.
- **FR-018**: Saving a rule with an unknown marker in an integration text field MUST be rejected; markers in select fields MUST be ignored. Markers inside `{{…}}` AI sections are never replaced (they are left for the AI), so they are not checked at save.
- **FR-019**: The rule's AI-written reason MUST NOT be offered as a marker.

**Connect, test, disconnect**

- **FR-020**: Both connect kinds MUST enforce the existing plan-tier requirement, trim surrounding whitespace from the token, verify the credential with the app before storing it, and store it encrypted in the existing connection record.
- **FR-021**: The token-redirect flow MUST bind the return to a signed, expiring state issued to the same user and mailbox. The state travels in the return address's query string (apps commonly do not echo a state value back), and a token arriving in the browser-only part of the URL MUST be captured client-side, removed from the address bar, and submitted to the server with that state. The same state is also held in a short-lived httpOnly cookie, which is cleared before completion so each state can be used once.
- **FR-022**: Connection test and disconnect MUST use the integration's own test and revoke for built-in-client integrations; the MCP-only paths (tool sync, OAuth authorize URL, MCP token lookup) MUST NOT be reached for them.
- **FR-023**: Built-in-client connections MUST never produce tools for chat or agents.

**Editor**

- **FR-024**: The rule editor MUST let the owner choose the integration and tool when more than one exists, and MUST preselect when only one exists.
- **FR-025**: A remote choice field MAY declare parent fields; its options MUST be requested with validated parent values, MUST NOT be requested while a parent is empty, and MUST be cleared when a parent changes.
- **FR-026**: The options endpoint MUST accept only parent keys the field declares, and MUST route to the built-in client's option lister or, for MCP, the declared options tool with arguments built from parent values.

**Hosted provider**

- **FR-027**: The hosted-provider server connection MUST allow an app's declared rule write tools in addition to its read tools.

**AI rule writer (owner-gated)**

- **FR-028**: Only with owner approval: the AI rule writer MUST name integration and tool for each integration action. Without approval, its current behaviour MUST remain.

**Compatibility and constraints**

- **FR-029**: Existing stored rules, the existing Todoist action and its editor flow, other action types, and the feature-flagged integration path MUST keep working without data migration.
- **FR-030**: New behaviour MUST live in new files under the shared integrations folder; frequently-changed upstream files MUST be touched only at small call-site seams. Exception: keeping the redirect token out of telemetry (FR-021) needs direct changes to the shared error-reporting scrubber, the analytics URL filters and client start-up.
- **FR-032**: Following the Q3 default, built-in-client apps MUST be hidden from the Integrations page for users who do not have integration actions enabled; MCP apps are listed as today.
- **FR-031**: No new environment variable is required by the shared layer. If one becomes necessary, it MUST be added to the env example, the env schema and the build config together.

### Key Entities

- **Integration registry entry**: one per app. Gains "execution path" and, for built-in clients, "connect kind". Existing fields unchanged.
- **Tool action description**: one per app action (existing). Remote choice fields gain optional parent fields and a source (MCP options tool or built-in lister).
- **Built-in client entry (server-only)**: per app: run, list options, test connection, revoke; or, for MCP apps, a response reader only.
- **Call result**: optional external id and optional link returned by a successful action.
- **Classified integration error**: kind (auth, rate_limit, not_sent, maybe_sent, permanent), the app's message, and an optional requested wait.
- **Connection** (existing record, reused): stores the built-in client's credential encrypted, with active/inactive state.
- **Executed action** (existing record): gains the optional stored call result.
- **Placeholder values**: the per-email set of marker values computed once per rule run.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new app can be added by writing only its own module (registry entry, action descriptions, and either a response reader or a built-in client) with zero edits to shared execution, validation, editor or history code; demonstrated by the fixture integration running every acceptance scenario above with no fixture-specific branch in shared code.
- **SC-002**: 100% of integration actions whose fields use only markers and fixed values run with zero AI calls for the action.
- **SC-003**: Re-running rules on an already-processed email creates zero duplicate items for actions that previously stored an external id.
- **SC-004**: No integration action spends more than 30 seconds of a message's processing time, and no write is retried after the request may have reached the app.
- **SC-005**: Every failed integration action in history states one of five plain reasons (reconnect needed, rate-limited, could not reach the app, may have been created, rejected by the app) plus the app's own message when there is one.
- **SC-006**: All existing tests pass unchanged except where a test asserted the single-tool assumption or the discarded result, and the existing Todoist rule flow (editor, save, execute) behaves identically.
- **SC-007**: All new unit tests run without the app's environment file, a database, network access or any real third-party account.

## Assumptions

- The approved design (§6.3, §6.4 of the current-state doc) is the source of truth for contract shape and numeric limits.
- Built-in-client credentials reuse the existing connection record and its encryption; one connection per app per mailbox remains the limit.
- The native rerun lookup can use existing executed-rule indexes; no new index is required.
- Delayed execution, the outbound webhook action, automation-hub integrations, plan-tier checks at execution time, and the public v1 rules API for integration actions are out of scope.
- No real app-specific integration ships in this phase; Trello is built later on this layer.
- The integration-actions feature gate continues to govern editor visibility, save and execution for all integrations, including built-in-client ones.

## Questions for the owner

Work proceeds on the stated default for each. None blocks the plan.

### Q1. Approve the AI rule writer schema change? (model-facing surface; repository rules require explicit approval and disclosure)

**Context**: With two or more production tools, the current rule writer drops the Integration option entirely (it only works with exactly one tool). Today only one production tool exists, so nothing breaks in this phase.

**Exact proposed change** (rule-writer action schema): replace the single Integration option with one option per tool action description. Each option is a flat object:

```text
{
  type: "INTEGRATION",
  integrationName: <literal, e.g. "todoist">,
  integrationToolName: <literal, e.g. "add-tasks">,
  fields: { <one optional string per arg that has an llmDescription> },
  delayInMinutes: <unchanged>
}
```

described with the tool's existing `llmDescription`. Prompt text is unchanged. For today's production set, the only visible difference to the model is two new fixed-value fields on the Todoist option. The rule-save path then reads app and tool from the AI output instead of guessing the only tool, and the single-tool fallback is removed.

**Default**: Not applied. The task is planned last and is droppable; until approved, the rule writer keeps today's single-tool behaviour (which works while one production tool exists). Revisit before Phase 5 adds a second tool.

**Resolution (2026-10-23)**: Declined for Phase 4. The task was dropped and the rule writer is unchanged.

### Q2. Marker syntax for email fields

**Default**: `[[subject]]`, `[[from]]`, `[[to]]`, `[[date]]`, `[[snippet]]`, `[[link]]`, `[[ruleName]]`. It cannot collide with the AI template syntax `{{...}}`, rarely appears in ordinary text, and unknown names are rejected at save. Alternatives: single braces `{subject}` (collides visually with `{{...}}` and with JSON-like text), or a picker-only chip UI (larger editor change).

**Resolution (2026-10-23)**: Owner approved `[[name]]`.

### Q3. Show built-in-client apps on the Integrations page when integration actions are disabled for the user?

**Context**: A built-in-client connection has no use in chat or agents; its only use is rule actions, which are gated by the integration-actions feature gate.

**Default**: Hide built-in-client apps from the Integrations page for users without integration actions enabled; MCP apps are listed as today.

**Resolution**: Built on the default; the owner has not overridden it.

### Q4. Which planning files go into the feature branch's commits?

**Default**: commit `docs/integrations/` and `specs/001-integrations-layer/` (both written for a public repository); never commit `.omc/`, `apps/web/.omc/` or `.specify/` (local tool state).

**Resolution**: Built on the default; the owner has not overridden it.

## Design notes found while specifying

These do not change the design; they record where the code needed a decision the design left open.

1. **Remote choice field shape**: the design adds parent fields to remote choice fields, but today that field type requires an MCP options tool, and the MCP allowlist reads it. Built-in-client fields have no MCP tool. Resolution in the plan: remote choice fields gain a source; MCP stays the default so the existing Todoist description is unchanged; the MCP allowlist ignores built-in-client fields.
2. **Removing the single-tool fallbacks depends on Q1**: the rule-save path's fallback exists for AI-authored and API-authored actions, which carry no app or tool name. Removing it without the rule-writer change would break AI-authored Todoist actions. So editor fallbacks are removed in the picker work, and the rule-save and rule-writer fallbacks are removed only in the owner-gated task.
3. **Placeholder replacement "after the AI merge, in literal text only"**: implemented by replacing markers in the author-written parts of the template and inserting AI values between them, so AI output and inserted values are never scanned for markers.
4. **Existing `authType` on registry entries**: it is required today and drives the MCP connect button. Built-in-client entries set it to the token kind, but every connect, test, disconnect and token path branches on the execution path first, so the field is not used for them.
5. **Connection deactivation helper**: the design points at the OAuth module's deactivation, which is private. The layer performs the same single-field update itself rather than widening that module's exports.
6. **MCP error classification**: today's MCP call wraps every failure in a generic error and keeps the tool's message only in trace logs. The plan keeps the original error as the cause and marks tool-reported errors, so the shared policy can classify them (tool-reported errors are "permanent"; failures while preparing the call, such as token lookup or refresh, are "auth" or "not_sent"; transport timeouts are "maybe_sent").
7. **The `link` marker for Outlook**: the design names `getEmailUrlForMessage`, but the code deliberately avoids it for Microsoft and uses the provider's own message URL (`utils/url.ts` `getEmailUrlForOptionalMessage`; `components/EmailMessageCellActions.ts`). The plan uses `getEmailUrlForOptionalMessage` with the message's `externalUrl`.
8. **Auth deactivation scope**: the design deactivates the connection on any `auth` failure. The plan does so for built-in-client and direct MCP connections, but not hosted-provider ones, where a rejection may concern the provider's single platform key rather than the user (design §4.1).
9. **Token-redirect state**: the design says the capture page "checks the nonce". Apps commonly return only the token in the URL fragment and do not echo a state value, so the plan puts the state in the return address's query string.
10. **Showing the app's error message**: the design stores a trimmed provider message in the executed action's error, but no UI renders that field today, and an existing upstream test deliberately keeps tool error text out of the thrown error's message. The plan keeps the thrown message generic, carries the provider text in a separate field that is persisted and rendered in history only, and logs it at trace level only. The existing test is rewritten to assert exactly that; the PR must call out this change.
