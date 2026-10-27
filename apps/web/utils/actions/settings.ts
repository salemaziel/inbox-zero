"use server";

import { actionClient } from "@/utils/actions/safe-action";
import {
  saveAiSettingsBody,
  saveDecisionModelApiKeyBody,
  saveDecisionModelSettingsBody,
  saveSensitiveDataPolicyBody,
  saveEmailUpdateSettingsBody,
  saveDigestScheduleBody,
  updateDigestItemsBody,
  toggleDigestBody,
} from "@/utils/actions/settings.validation";
import {
  type AiTaskModelEntry,
  type AiTaskModelType,
  DEFAULT_PROVIDER,
  isSubscriptionProvider,
  parseAiTaskModels,
  Provider,
  type ReasoningEffort,
  reasoningEffortSchema,
} from "@/utils/llms/config";
import { getSubscriptionModels } from "@/utils/llms/subscription-models";
import {
  CLI_SUBSCRIPTION_PROVIDERS,
  type CliLoginScope,
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
import { isDecisionModelApiKeyRejected } from "@/utils/decision-model/decision-model";

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
      parsedInput: {
        aiProvider,
        aiModel,
        aiApiKey,
        aiReasoningEffort,
        aiTaskModels,
      },
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
        (pair): pair is [AiTaskModelType, AiTaskModelEntry] => !!pair[1],
      );
      const usesCliProvider =
        isCliSubscriptionProvider(aiProvider) ||
        taskEntries.some(([, entry]) =>
          isCliSubscriptionProvider(entry.provider),
        );
      if (usesCliProvider && !env.CLI_LLM_ENABLED) {
        throw new SafeError("AI subscriptions aren't enabled on this server.");
      }
      const { usableSubscriptions, allowServerLogin } = usesCliProvider
        ? await getSubscriptionAccess(userId)
        : { usableSubscriptions: [], allowServerLogin: false };
      const cliLogin = { userId, allowServerLogin };

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

      const saved = usesCliProvider ? await getSavedModelChoices(userId) : null;
      if (isSubscriptionProvider(aiProvider)) {
        await assertSubscriptionChoice(
          cliLogin,
          {
            provider: aiProvider,
            model: aiModel,
            reasoningEffort: aiReasoningEffort ?? null,
          },
          saved?.main,
        );
      }
      for (const [type, entry] of taskEntries) {
        if (isSubscriptionProvider(entry.provider)) {
          await assertSubscriptionChoice(
            cliLogin,
            {
              provider: entry.provider,
              model: entry.model,
              reasoningEffort: entry.reasoningEffort ?? null,
            },
            saved?.tasks[type],
          );
        }
      }

      // Thinking levels only apply to subscription providers.
      const nextAiTaskModels = taskEntries.length
        ? Object.fromEntries(
            taskEntries.map(([type, entry]) => [
              type,
              {
                provider: entry.provider,
                model: entry.model,
                reasoningEffort: isSubscriptionProvider(entry.provider)
                  ? (entry.reasoningEffort ?? null)
                  : null,
              },
            ]),
          )
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
                aiReasoningEffort: null,
                aiTaskModels: nextAiTaskModels,
              }
            : {
                aiProvider,
                aiModel,
                aiApiKey: isCliSubscriptionProvider(aiProvider)
                  ? null
                  : nextAiApiKey,
                aiReasoningEffort: isSubscriptionProvider(aiProvider)
                  ? (aiReasoningEffort ?? null)
                  : null,
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

export const updateDecisionModelApiKeyAction = actionClientUser
  .metadata({ name: "updateDecisionModelApiKey" })
  .inputSchema(saveDecisionModelApiKeyBody)
  .action(async ({ ctx: { userId }, parsedInput: { provider, apiKey } }) => {
    if (env.NEXT_PUBLIC_AI_MODEL_SETTINGS_DISABLED) {
      throw new SafeError("AI model settings are managed by the deployment.");
    }

    if (apiKey && (await isDecisionModelApiKeyRejected(provider, apiKey))) {
      throw new SafeError(
        `${provider === "typesafe" ? "TypeSafe" : "OpenRouter"} turned down this key. Check it and try again.`,
      );
    }

    // Encrypted at rest by the Prisma extension.
    await prisma.user.update({
      where: { id: userId },
      data:
        provider === "typesafe"
          ? { decisionTypesafeApiKey: apiKey }
          : { decisionOpenrouterApiKey: apiKey },
    });
  });

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
async function getSubscriptionAccess(userId: string): Promise<{
  usableSubscriptions: string[];
  allowServerLogin: boolean;
}> {
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
  if (user && isCliLlmOwner(user)) {
    return {
      usableSubscriptions: [...CLI_SUBSCRIPTION_PROVIDERS],
      allowServerLogin: true,
    };
  }
  return {
    usableSubscriptions: logins.map((login) => login.provider),
    allowServerLogin: false,
  };
}

// The subscription choices already saved, which passed this check when they
// were saved.
async function getSavedModelChoices(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      aiProvider: true,
      aiModel: true,
      aiReasoningEffort: true,
      aiTaskModels: true,
    },
  });
  const savedEffort = reasoningEffortSchema.safeParse(user?.aiReasoningEffort);
  return {
    main:
      user?.aiProvider && user.aiModel
        ? {
            provider: user.aiProvider,
            model: user.aiModel,
            reasoningEffort: savedEffort.success ? savedEffort.data : null,
          }
        : undefined,
    tasks: parseAiTaskModels(user?.aiTaskModels).models,
  };
}

// Only a model on the subscription's current list for this user, with one of
// that model's thinking levels, reaches the CLI. A choice left as it was
// saved is kept even when the list can't be read right now or no longer has
// it, so saving other settings never swaps it out.
async function assertSubscriptionChoice(
  cliLogin: CliLoginScope,
  {
    provider,
    model,
    reasoningEffort,
  }: {
    provider: string;
    model: string;
    reasoningEffort: ReasoningEffort | null;
  },
  saved: AiTaskModelEntry | undefined,
) {
  if (
    saved?.provider === provider &&
    saved.model === model &&
    (saved.reasoningEffort ?? null) === reasoningEffort
  ) {
    return;
  }
  const models = await getSubscriptionModels(provider, cliLogin);
  const entry = models.find((m) => m.value === model);
  if (!entry) throw new SafeError("Pick a model from this account's list.");
  if (reasoningEffort && !entry.efforts.includes(reasoningEffort)) {
    throw new SafeError(
      `${entry.label} doesn't offer that thinking level. Pick another one.`,
    );
  }
}
