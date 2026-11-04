import { randomUUID } from "node:crypto";
import { asSchema } from "ai";
import { SafeError } from "@/utils/error";
import { getFactory } from "@/utils/llms/cli-provider";
import { Provider } from "@/utils/llms/config";
import type { ReasoningEffort } from "@/utils/llms/subscription-config";
import type { McpBridgedTool } from "@/utils/llms/subscription-run";
import { createScopedLogger } from "@/utils/logger";

// The tools served to Codex over the bridge, as the local MCP server in
// ai-sdk-provider-codex-cli expects them.
type CodexMcpTool = {
  name: string;
  description?: string;
  inputSchema: unknown;
  execute: (input: unknown) => Promise<unknown>;
};

type CodexMcpServerFactory = (options: {
  name: string;
  tools: CodexMcpTool[];
}) => Promise<{
  config: { transport: "http"; url: string; bearerToken: string };
  stop: () => Promise<void>;
}>;

const logger = createScopedLogger("llms/cli-provider");

// The MCP server that serves Inbox Zero's own tools to a CLI run.
export const CLI_TOOLS_MCP_SERVER_NAME = "inboxzero";

// Serves the bridged tools to one Codex run over a local MCP server and
// builds the run's model with only those tools enabled.
export async function buildCodexBridgedModel({
  module,
  modelName,
  tools,
  run,
  runSettings,
  reasoningEffort,
  maxCallMs,
  stopWaitMs,
}: {
  module: Record<string, unknown>;
  modelName: string;
  tools: Record<string, McpBridgedTool>;
  run: { abortSignal: AbortSignal };
  // The base Codex settings for this run.
  runSettings: Record<string, unknown>;
  reasoningEffort?: ReasoningEffort | null;
  maxCallMs: number;
  stopWaitMs: number;
}) {
  const provider = Provider.CODEX_CLI;
  const toolNames = Object.keys(tools);
  const createServer = getFactory(
    module,
    "createLocalMcpServer",
    provider,
  ) as unknown as CodexMcpServerFactory;
  const bridge = await toCodexMcpTools(tools, run.abortSignal, maxCallMs);
  const server = await createServer({
    name: CLI_TOOLS_MCP_SERVER_NAME,
    tools: bridge.tools,
  });
  try {
    const model = getFactory(
      module,
      "codexExec",
      provider,
    )(modelName, {
      ...runSettings,
      ...(reasoningEffort ? { reasoningEffort } : {}),
      mcpServers: {
        [CLI_TOOLS_MCP_SERVER_NAME]: {
          ...server.config,
          enabledTools: toolNames,
        },
      },
      // Codex asks before calling an MCP tool that isn't marked
      // read-only, and with approvals off that ask is declined. Only
      // this server's tools are approved up front.
      configOverrides: {
        [`mcp_servers.${CLI_TOOLS_MCP_SERVER_NAME}.default_tools_approval_mode`]:
          "approve",
      },
    });
    return {
      model,
      mapPart: toBridgedCodexPart,
      // Closing the server does not stop a tool call it is running,
      // so those are waited for in full before the run is freed.
      close: async () => {
        await bridge.settle();
        await Promise.race([server.stop(), sleep(stopWaitMs)]);
      },
    };
  } catch (error) {
    await bridge.settle();
    await server.stop();
    throw error;
  }
}

export function parseCodexMcpPayload(
  value: unknown,
): { server?: unknown; tool?: unknown; arguments?: unknown } | null {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  return parsed && typeof parsed === "object"
    ? (parsed as { server?: unknown; tool?: unknown; arguments?: unknown })
    : null;
}

