"use server";

import { actionClient } from "@/utils/actions/safe-action";
import {
  saveAiSettingsBody,
  saveDecisionModelSettingsBody,
  saveSensitiveDataPolicyBody,
  saveEmailUpdateSettingsBody,
  saveDigestScheduleBody,
  updateDigestItemsBody,
  toggleDigestBody,
} from "@/utils/actions/settings.validation";
import { DEFAULT_PROVIDER, Provider } from "@/utils/llms/config";
import {
  CLI_SUBSCRIPTION_PROVIDERS,
  isCliLlmOwner,
  isCliSubscriptionProvider,
} from "@/utils/llms/cli-provider";
import prisma from "@/utils/prisma";
import {
  calculateNextScheduleDate,
  createCanonicalTimeOfDay,
} from "@/utils/schedule";
import { actionClientUser } from "@/utils/actions/safe-action";
import { ActionType, SystemType } from "@/generated/prisma/enums";
import { Prisma } from "@/generated/prisma/client";
import { clearSpecificErrorMessages, ErrorType } from "@/utils/error-messages";
import { SafeError } from "@/utils/error";
import { env } from "@/env";
import { addActionOwnershipToInput } from "@/utils/rule/rule";
import { isSensitiveDataPolicyLocked } from "@/utils/dlp/policy.server";
import { assertCanUseDigests } from "@/utils/premium/server";

export const updateEmailSettingsAction = actionClient
  .metadata({ name: "updateEmailSettings" })
  .inputSchema(saveEmailUpdateSettingsBody)
  .action(
    async ({
      ctx: { emailAccountId },
      parsedInput: { statsEmailFrequency, summaryEmailFrequency },
    }) => {
      await prisma.emailAccount.update({
        where: { id: emailAccountId },
        data: {
          statsEmailFrequency,
          summaryEmailFrequency,
        },
      });
    },
  );

export const updateAiSettingsAction = actionClientUser
  .metadata({ name: "updateAiSettings" })
  .inputSchema(saveAiSettingsBody)
  .action(
    async ({
      ctx: { userId, logger },
      parsedInput: { aiProvider, aiModel, aiApiKey, aiTaskModels },
    }) => {
      if (env.NEXT_PUBLIC_AI_MODEL_SETTINGS_DISABLED) {
        throw new SafeError("AI model settings are managed by the deployment.");
      }

      if (aiProvider === Provider.AZURE && !env.AZURE_RESOURCE_NAME) {
        throw new Error(
          "Azure provider requires AZURE_RESOURCE_NAME to be configured on the server",
        );
      }

      const taskEntries = Object.entries(aiTaskModels ?? {}).filter(
        (pair): pair is [string, { provider: string; model: string }] =>
          !!pair[1],
      );
      const usesCliProvider =
        isCliSubscriptionProvider(aiProvider) ||
        taskEntries.some(([, entry]) =>
          isCliSubscriptionProvider(entry.provider),
        );
      if (usesCliProvider && !env.CLI_LLM_ENABLED) {
        throw new SafeError("AI subscriptions aren't enabled on this server.");
      }
      const usableSubscriptions = usesCliProvider
        ? await getUsableSubscriptionProviders(userId)
        : [];

      if (
        isCliSubscriptionProvider(aiProvider) &&
        !usableSubscriptions.includes(aiProvider)
      ) {
        throw new SafeError("Connect this account before using it.");
      }

      for (const [, entry] of taskEntries) {
        const isMainProvider =
          aiProvider !== DEFAULT_PROVIDER && entry.provider === aiProvider;
        if (!isMainProvider && !usableSubscriptions.includes(entry.provider)) {
          throw new SafeError(
            "Each task can only use your main provider or an AI subscription you've connected.",
          );
        }
      }

      const nextAiTaskModels = taskEntries.length
        ? Object.fromEntries(taskEntries)
        : Prisma.DbNull;

      const providedAiApiKey = aiApiKey?.trim() || null;

      let nextAiApiKey: string | null = providedAiApiKey;

      if (
        !nextAiApiKey &&
        aiProvider !== DEFAULT_PROVIDER &&
        !isCliSubscriptionProvider(aiProvider)
      ) {
        const existingUser = await prisma.user.findUnique({
          where: { id: userId },
          select: { aiProvider: true, aiApiKey: true },
        });

        if (!existingUser) throw new SafeError("User not found");

        nextAiApiKey =
          existingUser.aiProvider === aiProvider ? existingUser.aiApiKey : null;

        if (!nextAiApiKey) {
          throw new SafeError("You must provide an API key for this provider");
        }
      }

      const result = await prisma.user.updateMany({
        where: { id: userId },
        data:
          aiProvider === DEFAULT_PROVIDER
            ? {
                aiProvider: null,
                aiModel: null,
                aiApiKey: null,
                aiTaskModels: nextAiTaskModels,
              }
            : {
                aiProvider,
                aiModel,
                aiApiKey: isCliSubscriptionProvider(aiProvider)
                  ? null
                  : nextAiApiKey,
                aiTaskModels: nextAiTaskModels,
              },
      });

      if (result.count === 0) {
        throw new SafeError("User not found");
      }

      // Clear AI-related error messages when user updates their settings
      // This allows them to be notified again if the new settings are also invalid
      await clearSpecificErrorMessages({
        userId,
        errorTypes: [
          ErrorType.INCORRECT_API_KEY,
          ErrorType.INVALID_AI_MODEL,
          ErrorType.API_KEY_DEACTIVATED,
          ErrorType.AI_QUOTA_ERROR,
          ErrorType.INSUFFICIENT_CREDITS,
          // Legacy keys for old stored errors
          ErrorType.INCORRECT_OPENAI_API_KEY,
          ErrorType.OPENAI_API_KEY_DEACTIVATED,
          ErrorType.ANTHROPIC_INSUFFICIENT_BALANCE,
        ],
        logger,
      });
    },
  );

