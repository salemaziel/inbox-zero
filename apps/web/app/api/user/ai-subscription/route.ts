import { NextResponse } from "next/server";
import { env } from "@/env";
import { SafeError } from "@/utils/error";
import {
  CLI_SUBSCRIPTION_PROVIDERS,
  isCliLlmOwner,
} from "@/utils/llms/cli-provider";
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

  const canUseServerLogin = isCliLlmOwner(user);
  const models = await getAllSubscriptionModels({
    userId,
    allowServerLogin: canUseServerLogin,
  });

  return {
    enabled: env.CLI_LLM_ENABLED,
    canUseServerLogin,
    // The models and thinking levels each subscription can be set to.
    models,
    providers: CLI_SUBSCRIPTION_PROVIDERS.map((provider) => ({
      provider,
      login: logins.find((login) => login.provider === provider) ?? null,
      session: getSubscriptionLogin({ userId, provider }),
    })),
  };
}
