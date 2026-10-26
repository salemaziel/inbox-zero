"use server";

import { env } from "@/env";
import { actionClientUser } from "@/utils/actions/safe-action";
import {
  aiSubscriptionProviderBody,
  selectAiSubscriptionBody,
  submitAiSubscriptionCodeBody,
} from "@/utils/actions/ai-subscription.validation";
import { SafeError } from "@/utils/error";
import {
  cancelSubscriptionLogin,
  disconnectSubscriptionLogin,
  startSubscriptionLogin,
  submitSubscriptionLoginCode,
} from "@/utils/llms/subscription-login";
import prisma from "@/utils/prisma";

export const startAiSubscriptionLoginAction = actionClientUser
  .metadata({ name: "startAiSubscriptionLogin" })
  .inputSchema(aiSubscriptionProviderBody)
  .action(async ({ ctx: { userId }, parsedInput: { provider } }) => {
    assertModelSettingsEnabled();
    return startSubscriptionLogin({ userId, provider });
  });

export const submitAiSubscriptionLoginCodeAction = actionClientUser
  .metadata({ name: "submitAiSubscriptionLoginCode" })
  .inputSchema(submitAiSubscriptionCodeBody)
  .action(async ({ ctx: { userId }, parsedInput: { code } }) => {
    assertModelSettingsEnabled();
    submitSubscriptionLoginCode({ userId, code });
  });

export const cancelAiSubscriptionLoginAction = actionClientUser
  .metadata({ name: "cancelAiSubscriptionLogin" })
  .inputSchema(aiSubscriptionProviderBody)
  .action(async ({ ctx: { userId }, parsedInput: { provider } }) => {
    await cancelSubscriptionLogin({ userId, provider });
  });

export const disconnectAiSubscriptionAction = actionClientUser
  .metadata({ name: "disconnectAiSubscription" })
  .inputSchema(aiSubscriptionProviderBody)
  .action(async ({ ctx: { userId }, parsedInput: { provider } }) => {
    await disconnectSubscriptionLogin({ userId, provider });
    await prisma.user.updateMany({
      where: { id: userId, aiProvider: provider },
      data: { aiProvider: null, aiModel: null, aiApiKey: null },
    });
  });

export const selectAiSubscriptionAction = actionClientUser
  .metadata({ name: "selectAiSubscription" })
  .inputSchema(selectAiSubscriptionBody)
  .action(async ({ ctx: { userId }, parsedInput: { provider, model } }) => {
    assertModelSettingsEnabled();

    const login = await prisma.aiSubscriptionLogin.findUnique({
      where: { userId_provider: { userId, provider } },
      select: { status: true },
    });
    if (login?.status !== "connected") {
      throw new SafeError("Connect this account before using it.");
    }

    // A null model uses the provider's default from utils/llms/config.ts.
    await prisma.user.update({
      where: { id: userId },
      data: { aiProvider: provider, aiModel: model ?? null, aiApiKey: null },
    });
  });

function assertModelSettingsEnabled() {
  if (env.NEXT_PUBLIC_AI_MODEL_SETTINGS_DISABLED) {
    throw new SafeError("AI model settings are managed by the deployment.");
  }
}
