/**
 * Declarative specs for the MCP write tools that rule actions can call.
 *
 * One spec describes a tool's arguments once, and the rule editor, the AI
 * argument-filling pipeline, the executor, validation and history display all
 * read it. `buildPayload` is the only place that knows a tool's wire format.
 *
 * Storage semantics for `Action.integrationArgs`:
 *
 * - Text args: an empty (or absent) value on an arg with `aiPrompt` means the
 *   AI writes the whole value at execution time — the same convention as an
 *   empty `content` on a draft-reply action. A non-empty value is used
 *   literally, unless it contains `{{...}}`, which keeps working as the
 *   power-user template escape hatch.
 * - Select args: the stored value is always one of the option values, so the
 *   choice survives import/export and the v1 API round trip. An option can mean
 *   "let the AI decide" by matching `aiValue`; that is an explicit stored value,
 *   never an absent-vs-empty-string distinction. `buildPayload` maps option
 *   values to what the tool expects.
 *
 * Display-only args (see `displayValueKey`) are stored alongside their arg so
 * the editor and history can show a human label, and are never sent to the tool.
 */

import { TZDate } from "@date-fns/tz";
import type { IntegrationKey } from "@/utils/mcp/integrations";

export type IntegrationArgOption = {
  value: string; // stored in Action.integrationArgs
  label: string; // shown in the rule editor
  payloadValue?: string; // sent to the tool; omitted from the payload when absent
};

export type IntegrationArgControl =
  | { type: "text" }
  | { type: "select"; options: readonly IntegrationArgOption[] }
  // Options come from the integration itself: the control names the MCP read
  // tool to call and how to read its response, so no caller needs to know
  // which integration it is talking to.
  | {
      type: "remote-select";
      source?: "mcp";
      optionsTool: string; // MCP read tool supplying the options (not the spec's write tool)
      parseOptions: (content: unknown) => IntegrationArgOption[];
      buildOptionsArgs?: (
        parents: Record<string, string>,
      ) => Record<string, unknown>;
      dependsOn?: readonly string[]; // other arg keys whose values the options depend on
      fallbackOptions?: readonly IntegrationArgOption[]; // always offered, even if the fetch fails
    }
  // Options come from the native executor's listOptions.
  | {
      type: "remote-select";
      source: "native";
      dependsOn?: readonly string[];
      fallbackOptions?: readonly IntegrationArgOption[];
    };

export type IntegrationArgSpec = {
  key: string; // key inside Action.integrationArgs
  label: string;
  control: IntegrationArgControl;
  placeholder?: string; // plain-English description of what the AI will write
  aiPrompt?: string; // set => this arg can be filled by the AI at execution time
  aiValue?: string; // select-only: the stored option value meaning "AI decides"
  defaultValue?: string;
  defaultDisplayValue?: string;
  displayValueKey?: string; // companion key holding a human label; never sent to the tool
  required?: boolean; // must resolve to a non-empty value at execution time
  llmDescription?: string; // set => the rule-writing LLM may set this arg
};

export type IntegrationToolSpec = {
  integration: IntegrationKey;
  tool: string;
  actionLabel: string;
  displayArgKey?: string;
  llmDescription: string; // describes the action to the rule-writing LLM
  args: readonly IntegrationArgSpec[];
  buildPayload: (
    resolved: Record<string, string>,
    context: { timeZone: string }, // the account's IANA time zone
  ) => Record<string, unknown>;
};

// Todoist's virtual inbox: always selectable, even before projects load.
const TODOIST_INBOX_PROJECT: IntegrationArgOption = {
  value: "inbox",
  label: "Inbox",
};

const TODOIST_DUE_DATE_AI_VALUE = "ai";

