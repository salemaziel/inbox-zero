import { describe, expect, it } from "vitest";
import {
  aiTaskModelsSchema,
  getRecommendedTaskModel,
  isCostlyTaskChoice,
  Provider,
} from "@/utils/llms/config";

describe("getRecommendedTaskModel", () => {
  it("puts high-volume tasks on the light model with low thinking, where the model takes a level", () => {
    for (const type of ["default", "economy", "nano"] as const) {
      expect(getRecommendedTaskModel(Provider.CODEX_CLI, type)).toEqual({
        model: "gpt-6-luna",
        reasoningEffort: "low",
      });
      // Haiku has no thinking levels.
      expect(getRecommendedTaskModel(Provider.CLAUDE_CODE, type)).toEqual({
        model: "haiku",
        reasoningEffort: null,
      });
    }
  });

  it("leaves chat and drafts on the main model", () => {
    expect(getRecommendedTaskModel(Provider.CODEX_CLI, "chat")).toBeNull();
    expect(getRecommendedTaskModel(Provider.CLAUDE_CODE, "draft")).toBeNull();
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
