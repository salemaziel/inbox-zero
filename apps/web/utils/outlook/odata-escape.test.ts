import { describe, it, expect } from "vitest";
import { escapeODataString } from "@/utils/outlook/odata-escape";

describe("OData String Escaping", () => {
  it("should escape single quotes by doubling them", () => {
    expect(escapeODataString("O'Brien")).toBe("O''Brien");
    expect(escapeODataString("'test'")).toBe("''test''");
  });

  it("should URL-encode the literal so Graph decodes it back unchanged", () => {
    expect(escapeODataString("test@example.com")).toBe("test%40example.com");
    expect(escapeODataString("a+tag@example.com")).toBe(
      "a%2Btag%40example.com",
    );
    expect(decodeURIComponent(escapeODataString("it's a test"))).toBe(
      "it''s a test",
    );
  });

  it("should handle empty strings", () => {
    expect(escapeODataString("")).toBe("");
  });

  it("should handle non-string inputs safely", () => {
    expect(escapeODataString(null as any)).toBe("");
    expect(escapeODataString(undefined as any)).toBe("");
    expect(escapeODataString(123 as any)).toBe("");
  });

  it("should keep a literal quote inside the string after Graph URL-decodes the filter", () => {
    const filters = [
      "x' or true or 'x",
      "x%27 or true or %27x",
      "x'&$top=999",
    ].map(
      (value) =>
        `conversationId eq '${decodeURIComponent(escapeODataString(value))}'`,
    );

    for (const filter of filters) {
      const literal = filter.slice("conversationId eq '".length, -1);
      expect(literal.replaceAll("''", "")).not.toContain("'");
    }
    expect(filters[1]).toBe("conversationId eq 'x%27 or true or %27x'");
    expect(escapeODataString("x'&$top=999")).not.toContain("&");
  });
});