const TODOIST_DUE_DATE_OPTIONS: readonly IntegrationArgOption[] = [
  { value: TODOIST_DUE_DATE_AI_VALUE, label: "AI decides from email" },
  { value: "none", label: "No due date" },
  { value: "today", label: "Today", payloadValue: "today" },
  { value: "tomorrow", label: "Tomorrow", payloadValue: "tomorrow" },
  { value: "in-7-days", label: "In a week", payloadValue: "in 7 days" },
];

const todoistAddTasksSpec: IntegrationToolSpec = {
  integration: "todoist",
  tool: "add-tasks",
  actionLabel: "Add Todoist task",
  displayArgKey: "content",
  llmDescription:
    "Add a task to the user's Todoist for the matching email. Only use this when the user explicitly asks to create Todoist tasks. Fails if Todoist isn't connected.",
  args: [
    {
      key: "content",
      label: "Task",
      control: { type: "text" },
      placeholder: "AI writes a short action item from the email",
      aiPrompt:
        "A short task title describing what the recipient needs to do about this email. Use a few words, not a sentence.",
      required: true,
      llmDescription:
        "The Todoist task title. Leave empty unless the user asked for specific wording, and the AI writes a task title from each matching email.",
    },
    {
      key: "description",
      label: "Description",
      control: { type: "text" },
      placeholder: "AI writes one line of context",
      aiPrompt:
        "One short line of context for the task. Return an empty string if the email adds no useful context.",
      llmDescription:
        "The Todoist task description. Leave empty unless the user asked for specific wording, and the AI writes one line of context from each matching email.",
    },
    {
      key: "projectId",
      label: "Project",
      control: {
        type: "remote-select",
        optionsTool: "find-projects",
        parseOptions: parseTodoistProjects,
        fallbackOptions: [TODOIST_INBOX_PROJECT],
      },
      defaultValue: TODOIST_INBOX_PROJECT.value,
      defaultDisplayValue: TODOIST_INBOX_PROJECT.label,
      displayValueKey: "projectName",
    },
    {
      key: "dueString",
      label: "Due date",
      control: { type: "select", options: TODOIST_DUE_DATE_OPTIONS },
      defaultValue: TODOIST_DUE_DATE_AI_VALUE,
      aiValue: TODOIST_DUE_DATE_AI_VALUE,
      aiPrompt:
        "The due date the email asks for, in natural language such as 'tomorrow' or 'next Friday'. Return an empty string if the email doesn't mention one.",
      llmDescription:
        "The task due date, e.g. 'today', 'tomorrow' or 'in 7 days'. Leave empty unless the user asked for a specific due date, and the AI takes the due date from each matching email.",
    },
  ],
  buildPayload: (resolved) => {
    const content = resolved.content?.trim() ?? "";
    const description = resolved.description?.trim() ?? "";
    const projectId = resolved.projectId?.trim() ?? "";
    const dueString = resolveSelectPayloadValue(
      TODOIST_DUE_DATE_OPTIONS,
      resolved.dueString,
    );

    // Todoist accepts a batch; rule actions always create exactly one task.
    return {
      tasks: [
        {
          content,
          ...(description && { description }),
          ...(dueString && { dueString }),
          ...(projectId && { projectId }),
        },
      ],
    };
  },
};

const TRELLO_NO_LABEL: IntegrationArgOption = {
  value: "none",
  label: "No label",
};

const TRELLO_ARCHIVE_DESTINATION: IntegrationArgOption = {
  value: "archive",
  label: "Archive the card",
};

const TRELLO_DUE_AI_VALUE = "ai";

// Presets are day offsets; buildPayload turns them into a date at send time.
const TRELLO_DUE_PRESET_DAYS: Record<string, number> = {
  today: 0,
  tomorrow: 1,
  "in-7-days": 7,
};

const TRELLO_DUE_OPTIONS: readonly IntegrationArgOption[] = [
  { value: "none", label: "No due date" },
  { value: TRELLO_DUE_AI_VALUE, label: "AI decides from email" },
  { value: "today", label: "Today" },
  { value: "tomorrow", label: "Tomorrow" },
  { value: "in-7-days", label: "In a week" },
];

