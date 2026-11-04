import type { ModelType } from "@/utils/llms/model";
import { isCliSubscriptionProvider } from "@/utils/llms/subscription-access";
import {
  type AiTaskModelEntry,
  getRecommendedTaskModel,
  isSubscriptionProvider,
  parseAiTaskModels,
  type ReasoningEffort,
  reasoningEffortSchema,
  SUBSCRIPTION_MODELS,
} from "@/utils/llms/subscription-config";
import type { UserAIFields } from "@/utils/llms/types";
import { createScopedLogger } from "@/utils/logger";

const logger = createScopedLogger("llms/model");

// A per-task entry only applies while its provider is still usable: the main
// provider (with the main API key) or a CLI subscription. null means the task
// follows the main model; undefined means it has no usable entry.
export function getUserTaskModel(
  userAi: UserAIFields,
  modelType: ModelType,
): AiTaskModelEntry | null | undefined {
  const { models, invalid } = parseAiTaskModels(userAi.aiTaskModels);
  if (invalid.includes(modelType)) {
    logger.warn("Ignoring an unreadable task model entry", { modelType });
  }
  const entry = models[modelType];
  if (!entry) return entry;
  if (isCliSubscriptionProvider(entry.provider)) return entry;
  if (entry.provider === userAi.aiProvider && userAi.aiApiKey) return entry;
  return;
}

// High-volume tasks on a user's own subscription use the recommended light
// model and thinking level so they don't burn through the plan's limits.
// Saving settings writes that choice per task, resolved against the user's
// own list; a task never saved uses the built-in list, as the form shows.
export function getUserModelChoice(
  userAi: UserAIFields,
  aiProvider: string,
  modelType: ModelType,
  useRecommended: boolean,
): { aiModel: string | null; reasoningEffort: ReasoningEffort | null } {
  if (!isSubscriptionProvider(aiProvider))
    return { aiModel: userAi.aiModel || null, reasoningEffort: null };

  const recommended = useRecommended
    ? getRecommendedTaskModel(
        aiProvider,
        modelType,
        SUBSCRIPTION_MODELS[aiProvider].models,
      )
    : null;
  if (recommended)
    return {
      aiModel: recommended.model,
      reasoningEffort: recommended.reasoningEffort,
    };

  const savedEffort = reasoningEffortSchema.safeParse(userAi.aiReasoningEffort);
  return {
    aiModel: userAi.aiModel || null,
    reasoningEffort: savedEffort.success ? savedEffort.data : null,
  };
}
