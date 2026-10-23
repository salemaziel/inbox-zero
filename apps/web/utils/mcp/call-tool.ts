import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { MAX_PROVIDER_MESSAGE_LENGTH } from "@/utils/integrations/provider-message";
import {
  IntegrationError,
  type IntegrationErrorKind,
} from "@/utils/integrations/types";
import { getIntegration, type IntegrationKey } from "@/utils/mcp/integrations";
import { getIntegrationRemoteSelectTools } from "@/utils/mcp/tool-specs";
import { createMcpTransport } from "@/utils/mcp/transport";
import { getMcpServerConnection } from "@/utils/mcp/server-connection";
import { createScopedLogger } from "@/utils/logger";
import prisma from "@/utils/prisma";

const logger = createScopedLogger("mcp-call-tool");

type CallStage = "allowlist" | "connection" | "connect" | "call";

export async function callMcpTool({
  emailAccountId,
  integration,
  toolName,
  args,
  signal,
}: {
  emailAccountId: string;
  integration: IntegrationKey;
  toolName: string;
  args: Record<string, unknown>;
  signal?: AbortSignal;
}) {
  const integrationConfig = getIntegration(integration);

  let stage: CallStage = "allowlist";
  let client: Client | undefined;
  let transport: ReturnType<typeof createMcpTransport> | undefined;

  try {
    // Write tools come from the registry; the read tools the app calls itself are
    // derived from the specs that declare them, so the two cannot drift apart.
    const callableTools = [
      ...(integrationConfig.ruleActionWriteTools ?? []),
      ...getIntegrationRemoteSelectTools(integration),
    ];
    if (!callableTools.includes(toolName)) {
      throw new Error(`Tool ${toolName} is not callable for ${integration}`);
    }

    stage = "connection";
    const connection = await getMcpServerConnection(
      { ...integrationConfig, isCustom: false },
      emailAccountId,
    );

    stage = "connect";
    transport = createMcpTransport(connection);
    client = new Client({
      name: `inbox-zero-${integration}`,
      version: "1.0.0",
    });
    await client.connect(transport, { signal });

    stage = "call";
    const result = await client.callTool(
      { name: toolName, arguments: args },
      undefined,
      { signal },
    );

    if (result.isError) {
      throw new IntegrationError({
        kind: "permanent",
        message: "MCP tool returned an error",
        providerMessage: getToolErrorText(result.content),
      });
    }

    logger.info("Called MCP tool", { integration, toolName });

    return result.content;
  } catch (error) {
    const kind =
      getHttpStatusKind(error) ??
      (error instanceof IntegrationError
        ? error.kind
        : await getStageKind({
            stage,
            integrationConfig,
            emailAccountId,
          }));

    logger.error("Failed to call MCP tool", {
      integration,
      toolName,
      kind,
      errorType: error instanceof Error ? error.name : typeof error,
    });
    logger.trace("MCP tool call failure details", () => ({ error }));

    throw new IntegrationError({
      kind,
      message: `Failed to call ${integration} tool ${toolName}`,
      providerMessage:
        error instanceof IntegrationError ? error.providerMessage : undefined,
      cause: error,
    });
  } finally {
    await client?.close();
    await transport?.close();
  }
}

async function getStageKind({
  stage,
  integrationConfig,
  emailAccountId,
}: {
  stage: CallStage;
  integrationConfig: ReturnType<typeof getIntegration>;
  emailAccountId: string;
}): Promise<IntegrationErrorKind> {
  switch (stage) {
    case "allowlist":
      return "permanent";
    case "connection":
      return getConnectionFailureKind({ integrationConfig, emailAccountId });
    case "connect":
      return "not_sent";
    case "call":
      return "maybe_sent";
  }
}

// Token lookup and refresh failures surface as plain errors, so the stored
// connection state is what tells a credential problem from a transient one.
async function getConnectionFailureKind({
  integrationConfig,
  emailAccountId,
}: {
  integrationConfig: ReturnType<typeof getIntegration>;
  emailAccountId: string;
}): Promise<IntegrationErrorKind> {
  // Hosted-provider setup uses the platform key, not a per-mailbox connection
  if (integrationConfig.provider) return "not_sent";

  const connection = await prisma.mcpConnection
    .findFirst({
      where: { emailAccountId, integration: { name: integrationConfig.name } },
      select: {
        isActive: true,
        accessToken: true,
        apiKey: true,
      },
    })
    .catch(() => undefined);

  // The lookup itself failed, so nothing points at the credentials
  if (connection === undefined) return "not_sent";
  if (!connection?.isActive) return "auth";

  if (integrationConfig.authType === "api-token") {
    return connection.apiKey ? "not_sent" : "auth";
  }

  // An expired token on a still-active connection means the refresh failed for
  // a transient reason: the OAuth layer deactivates on every definite failure.
  return connection.accessToken ? "not_sent" : "auth";
}

function getHttpStatusKind(error: unknown): IntegrationErrorKind | null {
  let current = error;
  while (current instanceof Error) {
    if (current instanceof StreamableHTTPError) {
      if (current.code === 401 || current.code === 403) return "auth";
      if (current.code === 429) return "rate_limit";
    }
    current = current.cause;
  }
  return null;
}

function getToolErrorText(content: unknown): string | undefined {
  if (!Array.isArray(content)) return;

  const text = content
    .flatMap((item) =>
      item?.type === "text" && typeof item.text === "string" ? [item.text] : [],
    )
    .join("\n")
    .trim();

  return text ? text.slice(0, MAX_PROVIDER_MESSAGE_LENGTH) : undefined;
}