export const updateDecisionModelSettingsAction = actionClientUser
  .metadata({ name: "updateDecisionModelSettings" })
  .inputSchema(saveDecisionModelSettingsBody)
  .action(
    async ({ ctx: { userId }, parsedInput: { decisionModelEnabled } }) => {
      if (env.NEXT_PUBLIC_AI_MODEL_SETTINGS_DISABLED) {
        throw new SafeError("AI model settings are managed by the deployment.");
      }

      await prisma.user.update({
        where: { id: userId },
        data: { decisionModelEnabled },
      });
    },
  );

export const updateSensitiveDataPolicyAction = actionClient
  .metadata({ name: "updateSensitiveDataPolicy" })
  .inputSchema(saveSensitiveDataPolicyBody)
  .action(
    async ({
      ctx: { emailAccountId },
      parsedInput: { sensitiveDataPolicy },
    }) => {
      if (isSensitiveDataPolicyLocked()) {
        throw new SafeError(
          "Sensitive data protection is managed by the deployment.",
        );
      }

      await prisma.emailAccount.update({
        where: { id: emailAccountId },
        data: { sensitiveDataPolicy },
      });
    },
  );

export const updateDigestScheduleAction = actionClient
  .metadata({ name: "updateDigestSchedule" })
  .inputSchema(saveDigestScheduleBody)
  .action(async ({ ctx: { emailAccountId, userId }, parsedInput }) => {
    await assertCanUseDigests(userId);

    const { intervalDays, daysOfWeek, timeOfDay, occurrences } = parsedInput;

    const create: Prisma.ScheduleUpsertArgs["create"] = {
      emailAccountId,
      intervalDays,
      daysOfWeek,
      timeOfDay,
      occurrences,
      lastOccurrenceAt: new Date(),
      nextOccurrenceAt: calculateNextScheduleDate({
        ...parsedInput,
        lastOccurrenceAt: null,
      }),
    };

    const { emailAccountId: _emailAccountId, ...update } = create;

    const schedule = await prisma.schedule.upsert({
      where: { emailAccountId },
      create,
      update,
    });

    return {
      success: true,
      nextOccurrenceAt: schedule.nextOccurrenceAt?.toISOString() ?? null,
    };
  });

