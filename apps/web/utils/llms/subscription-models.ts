import { env } from "@/env";
import {
  type CliLoginScope,
  getCodexModelListLogin,
  listCodexModels,
} from "@/utils/llms/cli-provider";
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
// separate module copies. Keyed by the login the list was read with: one
// entry per user with their own login, one shared by the server's login.
const globalForSubscriptionModels = globalThis as unknown as {
  inboxZeroCodexModels?: Map<string, CodexModelsCache>;
  inboxZeroCodexModelsPending?: Map<string, Promise<SubscriptionModel[]>>;
};
globalForSubscriptionModels.inboxZeroCodexModels ??= new Map();
globalForSubscriptionModels.inboxZeroCodexModelsPending ??= new Map();
const codexModelsCache = globalForSubscriptionModels.inboxZeroCodexModels;
const codexModelsPending =
  globalForSubscriptionModels.inboxZeroCodexModelsPending;

// The models a subscription provider may run for this user, in the order to
// offer them. ChatGPT plans differ, so the Codex list is read with the login
// the user's runs use.
export async function getSubscriptionModels(
  provider: string,
  cliLogin: CliLoginScope,
): Promise<SubscriptionModel[]> {
  if (!isSubscriptionProvider(provider)) return [];
  if (provider === Provider.CODEX_CLI) return getCodexModels(cliLogin);
  return [...SUBSCRIPTION_MODELS[provider].models];
}

export async function getAllSubscriptionModels(cliLogin: CliLoginScope) {
  const [claude, codex] = await Promise.all([
    getSubscriptionModels(Provider.CLAUDE_CODE, cliLogin),
    getSubscriptionModels(Provider.CODEX_CLI, cliLogin),
  ]);
  return { [Provider.CLAUDE_CODE]: claude, [Provider.CODEX_CLI]: codex };
}

// The models the picker should show, from `codex debug models` entries:
// models not marked for the picker are dropped, the rest sorted by Codex's
// priority, and any thinking level this app doesn't offer is left out.
export function parseCodexModels(entries: unknown[]): SubscriptionModel[] {
  const models: (SubscriptionModel & { priority: number })[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    if (record.visibility !== "list") continue;

    const value = record.slug;
    if (typeof value !== "string" || !MODEL_ID_RE.test(value)) continue;
    if (models.some((model) => model.value === value)) continue;

    const efforts = Array.isArray(record.supported_reasoning_levels)
      ? record.supported_reasoning_levels
          .map((level) =>
            level && typeof level === "object"
              ? (level as Record<string, unknown>).effort
              : undefined,
          )
          .filter(isReasoningEffort)
      : [];

    models.push({
      value,
      label: getText(record.display_name) ?? value,
      description: getText(record.description),
      efforts,
      defaultEffort:
        isReasoningEffort(record.default_reasoning_level) &&
        efforts.includes(record.default_reasoning_level)
          ? record.default_reasoning_level
          : null,
      weight: getSubscriptionModelWeight(value),
      priority:
        typeof record.priority === "number"
          ? record.priority
          : Number.MAX_SAFE_INTEGER,
    });
  }
  return models
    .sort((a, b) => a.priority - b.priority)
    .map(({ priority: _priority, ...model }) => model);
}

async function getCodexModels(
  cliLogin: CliLoginScope,
): Promise<SubscriptionModel[]> {
  const fallback = [...SUBSCRIPTION_MODELS[Provider.CODEX_CLI].models];
  if (!env.CLI_LLM_ENABLED) return fallback;

  const listLogin = await getCodexModelListLogin(cliLogin);
  if (!listLogin) return fallback;
  const key = listLogin === "user" ? `user:${cliLogin.userId}` : "server";

  const cached = codexModelsCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.models;

  let pending = codexModelsPending.get(key);
  if (!pending) {
    pending = loadCodexModels(key, cliLogin, fallback).finally(() => {
      codexModelsPending.delete(key);
    });
    codexModelsPending.set(key, pending);
  }
  return pending;
}

async function loadCodexModels(
  key: string,
  cliLogin: CliLoginScope,
  fallback: SubscriptionModel[],
): Promise<SubscriptionModel[]> {
  const listed = await listCodexModels(cliLogin);
  const models = listed ? parseCodexModels(listed) : [];
  if (listed && !models.length) logger.warn("Codex listed no models to offer");

  // After a failed lookup, a list read earlier beats the built-in one.
  const found = models.length > 0;
  const next = found ? models : (codexModelsCache.get(key)?.models ?? fallback);
  codexModelsCache.set(key, {
    models: next,
    expiresAt:
      Date.now() + (found ? CODEX_MODELS_TTL_MS : CODEX_MODELS_RETRY_MS),
  });
  return next;
}

function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return REASONING_EFFORTS.some((effort) => effort === value);
}

function getText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