const TRELLO_BOARD_ARG: IntegrationArgSpec = {
  key: "boardId",
  label: "Board",
  control: { type: "remote-select", source: "native" },
  displayValueKey: "boardName",
  required: true,
};

const TRELLO_CARD_ARG: IntegrationArgSpec = {
  key: "cardId",
  label: "Card",
  control: { type: "remote-select", source: "native", dependsOn: ["boardId"] },
  displayValueKey: "cardName",
  required: true,
};

const TRELLO_PICKED_IN_EDITOR =
  "The board and other Trello choices are picked in the rule editor after the rule is saved.";

// Comment and move act on the card picked in the editor, not one looked up per
// email, so the rule writer must not promise a per-email card.
const TRELLO_ONE_FIXED_CARD =
  "The card is one specific card the user picks in the rule editor after the rule is saved, and every matching email uses that same card; it can't find a different card for each email.";

const trelloCreateCardSpec: IntegrationToolSpec = {
  integration: "trello",
  tool: "create-card",
  actionLabel: "Add Trello card",
  displayArgKey: "name",
  llmDescription: `Add a card to a Trello list for the matching email. Only use this when the user explicitly asks to create Trello cards. Fails if Trello isn't connected. ${TRELLO_PICKED_IN_EDITOR}`,
  args: [
    TRELLO_BOARD_ARG,
    {
      key: "listId",
      label: "List",
      control: {
        type: "remote-select",
        source: "native",
        dependsOn: ["boardId"],
      },
      displayValueKey: "listName",
      required: true,
    },
    {
      key: "name",
      label: "Card title",
      control: { type: "text" },
      placeholder: "AI writes a short card title from the email",
      aiPrompt:
        "A short card title describing what needs to happen about this email. Use a few words, not a sentence.",
      required: true,
      llmDescription:
        "The Trello card title. Leave empty unless the user asked for specific wording, and the AI writes a title from each matching email.",
    },
    {
      key: "description",
      label: "Description",
      control: { type: "text" },
      placeholder: "AI writes a short summary",
      aiPrompt:
        "A short summary of the email for the card description. Return an empty string if the email adds no useful context.",
      llmDescription:
        "The Trello card description. Leave empty unless the user asked for specific wording, and the AI writes a short summary from each matching email.",
    },
    {
      key: "labelId",
      label: "Label",
      control: {
        type: "remote-select",
        source: "native",
        dependsOn: ["boardId"],
        fallbackOptions: [TRELLO_NO_LABEL],
      },
      defaultValue: TRELLO_NO_LABEL.value,
      defaultDisplayValue: TRELLO_NO_LABEL.label,
      displayValueKey: "labelName",
    },
    {
      key: "due",
      label: "Due date",
      control: { type: "select", options: TRELLO_DUE_OPTIONS },
      defaultValue: "none",
      aiValue: TRELLO_DUE_AI_VALUE,
      aiPrompt:
        "The due date the email asks for, as an ISO 8601 date such as 2026-03-14. Return an empty string if the email doesn't mention one.",
    },
    {
      key: "attachLink",
      label: "Attach link to the email",
      control: {
        type: "select",
        // The placeholder layer swaps [[link]] for the email's link before
        // buildPayload runs, so the stored choice stays a plain yes/no.
        options: [
          { value: "yes", label: "Yes", payloadValue: "[[link]]" },
          { value: "no", label: "No" },
        ],
      },
      defaultValue: "yes",
    },
  ],
  buildPayload: (resolved, { timeZone }) => {
    const name = resolved.name?.trim() ?? "";
    const desc = resolved.description?.trim() ?? "";
    const labelId = resolved.labelId?.trim() ?? "";
    const due = resolveTrelloDueDate(resolved.due, timeZone);
    const urlSource = getSafeHttpsUrl(resolved.attachLink);

    return {
      idList: resolved.listId?.trim() ?? "",
      name,
      ...(desc && { desc }),
      ...(labelId &&
        labelId !== TRELLO_NO_LABEL.value && { idLabels: [labelId] }),
      ...(due && { due }),
      ...(urlSource && { urlSource }),
    };
  },
};