export const updateDigestItemsAction = actionClient
  .metadata({ name: "updateDigestItems" })
  .inputSchema(updateDigestItemsBody)
  .action(
    async ({
      ctx: { emailAccountId, userId, logger },
      parsedInput: { ruleDigestPreferences },
    }) => {
      if (Object.values(ruleDigestPreferences).some(Boolean)) {
        await assertCanUseDigests(userId);
      }

      const promises = Object.entries(ruleDigestPreferences).map(
        async ([ruleId, enabled]) => {
          // Verify the rule belongs to this email account
          const rule = await prisma.rule.findUnique({
            where: {
              id: ruleId,
              emailAccountId,
            },
            select: { id: true, actions: true, organizationRuleId: true },
          });

          if (!rule) {
            logger.error("Rule not found", { ruleId });
            return;
          }

          if (rule.organizationRuleId) return;

          const hasDigestAction = rule.actions.some(
            (action) => action.type === ActionType.DIGEST,
          );

          if (enabled && !hasDigestAction) {
            // Add DIGEST action
            await prisma.action.create({
              data: addActionOwnershipToInput(
                {
                  ruleId: rule.id,
                  type: ActionType.DIGEST,
                },
                emailAccountId,
              ),
            });
          } else if (!enabled && hasDigestAction) {
            // Remove DIGEST action
            await prisma.action.deleteMany({
              where: {
                ruleId: rule.id,
                type: ActionType.DIGEST,
              },
            });
          }
        },
      );

      await Promise.all(promises);
      return { success: true };
    },
  );

export const toggleDigestAction = actionClient
  .metadata({ name: "toggleDigest" })
  .inputSchema(toggleDigestBody)
  .action(
    async ({
      ctx: { emailAccountId, userId },
      parsedInput: { enabled, timeOfDay },
    }) => {
      if (enabled) {
        await assertCanUseDigests(userId);

        const defaultSchedule = {
          intervalDays: 1,
          occurrences: 1,
          daysOfWeek: 127,
          timeOfDay: timeOfDay ?? createCanonicalTimeOfDay(9, 0),
        };

        await prisma.schedule.upsert({
          where: { emailAccountId },
          create: {
            emailAccountId,
            ...defaultSchedule,
            lastOccurrenceAt: new Date(),
            nextOccurrenceAt: calculateNextScheduleDate({
              ...defaultSchedule,
              lastOccurrenceAt: null,
            }),
          },
          update: {},
        });

        const newsletterRule = await prisma.rule.findFirst({
          where: { emailAccountId, systemType: SystemType.NEWSLETTER },
          include: { actions: true },
        });

        if (
          newsletterRule &&
          !newsletterRule.actions.some((a) => a.type === ActionType.DIGEST)
        ) {
          await prisma.action.create({
            data: addActionOwnershipToInput(
              {
                ruleId: newsletterRule.id,
                type: ActionType.DIGEST,
              },
              emailAccountId,
            ),
          });
        }
      } else {
        await prisma.schedule.deleteMany({
          where: { emailAccountId },
        });
      }

      return { success: true };
    },
  );

// The subscriptions the user has connected, or all of them when the user may
// fall back to the server's own login.
async function getUsableSubscriptionProviders(
  userId: string,
): Promise<string[]> {
  const [user, logins] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, emailVerified: true },
    }),
    prisma.aiSubscriptionLogin.findMany({
      where: { userId, status: "connected" },
      select: { provider: true },
    }),
  ]);
  if (user && isCliLlmOwner(user)) return [...CLI_SUBSCRIPTION_PROVIDERS];
  return logins.map((login) => login.provider);
}
