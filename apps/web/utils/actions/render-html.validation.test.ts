import { describe, expect, it } from "vitest";
import { renderHtmlBody } from "./render-html.validation";

describe("renderHtmlBody", () => {
  it("accepts html at the size cap", () => {
    const html = "a".repeat(5 * 1024 * 1024);

    expect(renderHtmlBody.safeParse({ html }).success).toBe(true);
  });

  it("rejects html over the size cap", () => {
    const html = "a".repeat(5 * 1024 * 1024 + 1);

    expect(renderHtmlBody.safeParse({ html }).success).toBe(false);
  });
});
