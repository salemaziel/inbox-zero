import { describe, expect, it } from "vitest";
import {
  aiTaskModelsSchema,
  getRecommendedTaskModel,
  isCostlyTaskChoice,
  parseAiTaskModels,
  Provider,
  SUBSCRIPTION_MODELS,
} from "@/utils/llms/config";

describe("getRecommendedTaskModel", () => {
  const codexModels = SUBSCRIPTION_MODELS[Provider.CODEX_CLI].models;
  const claudeModels = SUBSCRIPTION_MODELS[Provider.CLAUDE_CODE].models;

  it("puts high-volume tasks on the light model with low thinking, where the model takes a level", () => {
    for (const type of ["default", "economy", "nano"] as const) {
      expect(
        getRecommendedTaskModel(Provider.CODEX_CLI, type, codexModels),
      ).toEqual({ model: "gpt-6-luna", reasoningEffort: "low" });
      // Haiku has no thinking levels.
      expect(
        getRecommendedTaskModel(Provider.CLAUDE_CODE, type, claudeModels),
      ).toEqual({ model: "haiku", reasoningEffort: null });
    }
  });

  it("leaves chat and drafts on the main model", () => {
    expect(
      getRecommendedTaskModel(Provider.CODEX_CLI, "chat", codexModels),
    ).toBeNull();
    expect(
      getRecommendedTaskModel(Provider.CLAUDE_CODE, "draft", claudeModels),
    ).toBeNull();
  });

  it("follows the user's own list: no recommendation without the light model, and only a level it offers", () => {
    const withoutLuna = codexModels.filter((m) => m.value !== "gpt-6-luna");
    expect(
      getRecommendedTaskModel(Provider.CODEX_CLI, "default", withoutLuna),
    ).toBeNull();

    const lunaWithoutLow = codexModels.map((m) =>
      m.value === "gpt-6-luna"
        ? { ...m, efforts: m.efforts.filter((e) => e !== "low") }
        : m,
    );
    expect(
      getRecommendedTaskModel(Provider.CODEX_CLI, "nano", lunaWithoutLow),
    ).toEqual({ model: "gpt-6-luna", reasoningEffort: null });
  });
});

describe("parseAiTaskModels", () => {
  it("keeps the readable entries when one is not", () => {
    const parsed = parseAiTaskModels({
      chat: { provider: Provider.CODEX_CLI, model: "gpt-6.1-sol" },
      economy: {
        provider: Provider.CODEX_CLI,
        model: "gpt-6-luna",
        reasoningEffort: "ultra",
      },
      nano: null,
    });

    expect(parsed).toEqual({
      models: { chat: { provider: Provider.CODEX_CLI, model: "gpt-6.1-sol" } },
      invalid: ["economy"],
    });
    expect(parseAiTaskModels(null)).toEqual({ models: {}, invalid: [] });
  });
});

describe("isCostlyTaskChoice", () => {
  it("flags a high-volume task on a model not known to be light, or with a lot of thinking", () => {
    expect(
      isCostlyTaskChoice({
        type: "economy",
        model: "gpt-6-astra",
        reasoningEffort: null,
      }),
    ).toBe(true);
    // No price data for this one, so it isn't treated as light.
    expect(
      isCostlyTaskChoice({
        type: "default",
        model: "gpt-6.1-terra",
        reasoningEffort: "low",
      }),
    ).toBe(true);
    expect(
      isCostlyTaskChoice({
        type: "nano",
        model: "gpt-6-luna",
        reasoningEffort: "xhigh",
      }),
    ).toBe(true);
    expect(
      isCostlyTaskChoice({
        type: "economy",
        model: "gpt-6-luna",
        reasoningEffort: "low",
      }),
    ).toBe(false);
  });

  it("never flags chat or drafts", () => {
    expect(
      isCostlyTaskChoice({
        type: "draft",
        model: "gpt-6-astra",
        reasoningEffort: "max",
      }),
    ).toBe(false);
  });
});

describe("aiTaskModelsSchema", () => {
  it("still reads entries saved before thinking levels existed", () => {
    const parsed = aiTaskModelsSchema.parse({
      economy: { provider: Provider.CODEX_CLI, model: "gpt-6-luna" },
    });

    expect(parsed.economy).toEqual({
      provider: Provider.CODEX_CLI,
      model: "gpt-6-luna",
    });
  });

  it("rejects thinking levels it doesn't know, including Codex's ultra", () => {
    for (const reasoningEffort of ["ultra", "--config=x"]) {
      expect(
        aiTaskModelsSchema.safeParse({
          chat: {
            provider: Provider.CODEX_CLI,
            model: "gpt-6.1-sol",
            reasoningEffort,
          },
        }).success,
      ).toBe(false);
    }
  });
});
