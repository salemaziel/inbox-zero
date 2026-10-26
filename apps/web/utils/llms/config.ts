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

export const SUBSCRIPTION_MODELS = {
  [Provider.CLAUDE_CODE]: {
    models: [
      { value: "sonnet", label: "Sonnet" },
      { value: "opus", label: "Opus" },
      { value: "haiku", label: "Haiku" },
    ],
    defaultModel: "sonnet",
    fastModel: "haiku",
  },
  [Provider.CODEX_CLI]: {
    models: [
      { value: "gpt-6.1-sol", label: "GPT-6.1-Sol" },
      { value: "gpt-6-astra", label: "GPT-6-Astra" },
      { value: "gpt-6-luna", label: "GPT-6-Luna" },
    ],
    defaultModel: "gpt-6.1-sol",
    fastModel: "gpt-6-luna",
  },
} as const satisfies Record<
  string,
  {
    models: readonly { value: string; label: string }[];
    defaultModel: string;
    fastModel: string;
  }
>;

export function getSubscriptionModelLabel(provider: string, model: string) {
  return (
    SUBSCRIPTION_MODELS[provider].models.find((m) => m.value === model)
      ?.label ?? model
  );
}

// Settings keys for the per-task model choice, one per model type.
export const AI_TASK_MODEL_TYPES = [
  "chat",
  "draft",
  "default",
  "economy",
  "nano",
] as const;

const aiTaskModelEntry = z.object({
  provider: z.string().min(1),
  model: z.string().trim().min(1, "Pick a model"),
});

// Stored in User.aiTaskModels. Which providers an entry may use is checked on
// save, against the user's main provider and connected subscriptions.
export const aiTaskModelsSchema = z.object({
  chat: aiTaskModelEntry.optional(),
  draft: aiTaskModelEntry.optional(),
  default: aiTaskModelEntry.optional(),
  economy: aiTaskModelEntry.optional(),
  nano: aiTaskModelEntry.optional(),
});
export type AiTaskModels = z.infer<typeof aiTaskModelsSchema>;

export function isSubscriptionModel(provider: string, model: string) {
  return !!SUBSCRIPTION_MODELS[provider]?.models.some((m) => m.value === model);
}
