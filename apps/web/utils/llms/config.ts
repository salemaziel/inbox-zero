import { z } from "zod";

export const DEFAULT_PROVIDER = "DEFAULT";

export const Provider = {
  OPEN_AI: "openai",
  AZURE: "azure",
  AZURE_FOUNDRY: "azure-foundry",
  VERTEX: "vertex",
  ANTHROPIC: "anthropic",
  BEDROCK: "bedrock",
  GOOGLE: "google",
  GROQ: "groq",
  CEREBRAS: "cerebras",
  OPENROUTER: "openrouter",
  AI_GATEWAY: "aigateway",
  OLLAMA: "ollama",
  OPENAI_COMPATIBLE: "openai-compatible",
  CODEX_CLI: "codex-cli",
  CLAUDE_CODE: "claude-code",
};

export const providerOptions: { label: string; value: string }[] = [
  { label: "Default", value: DEFAULT_PROVIDER },
  { label: "Anthropic", value: Provider.ANTHROPIC },
  { label: "OpenAI", value: Provider.OPEN_AI },
  { label: "Azure OpenAI", value: Provider.AZURE },
  { label: "Google", value: Provider.GOOGLE },
  { label: "Groq", value: Provider.GROQ },
  { label: "Cerebras", value: Provider.CEREBRAS },
  { label: "OpenRouter", value: Provider.OPENROUTER },
  { label: "Vercel AI Gateway", value: Provider.AI_GATEWAY },
];

// Codex's "ultra" level is left out: it hands work off to sub-agents, which a
// locked-down run blocks, and it is the most expensive level.
export const REASONING_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];
export const reasoningEffortSchema = z.enum(REASONING_EFFORTS);

// Levels that count as "a lot of thinking" for the high-volume warning.
const HIGH_REASONING_EFFORTS: readonly ReasoningEffort[] = [
  "high",
  "xhigh",
  "max",
];

// How hard a model is on a plan's usage limits, where there is evidence for
// it. null means unknown. See SUBSCRIPTION_MODEL_WEIGHTS for the sources.
export type ModelWeight = "light" | "medium" | "heavy";

export type SubscriptionModel = {
  value: string;
  label: string;
  description: string | null;
  efforts: ReasoningEffort[];
  defaultEffort: ReasoningEffort | null;
  weight: ModelWeight | null;
};

// Evidence: per-token API prices in utils/llms/pricing.generated.ts and
// supported-model-pricing.ts, and the providers' own model descriptions.
// Models not listed here have no price data and no clear ranking.
const SUBSCRIPTION_MODEL_WEIGHTS: Record<string, ModelWeight> = {
  // $0.10 in / $0.50 out per million tokens.
  "gpt-6-luna": "light",
  // $0.20 / $1.20.
  "gpt-5.6-luna": "light",
  // $2 / $10-12 (gpt-5.6-sol is $2/$10 or $4/$20 depending on the table).
  "gpt-5.6-sol": "medium",
  "gpt-5.6-terra": "medium",
  // Codex: "Frontier intelligence for the most demanding work", and it pitches
  // GPT-6.1-Sol as "near-Astra performance at a lower cost".
  "gpt-6-astra": "heavy",
  // Haiku 4.5 is $1 / $5.
  haiku: "light",
  // Sonnet 5 is $2 / $10.
  sonnet: "medium",
  // Opus 5 is $5 / $25 (Opus 5.5, which this alias runs, has no price yet).
  opus: "heavy",
  // Claude ranks Fable above Opus: "Most capable for your hardest and
  // longest-running tasks". No price data.
  fable: "heavy",
};

