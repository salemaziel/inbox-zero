"use server";

import { env } from "@/env";
import { actionClientUser } from "@/utils/actions/safe-action";
import {
  aiSubscriptionProviderBody,
  submitAiSubscriptionCodeBody,
} from "@/utils/actions/ai-subscription.validation";
import { Prisma } from "@/generated/prisma/client";
import { SafeError } from "@/utils/error";
import { parseAiTaskModels } from "@/utils/llms/config";
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

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { aiProvider: true, aiTaskModels: true },
    });
    if (!user) return;

    const taskModels = parseAiTaskModels(user.aiTaskModels).models;
    const remainingTaskModels = Object.fromEntries(
      Object.entries(taskModels).filter(
        ([, entry]) => entry && entry.provider !== provider,
      ),
    );
    const usedProvider = user.aiProvider === provider;
    const usedInTasks =
      Object.keys(remainingTaskModels).length !==
      Object.keys(taskModels).length;
    if (!usedProvider && !usedInTasks) return;

    await prisma.user.update({
      where: { id: userId },
      data: {
        ...(usedProvider && {
          aiProvider: null,
          aiModel: null,
          aiApiKey: null,
        }),
        aiTaskModels: Object.keys(remainingTaskModels).length
          ? remainingTaskModels
          : Prisma.DbNull,
      },
    });
  });

function assertModelSettingsEnabled() {
  if (env.NEXT_PUBLIC_AI_MODEL_SETTINGS_DISABLED) {
    throw new SafeError("AI model settings are managed by the deployment.");
  }
}
