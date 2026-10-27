import { env } from "@/env";
import { listCodexModels } from "@/utils/llms/cli-provider";
import {
  getSubscriptionModelWeight,
  isSubscriptionProvider,
  Provider,
  REASONING_EFFORTS,
  type ReasoningEffort,
  SUBSCRIPTION_MODELS,
  type SubscriptionModel,
} from "@/utils/llms/config";
import { createScopedLogger } from "@/utils/logger";

const logger = createScopedLogger("llms/subscription-models");

// Codex's list changes when OpenAI ships a model, not per request.
const CODEX_MODELS_TTL_MS = 6 * 60 * 60 * 1000;
// After a failed lookup the fallback list is used; try again sooner.
const CODEX_MODELS_RETRY_MS = 5 * 60 * 1000;
// Model ids end up as a CLI argument, so only plain ids are accepted.
const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

type CodexModelsCache = {
  models: SubscriptionModel[];
  expiresAt: number;
};

// Kept on globalThis because route handlers and server actions can load
// separate module copies.
const globalForSubscriptionModels = globalThis as unknown as {
  inboxZeroCodexModels?: CodexModelsCache;
  inboxZeroCodexModelsPending?: Promise<SubscriptionModel[]>;
};

// The models a subscription provider may run, in the order to offer them.
export async function getSubscriptionModels(
  provider: string,
): Promise<SubscriptionModel[]> {
  if (!isSubscriptionProvider(provider)) return [];
  if (provider === Provider.CODEX_CLI) return getCodexModels();
  return [...SUBSCRIPTION_MODELS[provider].models];
}

export async function getAllSubscriptionModels() {
  const [claude, codex] = await Promise.all([
    getSubscriptionModels(Provider.CLAUDE_CODE),
    getSubscriptionModels(Provider.CODEX_CLI),
  ]);
  return { [Provider.CLAUDE_CODE]: claude, [Provider.CODEX_CLI]: codex };
}

// The models the picker should show, from Codex's model/list entries: hidden
// models are dropped, the server's order (its priority order) is kept, and
// any thinking level this app doesn't offer is left out.
export function parseCodexModels(entries: unknown[]): SubscriptionModel[] {
  const models: SubscriptionModel[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    if (record.hidden === true) continue;

    const value = typeof record.model === "string" ? record.model : record.id;
    if (typeof value !== "string" || !MODEL_ID_RE.test(value)) continue;
    if (models.some((model) => model.value === value)) continue;

    const efforts = Array.isArray(record.supportedReasoningEfforts)
      ? record.supportedReasoningEfforts
          .map((level) =>
            level && typeof level === "object"
              ? (level as Record<string, unknown>).reasoningEffort
              : undefined,
          )
          .filter(isReasoningEffort)
      : [];

    models.push({
      value,
      label:
        typeof record.displayName === "string" && record.displayName.trim()
          ? record.displayName.trim()
          : value,
      description:
        typeof record.description === "string" && record.description.trim()
          ? record.description.trim()
          : null,
      efforts,
      defaultEffort:
        isReasoningEffort(record.defaultReasoningEffort) &&
        efforts.includes(record.defaultReasoningEffort)
          ? record.defaultReasoningEffort
          : null,
      weight: getSubscriptionModelWeight(value),
    });
  }
  return models;
}

async function getCodexModels(): Promise<SubscriptionModel[]> {
  const fallback = [...SUBSCRIPTION_MODELS[Provider.CODEX_CLI].models];
  if (!env.CLI_LLM_ENABLED) return fallback;

  const cached = globalForSubscriptionModels.inboxZeroCodexModels;
  if (cached && cached.expiresAt > Date.now()) return cached.models;

  globalForSubscriptionModels.inboxZeroCodexModelsPending ??= loadCodexModels(
    fallback,
  ).finally(() => {
    globalForSubscriptionModels.inboxZeroCodexModelsPending = undefined;
  });
  return globalForSubscriptionModels.inboxZeroCodexModelsPending;
}

async function loadCodexModels(
  fallback: SubscriptionModel[],
): Promise<SubscriptionModel[]> {
  let models: SubscriptionModel[] = [];
  try {
    models = parseCodexModels(await listCodexModels());
    if (!models.length) logger.warn("Codex returned no models to offer");
  } catch (error) {
    logger.warn("Could not list Codex models", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const found = models.length > 0;
  globalForSubscriptionModels.inboxZeroCodexModels = {
    models: found ? models : fallback,
    expiresAt:
      Date.now() + (found ? CODEX_MODELS_TTL_MS : CODEX_MODELS_RETRY_MS),
  };
  return found ? models : fallback;
}

function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return REASONING_EFFORTS.some((effort) => effort === value);
}