const trelloAddCommentSpec: IntegrationToolSpec = {
  integration: "trello",
  tool: "add-comment",
  actionLabel: "Comment on Trello card",
  displayArgKey: "text",
  llmDescription: `Add a comment about the matching email to one Trello card. ${TRELLO_ONE_FIXED_CARD} Only use this when the user explicitly asks to comment on a Trello card. Fails if Trello isn't connected.`,
  args: [
    TRELLO_BOARD_ARG,
    TRELLO_CARD_ARG,
    {
      key: "text",
      label: "Comment",
      control: { type: "text" },
      placeholder: "AI writes a short comment from the email",
      aiPrompt:
        "A short comment summarizing this email and anything it asks for.",
      required: true,
      llmDescription:
        "The comment text. Leave empty unless the user asked for specific wording, and the AI writes a comment from each matching email.",
    },
  ],
  buildPayload: (resolved) => ({
    cardId: resolved.cardId?.trim() ?? "",
    text: resolved.text?.trim() ?? "",
  }),
};

const trelloMoveCardSpec: IntegrationToolSpec = {
  integration: "trello",
  tool: "move-card",
  actionLabel: "Move or archive Trello card",
  displayArgKey: "cardName",
  llmDescription: `Move one Trello card to another list, or archive it, when an email matches. ${TRELLO_ONE_FIXED_CARD} The destination list is also picked in the rule editor. Only use this when the user explicitly asks to move or archive a Trello card. Fails if Trello isn't connected.`,
  args: [
    TRELLO_BOARD_ARG,
    TRELLO_CARD_ARG,
    {
      key: "destination",
      label: "Destination",
      control: {
        type: "remote-select",
        source: "native",
        dependsOn: ["boardId"],
        fallbackOptions: [TRELLO_ARCHIVE_DESTINATION],
      },
      displayValueKey: "destinationName",
      required: true,
    },
  ],
  buildPayload: (resolved) => {
    const cardId = resolved.cardId?.trim() ?? "";
    const destination = resolved.destination?.trim() ?? "";

    return destination === TRELLO_ARCHIVE_DESTINATION.value
      ? { cardId, closed: true }
      : { cardId, idList: destination };
  },
};

export const INTEGRATION_TOOL_SPECS: readonly IntegrationToolSpec[] = [
  todoistAddTasksSpec,
  trelloCreateCardSpec,
  trelloAddCommentSpec,
  trelloMoveCardSpec,
];

export function getIntegrationToolSpec(
  integration: string | null | undefined,
  tool: string | null | undefined,
): IntegrationToolSpec | undefined {
  if (!integration || !tool) return;
  return INTEGRATION_TOOL_SPECS.find(
    (spec) => spec.integration === integration && spec.tool === tool,
  );
}

const GENERIC_INTEGRATION_ACTION_LABEL = "Add to integration";

export const MISSING_INTEGRATION_TOOL_MESSAGE =
  "This integration action doesn't say which app and action to use. Choose one in the rule editor.";

/**
 * Names the action after the tool it calls. `ActionType` alone cannot say which
 * integration an action targets, so callers that have the action should pass it.
 */
export function getIntegrationActionLabel(action?: {
  integrationName?: string | null;
  integrationToolName?: string | null;
}): string {
  const spec = getIntegrationToolSpec(
    action?.integrationName,
    action?.integrationToolName,
  );

  return spec?.actionLabel ?? GENERIC_INTEGRATION_ACTION_LABEL;
}

