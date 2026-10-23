import type { MCP_INTEGRATIONS } from "@/utils/mcp/integrations";
import type { IntegrationToolSpec } from "@/utils/mcp/tool-specs";
import type {
  NativeConnection,
  NativeIntegrationExecutor,
} from "@/utils/integrations/types";
import {
  parseIntegrationCallResult,
  type IntegrationCallResult,
} from "@/utils/integrations/result";

type RegistryEntry = (typeof MCP_INTEGRATIONS)[string];

export const FIXTURE_NATIVE: RegistryEntry = {
  name: "fixture",
  displayName: "Fixture",
  url: "fixture.invalid",
  execution: "native",
  connectKind: "api-token-paste",
  authType: "api-token",
  scopes: [],
  ruleActionWriteTools: ["create-item"],
};

export const FIXTURE_REDIRECT: RegistryEntry = {
  name: "fixture-redirect",
  displayName: "Fixture Redirect",
  url: "fixture.invalid",
  execution: "native",
  connectKind: "token-redirect",
  authType: "api-token",
  scopes: [],
};

export const FIXTURE_MCP: RegistryEntry = {
  name: "fixture-mcp",
  displayName: "Fixture MCP",
  url: "fixture.invalid",
  execution: "mcp",
  serverUrl: "https://fixture.invalid/mcp",
  authType: "oauth",
  scopes: [],
  ruleActionWriteTools: ["create-item"],
};

export const fixtureCreateItemSpec: IntegrationToolSpec = {
  integration: "fixture",
  tool: "create-item",
  actionLabel: "Create fixture item",
  displayArgKey: "title",
  llmDescription: "Create an item on a board list for the matching email.",
  args: [
    {
      key: "title",
      label: "Title",
      control: { type: "text" },
      placeholder: "AI writes a short title from the email",
      aiPrompt: "A short title for the item.",
      required: true,
    },
    {
      key: "notes",
      label: "Notes",
      control: { type: "text" },
    },
    {
      key: "boardId",
      label: "Board",
      control: { type: "remote-select", source: "native" },
      displayValueKey: "boardName",
    },
    {
      key: "listId",
      label: "List",
      control: {
        type: "remote-select",
        source: "native",
        dependsOn: ["boardId"],
      },
      displayValueKey: "listName",
    },
  ],
  buildPayload: (resolved) => {
    const notes = resolved.notes?.trim() ?? "";
    return {
      title: resolved.title?.trim() ?? "",
      ...(notes && { notes }),
      boardId: resolved.boardId,
      listId: resolved.listId,
    };
  },
};

export const fixtureMcpCreateItemSpec: IntegrationToolSpec = {
  integration: "fixture-mcp",
  tool: "create-item",
  actionLabel: "Create fixture MCP item",
  displayArgKey: "title",
  llmDescription: "Create an item for the matching email.",
  args: [
    {
      key: "title",
      label: "Title",
      control: { type: "text" },
      aiPrompt: "A short title for the item.",
      required: true,
    },
  ],
  buildPayload: (resolved) => ({ title: resolved.title?.trim() ?? "" }),
};

type FixtureMethod = "run" | "listOptions" | "testConnection" | "revoke";

type FixtureCall = {
  method: FixtureMethod;
  conn: NativeConnection | { accessToken: string };
  signal: AbortSignal;
  payload?: Record<string, unknown>;
  argKey?: string;
  parents?: Record<string, string>;
};

/**
 * A scripted executor. Queue a value to have the next call to that method
 * resolve with it, or queue an Error (typically an IntegrationError) to have it
 * reject. An empty queue falls back to a successful default. With `neverSettle`
 * on, calls are recorded and then stay pending forever, ignoring the abort
 * signal, so a test can prove the caller enforces its own timeout.
 */
export function createFixtureExecutor() {
  const queues: Record<FixtureMethod, unknown[]> = {
    run: [],
    listOptions: [],
    testConnection: [],
    revoke: [],
  };
  const calls: FixtureCall[] = [];
  const state = { neverSettle: false };

  function respond(method: FixtureMethod, call: Omit<FixtureCall, "method">) {
    calls.push({ method, ...call });
    if (state.neverSettle) return new Promise<never>(() => {});

    const queue = queues[method];
    if (queue.length === 0) return Promise.resolve(DEFAULT_RESPONSES[method]);

    const next = queue.shift();
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  }

  const executor: NativeIntegrationExecutor = {
    run: (conn, payload, { signal }) =>
      respond("run", { conn, payload, signal }) as Promise<unknown>,
    parseResult: (raw) => parseIntegrationCallResult(raw),
    listOptions: (conn, argKey, parents, { signal }) =>
      respond("listOptions", {
        conn,
        argKey,
        parents,
        signal,
      }) as ReturnType<NativeIntegrationExecutor["listOptions"]>,
    testConnection: (cred, { signal }) =>
      respond("testConnection", {
        conn: cred,
        signal,
      }) as Promise<void>,
    revoke: (conn, { signal }) =>
      respond("revoke", { conn, signal }) as Promise<void>,
    buildAuthorizeUrl: ({ returnUrl }) =>
      `https://fixture.invalid/authorize?return=${encodeURIComponent(returnUrl)}`,
  };

  return {
    executor,
    calls,
    enqueue: (method: FixtureMethod, ...items: unknown[]) => {
      queues[method].push(...items);
    },
    setNeverSettle: (value: boolean) => {
      state.neverSettle = value;
    },
  };
}

// MCP tools answer with content blocks; the fixture tool puts its JSON result
// in the first text block.
export function fixtureMcpResultParser(
  raw: unknown,
): IntegrationCallResult | null {
  const text = getFirstTextBlock(raw);
  if (!text) return null;

  try {
    return parseIntegrationCallResult(JSON.parse(text));
  } catch {
    return null;
  }
}

const DEFAULT_RESPONSES: Record<FixtureMethod, unknown> = {
  run: { externalId: "fixture-item-1", url: "https://fixture.invalid/items/1" },
  listOptions: [],
  testConnection: undefined,
  revoke: undefined,
};

function getFirstTextBlock(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;

  const content = (raw as { content?: unknown }).content;
  if (!Array.isArray(content)) return null;

  const block = content.find(
    (item): item is { type: "text"; text: string } =>
      !!item && item.type === "text" && typeof item.text === "string",
  );
  return block?.text ?? null;
}
