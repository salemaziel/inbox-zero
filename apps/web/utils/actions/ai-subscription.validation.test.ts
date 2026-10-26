import { describe, expect, it } from "vitest";
import {
  selectAiSubscriptionBody,
  submitAiSubscriptionCodeBody,
} from "./ai-subscription.validation";
import { Provider } from "@/utils/llms/config";

describe("submitAiSubscriptionCodeBody", () => {
  it("accepts a code in the shape Claude shows", () => {
    expect(
      submitAiSubscriptionCodeBody.safeParse({
        code: " fake_Code-123.x~#fake-State_456 ",
      }).success,
    ).toBe(true);
  });

  it("rejects terminal control characters", () => {
    for (const code of ["abc\x03", "abc\x1b[A", "abc\x1a", "a b"]) {
      expect(submitAiSubscriptionCodeBody.safeParse({ code }).success).toBe(
        false,
      );
    }
  });
});

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