// Claude Code's effort levels, for every model that supports effort.
const CLAUDE_EFFORTS: ReasoningEffort[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

// The models offered when the CLI can't list its own. Claude Code has no
// model list API, so its list is always this one; its levels and descriptions
// are as the Claude Agent SDK 0.3.283 reports them. The Codex entries are
// copied from Codex 0.164.0's model list.
export const SUBSCRIPTION_MODELS = {
  [Provider.CLAUDE_CODE]: {
    models: [
      claudeModel(
        "sonnet",
        "Sonnet",
        "Sonnet 5 · Efficient for routine tasks",
        CLAUDE_EFFORTS,
      ),
      claudeModel(
        "opus",
        "Opus",
        "Opus 5.5 · Best for everyday, complex tasks",
        CLAUDE_EFFORTS,
      ),
      claudeModel(
        "fable",
        "Fable",
        "Fable 5.1 · Most capable for your hardest and longest-running tasks",
        CLAUDE_EFFORTS,
      ),
      claudeModel(
        "haiku",
        "Haiku",
        "Haiku 4.5 · Fastest for quick answers",
        [],
      ),
    ],
    defaultModel: "sonnet",
    fastModel: "haiku",
  },
  [Provider.CODEX_CLI]: {
    models: [
      codexFallbackModel(
        "gpt-6.1-sol",
        "GPT-6.1-Sol",
        "Latest workhorse model for coding and everyday work.",
        "low",
      ),
      codexFallbackModel(
        "gpt-6-astra",
        "GPT-6-Astra",
        "Frontier intelligence for the most demanding work.",
        "low",
      ),
      codexFallbackModel(
        "gpt-6.1-terra",
        "GPT-6.1 Terra",
        "GPT-6.1 Terra Codex model.",
        "low",
      ),
      codexFallbackModel(
        "gpt-6-luna",
        "GPT-6-Luna",
        "Fast and affordable model for easier tasks.",
        "medium",
      ),
    ],
    defaultModel: "gpt-6.1-sol",
    fastModel: "gpt-6-luna",
  },
} as const satisfies Record<
  string,
  {
    models: readonly SubscriptionModel[];
    defaultModel: string;
    fastModel: string;
  }
>;

export type SubscriptionProvider = keyof typeof SUBSCRIPTION_MODELS;

export function isSubscriptionProvider(
  provider: string | null | undefined,
): provider is SubscriptionProvider {
  return !!provider && provider in SUBSCRIPTION_MODELS;
}

export function getSubscriptionModelWeight(model: string): ModelWeight | null {
  return SUBSCRIPTION_MODEL_WEIGHTS[model] ?? null;
}

// Settings keys for the per-task model choice, one per model type.
export const AI_TASK_MODEL_TYPES = [
  "chat",
  "draft",
  "default",
  "economy",
  "nano",
] as const;
export type AiTaskModelType = (typeof AI_TASK_MODEL_TYPES)[number];

// Run for (nearly) every incoming email, so these use a light model and little
// thinking unless the user picks otherwise.
export const HIGH_VOLUME_TASK_TYPES: readonly AiTaskModelType[] = [
  "default",
  "economy",
  "nano",
];

const aiTaskModelEntry = z.object({
  provider: z.string().min(1),
  model: z.string().trim().min(1, "Pick a model"),
  // Absent in entries saved before thinking levels existed.
  reasoningEffort: reasoningEffortSchema.nullish(),
});

// Stored in User.aiTaskModels. Which providers, models and levels an entry may
// use is checked on save, against the user's main provider, connected
// subscriptions and the subscription's model list.
export const aiTaskModelsSchema = z.object({
  chat: aiTaskModelEntry.optional(),
  draft: aiTaskModelEntry.optional(),
  default: aiTaskModelEntry.optional(),
  economy: aiTaskModelEntry.optional(),
  nano: aiTaskModelEntry.optional(),
});
export type AiTaskModels = z.infer<typeof aiTaskModelsSchema>;
export type AiTaskModelEntry = z.infer<typeof aiTaskModelEntry>;

// What a task with no entry of its own runs on when the main provider is a
// subscription: high-volume tasks get the light model with low thinking when
// the user's model list offers them, the rest (and every task when it
// doesn't) the main model. The settings form and getModel both pass the list
// the user is offered, so what the form shows is what runs.
export function getRecommendedTaskModel(
  provider: SubscriptionProvider,
  type: AiTaskModelType,
  models: readonly SubscriptionModel[],
): { model: string; reasoningEffort: ReasoningEffort | null } | null {
  if (!HIGH_VOLUME_TASK_TYPES.includes(type)) return null;
  const fastModel = SUBSCRIPTION_MODELS[provider].fastModel;
  const entry = models.find((model) => model.value === fastModel);
  if (!entry) return null;
  return {
    model: entry.value,
    reasoningEffort: entry.efforts.includes("low") ? "low" : null,
  };
}

// Each entry is read on its own, so an unreadable one (a level this version
// doesn't know, a hand edit) only sends that task back to the main model.
export function parseAiTaskModels(value: unknown): {
  models: AiTaskModels;
  invalid: AiTaskModelType[];
} {
  const record =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const models: AiTaskModels = {};
  const invalid: AiTaskModelType[] = [];
  for (const type of AI_TASK_MODEL_TYPES) {
    if (record[type] === undefined || record[type] === null) continue;
    const parsed = aiTaskModelEntry.safeParse(record[type]);
    if (parsed.success) models[type] = parsed.data;
    else invalid.push(type);
  }
  return { models, invalid };
}

// True when a high-volume task is set up in a way that can drain a plan
// quickly: a model not known to be light, or a high thinking level.
export function isCostlyTaskChoice({
  type,
  model,
  reasoningEffort,
}: {
  type: AiTaskModelType;
  model: string;
  reasoningEffort: ReasoningEffort | null | undefined;
}) {
  if (!HIGH_VOLUME_TASK_TYPES.includes(type)) return false;
  if (getSubscriptionModelWeight(model) !== "light") return true;
  return !!reasoningEffort && HIGH_REASONING_EFFORTS.includes(reasoningEffort);
}

function claudeModel(
  value: string,
  label: string,
  description: string,
  efforts: ReasoningEffort[],
): SubscriptionModel {
  return {
    value,
    label,
    description,
    efforts,
    // Claude Code's own default is "high" where effort is supported.
    defaultEffort: efforts.length ? "high" : null,
    weight: getSubscriptionModelWeight(value),
  };
}

function codexFallbackModel(
  value: string,
  label: string,
  description: string,
  defaultEffort: ReasoningEffort,
): SubscriptionModel {
  return {
    value,
    label,
    description,
    efforts: ["low", "medium", "high", "xhigh", "max"],
    defaultEffort,
    weight: getSubscriptionModelWeight(value),
  };
}
