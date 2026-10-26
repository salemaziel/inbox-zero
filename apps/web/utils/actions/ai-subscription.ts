"use server";

import { env } from "@/env";
import { actionClientUser } from "@/utils/actions/safe-action";
import {
  aiSubscriptionProviderBody,
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
  .action(async ({ ctx: { userId }, parsedInput: { provider } }) =>
    startSubscriptionLogin({ userId, provider }),
  );

export const submitAiSubscriptionLoginCodeAction = actionClientUser
  .metadata({ name: "submitAiSubscriptionLoginCode" })
  .inputSchema(submitAiSubscriptionCodeBody)
  .action(async ({ ctx: { userId }, parsedInput: { code } }) => {
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
  .inputSchema(aiSubscriptionProviderBody)
  .action(async ({ ctx: { userId }, parsedInput: { provider } }) => {
    if (env.NEXT_PUBLIC_AI_MODEL_SETTINGS_DISABLED) {
      throw new SafeError("AI model settings are managed by the deployment.");
    }

    const login = await prisma.aiSubscriptionLogin.findUnique({
      where: { userId_provider: { userId, provider } },
      select: { status: true },
    });
    if (login?.status !== "connected") {
      throw new SafeError("Connect this account before using it.");
    }

    // A null model uses the provider's default from utils/llms/model.ts.
    await prisma.user.update({
      where: { id: userId },
      data: { aiProvider: provider, aiModel: null, aiApiKey: null },
    });
  });
