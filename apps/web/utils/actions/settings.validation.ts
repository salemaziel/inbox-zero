import { z } from "zod";
import { Frequency } from "@/generated/prisma/enums";
import {
  aiTaskModelsSchema,
  DEFAULT_PROVIDER,
  Provider,
  reasoningEffortSchema,
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

// Whether a subscription model and thinking level are on the provider's
// current list is checked by the action, since that list comes from the CLI.
export const saveAiSettingsBody = z.object({
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
  aiReasoningEffort: reasoningEffortSchema.nullish(),
  aiTaskModels: aiTaskModelsSchema.optional(),
});
export type SaveAiSettingsBody = z.infer<typeof saveAiSettingsBody>;

export const saveDecisionModelSettingsBody = z.object({
  decisionModelEnabled: z.boolean(),
});

// A null key removes the saved one.
export const saveDecisionModelApiKeyBody = z.object({
  provider: z.enum(["typesafe", "openrouter"]),
  apiKey: z.string().trim().min(1, "Enter a key").max(500).nullable(),
});
export type SaveDecisionModelApiKeyBody = z.infer<
  typeof saveDecisionModelApiKeyBody
>;

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
