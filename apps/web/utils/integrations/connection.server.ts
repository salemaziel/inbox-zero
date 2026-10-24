import "server-only";
import { SafeError } from "@/utils/error";
import { isIntegrationActionEnabledForUserId } from "@/utils/integration-action.server";
import { runWithCallPolicy } from "@/utils/integrations/call-policy";
import { getNativeExecutor } from "@/utils/integrations/executors.server";
import {
  IntegrationError,
  type NativeConnection,
  type NativeIntegrationExecutor,
} from "@/utils/integrations/types";
import type { Logger } from "@/utils/logger";
import {
  findIntegration,
  type IntegrationKey,
  type MCP_INTEGRATIONS,
} from "@/utils/mcp/integrations";
import { assertIntegrationsTierAccess } from "@/utils/mcp/tier-access";
import {
  generateSignedOAuthState,
  validateSignedOAuthState,
} from "@/utils/oauth/state";
import { prefixPath } from "@/utils/path";
import prisma from "@/utils/prisma";

const MAX_TOKEN_LENGTH = 4096;
const TOKEN_REJECTED_MESSAGE =
  "That token didn't work. Check it and try again.";
const WRONG_CONNECT_KIND_MESSAGE =
  "This integration can't be connected with a token.";
const INVALID_STATE_MESSAGE =
  "This connection link expired or doesn't match. Start again from the Integrations page.";

export async function getActiveNativeConnection({
  emailAccountId,
  integrationName,
}: {
  emailAccountId: string;
  integrationName: string;
}): Promise<NativeConnection | null> {
  const connection = await prisma.mcpConnection.findFirst({
    where: {
      emailAccountId,
      isActive: true,
      integration: { name: integrationName },
    },
    select: { id: true, emailAccountId: true, accessToken: true },
  });

  if (!connection?.emailAccountId || !connection.accessToken) return null;

  return {
    id: connection.id,
    emailAccountId: connection.emailAccountId,
    accessToken: connection.accessToken,
  };
}

export async function deactivateIntegrationConnection({
  emailAccountId,
  integrationName,
}: {
  emailAccountId: string;
  integrationName: string;
}): Promise<void> {
  await prisma.mcpConnection.updateMany({
    where: { emailAccountId, integration: { name: integrationName } },
    data: { isActive: false },
  });
}

// Hosted-provider integrations authenticate with the platform key, so their
// auth failures say nothing about this mailbox's connection.
export async function deactivateConnectionOnAuthFailure({
  error,
  integration,
  emailAccountId,
  logger,
}: {
  error: unknown;
  integration: (typeof MCP_INTEGRATIONS)[IntegrationKey];
  emailAccountId: string;
  logger: Logger;
}): Promise<void> {
  if (!(error instanceof IntegrationError) || error.kind !== "auth") return;
  if (integration.provider) return;

  await deactivateIntegrationConnection({
    emailAccountId,
    integrationName: integration.name,
  }).catch((deactivateError) => {
    logger.warn("Failed to deactivate integration connection", {
      integration: integration.name,
      errorType:
        deactivateError instanceof Error
          ? deactivateError.name
          : typeof deactivateError,
    });
  });
}

export async function connectWithToken({
  userId,
  emailAccountId,
  integrationName,
  token,
  logger,
}: {
  userId: string;
  emailAccountId: string;
  integrationName: string;
  token: string;
  logger: Logger;
}): Promise<void> {
  const accessToken = normalizeToken(token);
  await assertIntegrationsTierAccess({ userId, logger });
  await assertIntegrationActionsEnabled(userId);
  const { executor, displayName } = getTokenConnectTarget(
    integrationName,
    "api-token-paste",
  );

  await testAndStoreToken({
    emailAccountId,
    integrationName,
    displayName,
    executor,
    accessToken,
    logger,
  });
}

export async function createTokenRedirect({
  userId,
  emailAccountId,
  integrationName,
  baseUrl,
  logger,
}: {
  userId: string;
  emailAccountId: string;
  integrationName: string;
  baseUrl: string;
  logger: Logger;
}): Promise<{ url: string; state: string; cookieName: string }> {
  await assertIntegrationsTierAccess({ userId, logger });
  await assertIntegrationActionsEnabled(userId);
  const { executor } = getTokenConnectTarget(integrationName, "token-redirect");
  if (!executor.buildAuthorizeUrl) {
    throw new SafeError(WRONG_CONNECT_KIND_MESSAGE);
  }

  const state = generateSignedOAuthState({
    userId,
    emailAccountId,
    type: getRedirectStateType(integrationName),
  });

  const returnUrl = new URL(
    prefixPath(emailAccountId, `/integrations/connect/${integrationName}`),
    baseUrl,
  );
  returnUrl.searchParams.set("state", state);

  return {
    url: executor.buildAuthorizeUrl({ returnUrl: returnUrl.toString() }),
    state,
    cookieName: getTokenRedirectCookieName(integrationName),
  };
}

