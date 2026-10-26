import { describe, expect, it } from "vitest";
import { submitAiSubscriptionCodeBody } from "./ai-subscription.validation";

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
