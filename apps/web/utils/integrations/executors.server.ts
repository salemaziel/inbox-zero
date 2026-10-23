import "server-only";
import type { IntegrationCallResult } from "@/utils/integrations/result";
import type { NativeIntegrationExecutor } from "@/utils/integrations/types";

type McpResultParser = (raw: unknown) => IntegrationCallResult | null;

const NATIVE_EXECUTORS: Record<string, NativeIntegrationExecutor> = {};

const MCP_RESULT_PARSERS: Record<string, Record<string, McpResultParser>> = {};

export function getNativeExecutor(
  name: string,
): NativeIntegrationExecutor | undefined {
  return Object.hasOwn(NATIVE_EXECUTORS, name)
    ? NATIVE_EXECUTORS[name]
    : undefined;
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
