import "server-only";
import { SafeError } from "@/utils/error";
import { runWithCallPolicy } from "@/utils/integrations/call-policy";
import {
  deactivateIntegrationConnection,
  getActiveNativeConnection,
} from "@/utils/integrations/connection.server";
import { getNativeExecutor } from "@/utils/integrations/executors.server";
import { IntegrationError } from "@/utils/integrations/types";
import type { Logger } from "@/utils/logger";
import { callMcpTool } from "@/utils/mcp/call-tool";
import { findIntegration } from "@/utils/mcp/integrations";
import {
  getRemoteSelectArg,
  type IntegrationArgOption,
} from "@/utils/mcp/tool-specs";

const MAX_PARENT_VALUE_LENGTH = 500;

export async function getIntegrationArgOptions({
  emailAccountId,
  integration,
  tool,
  argKey,
  parents = {},
  logger,
}: {
  emailAccountId: string;
  integration: string;
  tool: string | null;
  argKey: string | null;
  parents?: Record<string, string>;
  logger: Logger;
}): Promise<{ options: IntegrationArgOption[] }> {
  // Never trust the URL: the integration and the arg must both be declared.
  const entry = findIntegration(integration);
  if (!entry) throw new SafeError("Unknown integration");

  const remoteSelect = getRemoteSelectArg({ integration, tool, argKey });
  if (!remoteSelect || !argKey) {
    throw new SafeError("Unknown integration argument");
  }

  const { control } = remoteSelect;
  assertParentsMatch(parents, control.dependsOn ?? []);

  try {
    if (control.source !== "native") {
      const content = await runWithCallPolicy(
        (signal) =>
          callMcpTool({
            emailAccountId,
            integration,
            toolName: control.optionsTool,
            args: control.buildOptionsArgs?.(parents) ?? {},
            signal,
          }),
        { mode: "read" },
      );

      return { options: control.parseOptions(content) };
    }

    const executor = getNativeExecutor(integration);
    const connection = await getActiveNativeConnection({
      emailAccountId,
      integrationName: integration,
    });
    if (!executor || !connection) {
      throw new SafeError("Integration is not connected");
    }

    const options = await runWithCallPolicy(
      (signal) => executor.listOptions(connection, argKey, parents, { signal }),
      { mode: "read" },
    );

    return { options };
  } catch (error) {
    if (error instanceof IntegrationError && error.kind === "auth") {
      // Hosted-provider integrations use the platform key, not this mailbox's connection
      if (!entry.provider) {
        await deactivateIntegrationConnection({
          emailAccountId,
          integrationName: integration,
        }).catch((deactivateError) => {
          logger.warn("Failed to deactivate integration connection", {
            integration,
            errorType:
              deactivateError instanceof Error
                ? deactivateError.name
                : typeof deactivateError,
          });
        });
      }
    }
    throw error;
  }
}

function assertParentsMatch(
  parents: Record<string, string>,
  dependsOn: readonly string[],
) {
  const keys = Object.keys(parents);

  if (keys.some((key) => !dependsOn.includes(key))) {
    throw new SafeError("Unexpected parent value");
  }

  for (const key of dependsOn) {
    const value = Object.hasOwn(parents, key) ? parents[key] : undefined;
    if (!value?.trim()) throw new SafeError(`Missing parent value: ${key}`);
    if (value.length > MAX_PARENT_VALUE_LENGTH) {
      throw new SafeError(`Parent value too long: ${key}`);
    }
  }
}