export function getIntegrationActionDisplayValue(action: {
  integrationName?: string | null;
  integrationToolName?: string | null;
  integrationArgs?: unknown;
}): string | null {
  const spec = getIntegrationToolSpec(
    action.integrationName,
    action.integrationToolName,
  );
  if (!spec?.displayArgKey) return null;

  const args = action.integrationArgs;
  if (!args || typeof args !== "object" || Array.isArray(args)) return null;

  const value = (args as Record<string, unknown>)[spec.displayArgKey];
  return typeof value === "string" ? value.trim() || null : null;
}

/** MCP read tools the app calls directly to populate a remote-select. */
export function getIntegrationRemoteSelectTools(
  integration: string,
  specs: readonly IntegrationToolSpec[] = INTEGRATION_TOOL_SPECS,
): string[] {
  return specs
    .filter((spec) => spec.integration === integration)
    .flatMap((spec) =>
      spec.args.flatMap((arg) =>
        arg.control.type === "remote-select" && arg.control.source !== "native"
          ? [arg.control.optionsTool]
          : [],
      ),
    );
}

/** Resolves a remote-select arg from untrusted request parameters. */
export function getRemoteSelectArg({
  integration,
  tool,
  argKey,
}: {
  integration: string | null | undefined;
  tool: string | null | undefined;
  argKey: string | null | undefined;
}) {
  const spec = getIntegrationToolSpec(integration, tool);
  if (!spec) return;

  const arg = spec.args.find((candidate) => candidate.key === argKey);
  if (arg?.control.type !== "remote-select") return;

  return { spec, control: arg.control };
}

/**
 * Whether the AI fills this arg at execution time: an empty text arg, or a
 * select sitting on its "AI decides" option.
 */
export function isAiFilledArgValue(
  arg: IntegrationArgSpec | undefined,
  value: string | null | undefined,
): boolean {
  if (!arg?.aiPrompt) return false;

  const trimmed = value?.trim() ?? "";
  if (arg.control.type === "select") return trimmed === arg.aiValue;
  return trimmed === "";
}

/** Args a newly added action starts with, per the spec's declared defaults. */
export function buildDefaultIntegrationArgs(
  spec: IntegrationToolSpec,
): Record<string, string> {
  const args: Record<string, string> = {};

  for (const arg of spec.args) {
    if (arg.defaultValue !== undefined) args[arg.key] = arg.defaultValue;
    if (arg.displayValueKey && arg.defaultDisplayValue !== undefined) {
      args[arg.displayValueKey] = arg.defaultDisplayValue;
    }
  }

  return args;
}

/**
 * Builds stored args from an AI-authored action's flat fields, applying the
 * spec's defaults so an omitted field means "the AI writes it at execution".
 */
export function buildIntegrationArgsFromFields({
  integrationName,
  integrationToolName,
  fields,
}: {
  integrationName: string | null | undefined;
  integrationToolName: string | null | undefined;
  fields: Record<string, string | null | undefined> | null | undefined;
}): Record<string, string> {
  const spec = getIntegrationToolSpec(integrationName, integrationToolName);
  if (!spec) return {};

  const args = buildDefaultIntegrationArgs(spec);

  for (const arg of spec.args) {
    const value = fields?.[arg.key];
    if (value == null) continue;

    const normalized =
      arg.control.type === "select"
        ? normalizeSelectArgValue(arg, value)
        : value;
    if (normalized !== undefined) args[arg.key] = normalized;
  }

  return args;
}

/**
 * Maps a loosely-specified select value (e.g. "in 7 days" from an AI-authored
 * rule) onto the option value we store, so the editor can show the choice.
 */
export function normalizeSelectArgValue(
  arg: IntegrationArgSpec,
  value: string | null | undefined,
): string | undefined {
  if (arg.control.type !== "select") return value?.trim() || undefined;

  const trimmed = value?.trim() ?? "";
  if (!trimmed) return arg.defaultValue;

  const match = arg.control.options.find(
    (option) => option.value === trimmed || option.payloadValue === trimmed,
  );
  return match?.value ?? trimmed;
}

