import { NextResponse } from "next/server";
import { env } from "@/env";
import { SafeError } from "@/utils/error";
import { hasDeploymentModel } from "@/utils/llms/model";
import {
  getSharedRequestsUsedToday,
  isCliLlmOwner,
  isCliLlmSharedUser,
} from "@/utils/llms/subscription-access";
import { CLI_SUBSCRIPTION_PROVIDERS } from "@/utils/llms/subscription-config";
import { getSubscriptionLogin } from "@/utils/llms/subscription-login";
import { getAllSubscriptionModels } from "@/utils/llms/subscription-models";
import { withAuth } from "@/utils/middleware";
import prisma from "@/utils/prisma";

export type GetAiSubscriptionResponse = Awaited<
  ReturnType<typeof getAiSubscriptions>
>;

export const GET = withAuth("user/ai-subscription", async (request) =>
  NextResponse.json(await getAiSubscriptions({ userId: request.auth.userId })),
);

async function getAiSubscriptions({ userId }: { userId: string }) {
  const [user, logins] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        emailVerified: true,
      },
    }),
    prisma.aiSubscriptionLogin.findMany({
      where: { userId },
      select: {
        provider: true,
        status: true,
        lastError: true,
        connectedAt: true,
      },
    }),
  ]);
  if (!user) throw new SafeError("User not found");

  const isOwner = isCliLlmOwner(user);
  const isSharedUser = env.CLI_LLM_ENABLED && isCliLlmSharedUser(user);
  const canUseServerLogin = isOwner || isSharedUser;
  const [models, sharedRequestsUsedToday] = await Promise.all([
    getAllSubscriptionModels({ userId, allowServerLogin: canUseServerLogin }),
    isSharedUser ? getSharedRequestsUsedToday(userId) : null,
  ]);

  return {
    enabled: env.CLI_LLM_ENABLED,
    canUseServerLogin,
    // Approved to share the server's login, up to a daily limit.
    sharedAccess:
      sharedRequestsUsedToday === null
        ? null
        : {
            dailyLimit: env.CLI_LLM_SHARED_DAILY_LIMIT,
            usedToday: sharedRequestsUsedToday,
          },
    // Shared users only get the server's login after opting in, so this is
    // what they'd have without it.
    hasDeploymentModel: hasDeploymentModel(isOwner),
    // The models and thinking levels each subscription can be set to.
    models,
    providers: CLI_SUBSCRIPTION_PROVIDERS.map((provider) => ({
      provider,
      login: logins.find((login) => login.provider === provider) ?? null,
      session: getSubscriptionLogin({ userId, provider }),
    })),
  };
}