export function getTokenRedirectCookieName(integrationName: string) {
  return `native-integration-state-${integrationName}`;
}

export async function completeTokenRedirect({
  userId,
  emailAccountId,
  integrationName,
  state,
  cookieState,
  token,
  logger,
}: {
  userId: string;
  emailAccountId: string;
  integrationName: string;
  state: string;
  cookieState: string | undefined;
  token: string;
  logger: Logger;
}): Promise<void> {
  const validation = validateSignedOAuthState<{
    userId?: unknown;
    emailAccountId?: unknown;
    type?: unknown;
  }>({ receivedState: state, storedState: cookieState });

  if (
    !validation.success ||
    validation.state.userId !== userId ||
    validation.state.emailAccountId !== emailAccountId ||
    validation.state.type !== getRedirectStateType(integrationName)
  ) {
    logger.warn("Integration redirect state rejected", {
      integrationName,
      hasCookieState: !!cookieState,
      error: validation.success ? "state_mismatch" : validation.error,
    });
    throw new SafeError(INVALID_STATE_MESSAGE);
  }

  const accessToken = normalizeToken(token);
  await assertIntegrationActionsEnabled(userId);
  const { executor, displayName } = getTokenConnectTarget(
    integrationName,
    "token-redirect",
  );

  await testAndStoreToken({
    emailAccountId,
    integrationName,
    displayName,
    executor,
    accessToken,
    logger,
  });
}

function normalizeToken(token: string): string {
  const accessToken = token.trim();
  if (!accessToken || accessToken.length > MAX_TOKEN_LENGTH) {
    throw new SafeError(TOKEN_REJECTED_MESSAGE);
  }
  return accessToken;
}

// Native apps are hidden from the Integrations page while the feature is off,
// so a direct call must not be able to connect one either.
async function assertIntegrationActionsEnabled(userId: string) {
  if (!(await isIntegrationActionEnabledForUserId(userId))) {
    throw new SafeError(WRONG_CONNECT_KIND_MESSAGE);
  }
}

function getTokenConnectTarget(
  integrationName: string,
  connectKind: "api-token-paste" | "token-redirect",
): { executor: NativeIntegrationExecutor; displayName: string } {
  const entry = findIntegration(integrationName);
  const executor = getNativeExecutor(integrationName);

  if (
    entry?.execution !== "native" ||
    entry.connectKind !== connectKind ||
    !executor
  ) {
    throw new SafeError(WRONG_CONNECT_KIND_MESSAGE);
  }
  if (executor.isConfigured && !executor.isConfigured()) {
    throw new SafeError(`${entry.displayName} isn't set up on this server.`);
  }

  return { executor, displayName: entry.displayName };
}

async function testAndStoreToken({
  emailAccountId,
  integrationName,
  displayName,
  executor,
  accessToken,
  logger,
}: {
  emailAccountId: string;
  integrationName: string;
  displayName: string;
  executor: NativeIntegrationExecutor;
  accessToken: string;
  logger: Logger;
}): Promise<void> {
  try {
    await runWithCallPolicy(
      (signal) => executor.testConnection({ accessToken }, { signal }),
      { mode: "read" },
    );
  } catch (error) {
    const kind = error instanceof IntegrationError ? error.kind : "unknown";
    logger.warn("Integration token test failed", { integrationName, kind });

    // Only a definite answer from the app says the token is bad; a timeout or
    // outage would make that message wrong.
    if (kind === "auth" || kind === "permanent") {
      throw new SafeError(TOKEN_REJECTED_MESSAGE);
    }
    if (kind === "rate_limit") {
      throw new SafeError(
        `${displayName} is limiting requests right now. Try again in a minute.`,
      );
    }
    throw new SafeError(
      `Couldn't reach ${displayName} to check the token. Try again in a moment.`,
    );
  }

  const integration = await prisma.mcpIntegration.upsert({
    where: { name: integrationName },
    update: {},
    create: { name: integrationName },
    select: { id: true },
  });

  await prisma.mcpConnection.upsert({
    where: {
      emailAccountId_integrationId: {
        emailAccountId,
        integrationId: integration.id,
      },
    },
    update: { accessToken, isActive: true },
    create: {
      name: displayName,
      emailAccountId,
      integrationId: integration.id,
      accessToken,
      isActive: true,
    },
  });

  logger.info("Integration connected with token", { integrationName });
}

function getRedirectStateType(integrationName: string) {
  return `native-integration:${integrationName}`;
}
