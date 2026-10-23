import { describe, expect, it } from "vitest";
import {
  getSafeIntegrationResultUrl,
  parseIntegrationCallResult,
} from "@/utils/integrations/result";

describe("getSafeIntegrationResultUrl", () => {
  it("returns an https URL", () => {
    expect(getSafeIntegrationResultUrl("https://example.com/items/1")).toBe(
      "https://example.com/items/1",
    );
  });

  it.each([
    "javascript:alert(1)",
    "http://example.com/items/1",
    "data:text/html,<script>alert(1)</script>",
    "not a url",
    "",
    42,
    null,
    undefined,
    { href: "https://example.com" },
  ])("is not displayable: %j", (value) => {
    expect(getSafeIntegrationResultUrl(value)).toBeNull();
  });
});

describe("parseIntegrationCallResult", () => {
  it("keeps a valid id and url", () => {
    expect(
      parseIntegrationCallResult({
        externalId: "abc-123",
        url: "https://example.com/items/abc-123",
      }),
    ).toEqual({
      externalId: "abc-123",
      url: "https://example.com/items/abc-123",
    });
  });

  it("keeps an id-only result", () => {
    expect(parseIntegrationCallResult({ externalId: "abc-123" })).toEqual({
      externalId: "abc-123",
    });
  });

  it("keeps a valid id when the url is invalid", () => {
    expect(
      parseIntegrationCallResult({ externalId: "abc-123", url: "not a url" }),
    ).toEqual({ externalId: "abc-123" });
  });

  it("keeps the id when the url is over-long", () => {
    const url = `https://example.com/${"a".repeat(2000)}`;
    expect(parseIntegrationCallResult({ externalId: "abc-123", url })).toEqual({
      externalId: "abc-123",
    });
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "http://example.com/items/abc-123",
  ])("drops a non-https url but keeps the id: %s", (url) => {
    expect(parseIntegrationCallResult({ externalId: "abc-123", url })).toEqual({
      externalId: "abc-123",
    });
  });

  it("returns null when the only field is a non-https url", () => {
    expect(
      parseIntegrationCallResult({ url: "javascript:alert(1)" }),
    ).toBeNull();
  });

  it("rejects an over-long id", () => {
    expect(
      parseIntegrationCallResult({ externalId: "a".repeat(501) }),
    ).toBeNull();
  });

  it("accepts a 500 character id", () => {
    const externalId = "a".repeat(500);
    expect(parseIntegrationCallResult({ externalId })).toEqual({ externalId });
  });

  it("rejects an empty id", () => {
    expect(parseIntegrationCallResult({ externalId: "" })).toBeNull();
  });

  it.each([
    {},
    null,
    undefined,
    "string",
    42,
    [],
    { other: "field" },
  ])("returns null for %j", (raw) => {
    expect(parseIntegrationCallResult(raw)).toBeNull();
  });
});
