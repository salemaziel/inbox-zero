import "server-only";
import { runWithCallPolicy } from "@/utils/integrations/call-policy";
import {
  deactivateIntegrationConnection,
  getActiveNativeConnection,
} from "@/utils/integrations/connection.server";
import {
  getMcpResultParser,
  getNativeExecutor,
} from "@/utils/integrations/executors.server";
import {
  type IntegrationCallResult,
  parseIntegrationCallResult,
} from "@/utils/integrations/result";
import {
  IntegrationError,
  type IntegrationErrorKind,
} from "@/utils/integrations/types";
import type { Logger } from "@/utils/logger";
import { callMcpTool } from "@/utils/mcp/call-tool";
import type {
  IntegrationKey,
  MCP_INTEGRATIONS,
} from "@/utils/mcp/integrations";

const MAX_PROVIDER_MESSAGE_LENGTH = 500;

const ERROR_CODES: Record<IntegrationErrorKind, string> = {
  auth: "INTEGRATION_AUTH_FAILED",
  rate_limit: "INTEGRATION_RATE_LIMITED",
  not_sent: "INTEGRATION_NOT_SENT",
  maybe_sent: "INTEGRATION_MAYBE_SENT",
  permanent: "INTEGRATION_CALL_FAILED",
};

type IntegrationActionResult =
  | { success: true; integrationResult: IntegrationCallResult | null }
  | { success: false; errorCode: string; errorMessage: string };

// Never throws: a failure here must fail only this action, not the whole rule run.
export async function runIntegrationAction({
  integrationName,
  toolName,
  integrationConfig,
  payload,
  emailAccountId,
  logger,
}: {
  integrationName: string;
  toolName: string;
  integrationConfig: (typeof MCP_INTEGRATIONS)[IntegrationKey];
  payload: Record<string, unknown>;
  emailAccountId: string;
  messageId: string;
  ruleId: string | null;
  executedRuleId: string;
  logger: Logger;
}): Promise<IntegrationActionResult> {
  const { displayName } = integrationConfig;

  try {
    if (integrationConfig.execution === "native") {
      const connection = await getActiveNativeConnection({
        emailAccountId,
        integrationName,
      });
      if (!connection) {
        return {
          success: false,
          errorCode: "INTEGRATION_NOT_CONNECTED",
          errorMessage: `${displayName} is not connected. Connect it on the Integrations page.`,
        };
      }

      const executor = getNativeExecutor(integrationName);
      if (!executor) {
        return {
          success: false,
          errorCode: "UNSUPPORTED_INTEGRATION_TOOL",
          errorMessage: `Unsupported integration tool: ${integrationName}/${toolName}`,
        };
      }

      const raw = await runWithCallPolicy(
        (signal) => executor.run(connection, payload, { signal }),
        { mode: "write" },
      );

      return {
        success: true,
        integrationResult: parseResult(() => executor.parseResult(raw), {
          integrationName,
          toolName,
          logger,
        }),
      };
    }

    const content = await runWithCallPolicy(
      (signal) =>
        callMcpTool({
          emailAccountId,
          integration: integrationName,
          toolName,
          args: payload,
          signal,
        }),
      { mode: "write" },
    );

    return {
      success: true,
      integrationResult: parseResult(
        () => getMcpResultParser(integrationName, toolName)?.(content) ?? null,
        { integrationName, toolName, logger },
      ),
    };
  } catch (error) {
    const kind = error instanceof IntegrationError ? error.kind : undefined;

    logger.error("Integration action failed", {
      integration: integrationName,
      toolName,
      kind: kind ?? "unexpected",
    });
    logger.trace("Integration action failure details", () => ({ error }));

    if (kind === "auth" && !integrationConfig.provider) {
      // Hosted-provider auth failures may concern the platform key, not this mailbox's connection
      await deactivateIntegrationConnection({
        emailAccountId,
        integrationName,
      }).catch((deactivateError) => {
        logger.warn("Failed to deactivate integration connection", {
          integration: integrationName,
          errorType:
            deactivateError instanceof Error
              ? deactivateError.name
              : typeof deactivateError,
        });
      });
    }

    const providerMessage =
      error instanceof IntegrationError
        ? error.providerMessage?.trim().slice(0, MAX_PROVIDER_MESSAGE_LENGTH)
        : undefined;
    const copy = getOwnerCopy(kind ?? "permanent", displayName);

    return {
      success: false,
      errorCode: ERROR_CODES[kind ?? "permanent"],
      errorMessage: providerMessage
        ? `${copy}\n\n${displayName} said: ${providerMessage}`
        : copy,
    };
  }
}

// The call already succeeded, so a parse failure must not turn it into a failed action.
function parseResult(
  parse: () => IntegrationCallResult | null,
  {
    integrationName,
    toolName,
    logger,
  }: { integrationName: string; toolName: string; logger: Logger },
): IntegrationCallResult | null {
  try {
    return parseIntegrationCallResult(parse());
  } catch (error) {
    logger.warn("Failed to parse integration result", {
      integration: integrationName,
      toolName,
    });
    logger.trace("Integration result parse failure details", () => ({
      error,
    }));
    return null;
  }
}

function getOwnerCopy(kind: IntegrationErrorKind, displayName: string) {
  switch (kind) {
    case "auth":
      return `${displayName} rejected the connection. Reconnect it on the Integrations page.`;
    case "rate_limit":
      return `${displayName} is limiting requests right now, so nothing was created. Try again later.`;
    case "not_sent":
      return `The request never reached ${displayName}, so nothing was created.`;
    case "maybe_sent":
      return `${displayName} didn't confirm the request, so the item may have been created. Check ${displayName} before re-running.`;
    case "permanent":
      return `${displayName} could not complete the request.`;
  }
}
