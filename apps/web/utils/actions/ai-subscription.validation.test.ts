import { describe, expect, it } from "vitest";
import { selectAiSubscriptionBody } from "@/utils/actions/ai-subscription.validation";
import { Provider } from "@/utils/llms/config";

describe("selectAiSubscriptionBody", () => {
  it("accepts a model from the provider's own list, or none", () => {
    expect(
      selectAiSubscriptionBody.safeParse({
        provider: Provider.CLAUDE_CODE,
        model: "opus",
      }).success,
    ).toBe(true);
    expect(
      selectAiSubscriptionBody.safeParse({ provider: Provider.CODEX_CLI })
        .success,
    ).toBe(true);
  });

  it("rejects a model that belongs to the other provider", () => {
    expect(
      selectAiSubscriptionBody.safeParse({
        provider: Provider.CLAUDE_CODE,
        model: "gpt-6.1-sol",
      }).success,
    ).toBe(false);
    expect(
      selectAiSubscriptionBody.safeParse({
        provider: Provider.CODEX_CLI,
        model: "opus",
      }).success,
    ).toBe(false);
  });
});