/** A select value guaranteed to match one of the arg's options. */
export function getSelectArgOptionLabel(
  arg: IntegrationArgSpec,
  value: string | null | undefined,
): string | undefined {
  if (arg.control.type !== "select") return;
  const trimmed = value?.trim();
  if (!trimmed) return;
  // A value outside the presets is a custom value (e.g. a due date the user or
  // the AI wrote); show it as-is rather than hiding it behind a preset label.
  return (
    arg.control.options.find((option) => option.value === trimmed)?.label ??
    trimmed
  );
}

/** Keys the spec owns, including display-only companions. */
export function getIntegrationArgKeys(spec: IntegrationToolSpec): string[] {
  return spec.args.flatMap((arg) =>
    arg.displayValueKey ? [arg.key, arg.displayValueKey] : [arg.key],
  );
}

/** Reads Todoist's `find-projects` response into selectable options. */
function parseTodoistProjects(content: unknown): IntegrationArgOption[] {
  if (!Array.isArray(content)) return [];

  const options: IntegrationArgOption[] = [];

  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    if (!("text" in item) || typeof item.text !== "string") continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(item.text);
    } catch {
      continue;
    }

    for (const candidate of extractTodoistProjectArray(parsed)) {
      if (
        candidate &&
        typeof candidate === "object" &&
        "id" in candidate &&
        "name" in candidate &&
        typeof candidate.name === "string"
      ) {
        options.push({ value: String(candidate.id), label: candidate.name });
      }
    }
  }

  return options;
}

function extractTodoistProjectArray(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== "object") return [];
  if ("results" in parsed && Array.isArray(parsed.results)) {
    return parsed.results;
  }
  if ("projects" in parsed && Array.isArray(parsed.projects)) {
    return parsed.projects;
  }
  return [];
}

function resolveSelectPayloadValue(
  options: readonly IntegrationArgOption[],
  value: string | null | undefined,
): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return "";

  const option = options.find((candidate) => candidate.value === trimmed);
  // Unknown values come from AI filling, which returns natural language.
  return option ? (option.payloadValue ?? "") : trimmed;
}

// Days and times without a zone mean the user's own, so they are read in the
// account's time zone. A date-only value is pinned to midday there, which keeps
// it on that calendar day for anyone viewing the card nearby.
function resolveTrelloDueDate(
  value: string | null | undefined,
  timeZone: string,
): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return "";

  if (Object.hasOwn(TRELLO_DUE_PRESET_DAYS, trimmed)) {
    const today = new TZDate(Date.now(), timeZone);
    return toUtcIsoString(
      new TZDate(
        today.getFullYear(),
        today.getMonth(),
        today.getDate() + TRELLO_DUE_PRESET_DAYS[trimmed],
        12,
        0,
        0,
        0,
        timeZone,
      ),
    );
  }

  const local = LOCAL_DATE_TIME_PATTERN.exec(trimmed);
  if (local) {
    const [, year, month, day, hour = "12", minute = "00", second = "00"] =
      local;
    const date = new TZDate(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
      0,
      timeZone,
    );
    // Rejects dates that roll over, such as 2026-02-31.
    if (
      date.getFullYear() !== Number(year) ||
      date.getMonth() !== Number(month) - 1 ||
      date.getDate() !== Number(day)
    ) {
      return "";
    }
    return toUtcIsoString(date);
  }

  if (!ZONED_DATE_TIME_PATTERN.test(trimmed)) return "";
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

// YYYY-MM-DD, optionally with a time of day and no zone.
const LOCAL_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.\d+)?)?)?$/;
const ZONED_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:?\d{2})$/i;

function toUtcIsoString(date: Date) {
  return new Date(date.getTime()).toISOString();
}

function getSafeHttpsUrl(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? "";
  try {
    return new URL(trimmed).protocol === "https:" ? trimmed : "";
  } catch {
    return "";
  }
}