// Inputs are checked against each tool's own schema before it runs, as the
// AI SDK would; the local MCP server passes arguments through unchecked.
// Each call gets an abort signal that fires when the run stops or ends, no
// new call starts after that, and `settle` resolves once every started call
// has finished.
async function toCodexMcpTools(
  tools: Record<string, McpBridgedTool>,
  runSignal: AbortSignal,
  maxCallMs: number,
): Promise<{ tools: CodexMcpTool[]; settle: () => Promise<void> }> {
  const ended = new AbortController();
  const abortSignal = AbortSignal.any([runSignal, ended.signal]);
  const inFlight = new Set<Promise<unknown>>();

  const bridged = await Promise.all(
    Object.entries(tools).map(async ([name, tool]) => {
      const execute = tool.execute;
      if (typeof execute !== "function") {
        throw new SafeError(
          `Tool "${name}" has no execute function, so it cannot be bridged to the CLI.`,
        );
      }
      const schema = asSchema(
        tool.inputSchema as Parameters<typeof asSchema>[0],
      );
      return {
        name,
        description:
          typeof tool.description === "string" ? tool.description : undefined,
        inputSchema: await schema.jsonSchema,
        execute: (input: unknown) => {
          if (abortSignal.aborted) {
            return Promise.reject(
              new Error(`Tool "${name}" was not run: this AI run has stopped.`),
            );
          }
          const call = (async () => {
            const parsed = schema.validate
              ? await schema.validate(input ?? {})
              : { success: true as const, value: input };
            if (!parsed.success) {
              throw new Error(
                `Invalid input for tool "${name}": ${parsed.error.message}`,
              );
            }
            return execute.call(tool, parsed.value as never, {
              toolCallId: randomUUID(),
              messages: [],
              abortSignal,
            });
          })();
          inFlight.add(call);
          const forget = () => inFlight.delete(call);
          call.then(forget, forget);
          return call;
        },
      };
    }),
  );

  return {
    tools: bridged,
    settle: async () => {
      ended.abort(new Error("The AI run has ended."));
      if (inFlight.size === 0) return;
      // Past the hard cap the run is freed anyway so the user's queue is not
      // stuck behind a tool that never settles.
      const settled = await Promise.race([
        Promise.allSettled([...inFlight]).then(() => true),
        sleep(maxCallMs).then(() => false),
      ]);
      if (!settled) {
        logger.error("Bridged tool call never settled; freeing its run anyway");
      }
    },
  };
}

// Codex reports each MCP call as a provider-executed tool call whose input is
// `{server, tool, status, arguments}` and whose result wraps the MCP reply.
// For calls to the Inbox Zero server, callers get the tool's own input and
// output instead, the same shape the Claude Code bridge produces.
function toBridgedCodexPart(part: unknown): unknown {
  if (!part || typeof part !== "object") return part;
  const record = part as Record<string, unknown>;

  switch (record.type) {
    case "tool-call": {
      const call = parseCodexMcpPayload(record.input);
      if (call?.server !== CLI_TOOLS_MCP_SERVER_NAME) return part;
      return { ...record, input: JSON.stringify(call.arguments ?? {}) };
    }
    case "tool-input-delta": {
      const call = parseCodexMcpPayload(record.delta);
      if (call?.server !== CLI_TOOLS_MCP_SERVER_NAME) return part;
      return { ...record, delta: JSON.stringify(call.arguments ?? {}) };
    }
    case "tool-result": {
      const outcome = record.result as {
        server?: unknown;
        result?: { content?: unknown; isError?: unknown };
        error?: unknown;
      } | null;
      if (outcome?.server !== CLI_TOOLS_MCP_SERVER_NAME) return part;
      if (outcome.error !== undefined && outcome.error !== null) {
        return {
          ...record,
          result: describeMcpError(outcome.error),
          isError: true,
        };
      }
      return {
        ...record,
        result: parseMcpContent(outcome.result?.content) ?? "",
        ...(outcome.result?.isError === true ? { isError: true } : {}),
      };
    }
    default:
      return part;
  }
}

// The tool's output was sent as one JSON text block; read it back.
function parseMcpContent(content: unknown): unknown {
  if (!Array.isArray(content)) return content;
  const texts = content
    .filter(
      (block): block is { type: "text"; text: string } =>
        block?.type === "text" && typeof block.text === "string",
    )
    .map((block) => block.text);
  if (texts.length !== content.length) return content;
  const text = texts.join("\n");
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function describeMcpError(error: unknown): string {
  if (typeof error === "string") return error;
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" ? message : JSON.stringify(error);
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });
}
