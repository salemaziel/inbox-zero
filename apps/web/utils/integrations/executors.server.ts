import "server-only";
import type { IntegrationCallResult } from "@/utils/integrations/result";
import { trelloExecutor } from "@/utils/integrations/trello.server";
import type { NativeIntegrationExecutor } from "@/utils/integrations/types";

type McpResultParser = (raw: unknown) => IntegrationCallResult | null;

const NATIVE_EXECUTORS: Record<string, NativeIntegrationExecutor> = {
  trello: trelloExecutor,
};

const MCP_RESULT_PARSERS: Record<string, Record<string, McpResultParser>> = {};

export function getNativeExecutor(
  name: string,
): NativeIntegrationExecutor | undefined {
  return Object.hasOwn(NATIVE_EXECUTORS, name)
    ? NATIVE_EXECUTORS[name]
    : undefined;
}

// A native app is offered only when it has an executor and the server has the
// settings that executor needs.
export function isNativeIntegrationConfigured(name: string): boolean {
  const executor = getNativeExecutor(name);
  return !!executor && (executor.isConfigured?.() ?? true);
}

export function getMcpResultParser(
  name: string,
  tool: string,
): McpResultParser | undefined {
  const parsers = Object.hasOwn(MCP_RESULT_PARSERS, name)
    ? MCP_RESULT_PARSERS[name]
    : undefined;
  return parsers && Object.hasOwn(parsers, tool) ? parsers[tool] : undefined;
}
