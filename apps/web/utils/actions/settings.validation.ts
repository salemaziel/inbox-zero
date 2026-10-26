import { z } from "zod";
import { Frequency } from "@/generated/prisma/enums";
import {
  AI_TASK_MODEL_TYPES,
  aiTaskModelsSchema,
  DEFAULT_PROVIDER,
  isSubscriptionModel,
  Provider,
  SUBSCRIPTION_MODELS,
} from "@/utils/llms/config";
import { SENSITIVE_DATA_POLICIES } from "@/utils/dlp/sensitive-content";

export const saveDigestScheduleBody = z.object({
  intervalDays: z.number().nullable(),
  daysOfWeek: z.number().nullable(),
  timeOfDay: z.coerce.date().nullable(),
  occurrences: z.number().nullable(),
});
export type SaveDigestScheduleBody = z.infer<typeof saveDigestScheduleBody>;

export const saveEmailUpdateSettingsBody = z.object({
  statsEmailFrequency: z.enum([Frequency.WEEKLY, Frequency.NEVER]),
  summaryEmailFrequency: z.enum([Frequency.WEEKLY, Frequency.NEVER]),
  digestEmailFrequency: z.enum([
    Frequency.DAILY,
    Frequency.WEEKLY,
    Frequency.NEVER,
  ]),
});
export type SaveEmailUpdateSettingsBody = z.infer<
  typeof saveEmailUpdateSettingsBody
>;

export const saveAiSettingsBody = z
  .object({
    aiProvider: z.enum([
      DEFAULT_PROVIDER,
      Provider.ANTHROPIC,
      Provider.OPEN_AI,
      Provider.AZURE,
      Provider.GOOGLE,
      Provider.GROQ,
      Provider.CEREBRAS,
      Provider.OPENROUTER,
      Provider.CLAUDE_CODE,
      Provider.CODEX_CLI,
    ]),
    aiModel: z.string(),
    aiApiKey: z.string().optional(),
    aiTaskModels: aiTaskModelsSchema.optional(),
  })
  .superRefine(({ aiProvider, aiModel, aiTaskModels }, ctx) => {
    if (
      aiProvider in SUBSCRIPTION_MODELS &&
      !isSubscriptionModel(aiProvider, aiModel)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Pick a model from this account's list",
        path: ["aiModel"],
      });
    }

    for (const type of AI_TASK_MODEL_TYPES) {
      const entry = aiTaskModels?.[type];
      if (
        entry &&
        entry.provider in SUBSCRIPTION_MODELS &&
        !isSubscriptionModel(entry.provider, entry.model)
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Pick a model from this account's list",
          path: ["aiTaskModels", type, "model"],
        });
      }
    }
  });
export type SaveAiSettingsBody = z.infer<typeof saveAiSettingsBody>;

export const saveDecisionModelSettingsBody = z.object({
  decisionModelEnabled: z.boolean(),
});

export const saveSensitiveDataPolicyBody = z.object({
  sensitiveDataPolicy: z.enum(SENSITIVE_DATA_POLICIES),
});
export type SaveSensitiveDataPolicyBody = z.infer<
  typeof saveSensitiveDataPolicyBody
>;

export const updateDigestItemsBody = z.object({
  ruleDigestPreferences: z.record(z.string(), z.boolean()),
});
export type UpdateDigestItemsBody = z.infer<typeof updateDigestItemsBody>;

export const toggleDigestBody = z.object({
  enabled: z.boolean(),
  timeOfDay: z.coerce.date().optional(),
});
export type ToggleDigestBody = z.infer<typeof toggleDigestBody>;
