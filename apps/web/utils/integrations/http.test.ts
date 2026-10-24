import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runWithCallPolicy } from "@/utils/integrations/call-policy";
import { integrationFetch } from "@/utils/integrations/http";
import { IntegrationError } from "@/utils/integrations/types";

const ITEMS_URL = "https://api.example.com/items";

describe("integrationFetch", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("returns the parsed JSON body on success", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ id: "item-1" }));

    await expect(integrationFetch(ITEMS_URL, fetchInit())).resolves.toEqual({
      id: "item-1",
    });
  });

  it("returns null for an empty successful body", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(integrationFetch(ITEMS_URL, fetchInit())).resolves.toBeNull();
  });

  it("lets the caller classify an app's error response", async () => {
    fetchMock.mockResolvedValue(new Response("no access", { status: 401 }));
    const classifyError = (status: number, body: string) =>
      status === 401 && body === "no access"
        ? { kind: "permanent" as const, providerMessage: "Board is private" }
        : undefined;

    await expect(
      integrationFetch(ITEMS_URL, fetchInit(), { classifyError }),
    ).rejects.toMatchObject({
      kind: "permanent",
      providerMessage: "Board is private",
    });

    fetchMock.mockResolvedValue(new Response("other", { status: 401 }));
    await expect(
      integrationFetch(ITEMS_URL, fetchInit(), { classifyError }),
    ).rejects.toMatchObject({ kind: "auth", providerMessage: "other" });
  });

  it("passes the caller's abort signal to fetch", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({}));
    const init = fetchInit();

    await integrationFetch(ITEMS_URL, init);

    expect(fetchMock.mock.calls[0][1]?.signal).toBe(init.signal);
  });

  it.each([
    "ENOTFOUND",
    "EAI_AGAIN",
    "ECONNREFUSED",
    "UND_ERR_CONNECT_TIMEOUT",
  ])("classifies %s as not_sent", async (code) => {
    fetchMock.mockRejectedValueOnce(networkError(code));

    await expect(
      integrationFetch(ITEMS_URL, fetchInit()),
    ).rejects.toMatchObject({
      kind: "not_sent",
    });
  });

  it.each([
    "ECONNRESET",
    "UND_ERR_SOCKET",
  ])("classifies %s as maybe_sent", async (code) => {
    fetchMock.mockRejectedValueOnce(networkError(code));

    await expect(
      integrationFetch(ITEMS_URL, fetchInit()),
    ).rejects.toMatchObject({
      kind: "maybe_sent",
    });
  });

  it("classifies a network error without a code as maybe_sent", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));

    await expect(
      integrationFetch(ITEMS_URL, fetchInit()),
    ).rejects.toMatchObject({
      kind: "maybe_sent",
    });
  });

  it.each([
    [401, "auth"],
    [403, "auth"],
    [429, "rate_limit"],
    [500, "maybe_sent"],
    [503, "maybe_sent"],
    [400, "permanent"],
    [404, "permanent"],
    [422, "permanent"],
  ] as const)("classifies status %i as %s", async (status, kind) => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status }));

    await expect(
      integrationFetch(ITEMS_URL, fetchInit()),
    ).rejects.toMatchObject({
      kind,
    });
  });

  it("parses Retry-After given in seconds", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("slow down", {
        status: 429,
        headers: { "Retry-After": "3" },
      }),
    );

    await expect(
      integrationFetch(ITEMS_URL, fetchInit()),
    ).rejects.toMatchObject({
      kind: "rate_limit",
      retryAfterMs: 3000,
    });
  });

  it("parses Retry-After given as an HTTP date", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    fetchMock.mockResolvedValueOnce(
      new Response("slow down", {
        status: 429,
        headers: { "Retry-After": "Thu, 01 Jan 2026 00:00:05 GMT" },
      }),
    );

    await expect(
      integrationFetch(ITEMS_URL, fetchInit()),
    ).rejects.toMatchObject({
      kind: "rate_limit",
      retryAfterMs: 5000,
    });
  });

  it("keeps the app's message in providerMessage only, trimmed to 500 chars", async () => {
    const appMessage = `  ${"x".repeat(600)}  `;
    fetchMock.mockResolvedValueOnce(new Response(appMessage, { status: 400 }));

    const error = await integrationFetch(ITEMS_URL, fetchInit()).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(IntegrationError);
    const integrationError = error as IntegrationError;
    expect(integrationError.providerMessage).toBe("x".repeat(500));
    expect(integrationError.message).not.toContain("xxx");
  });

  it.each([
    [
      "an HTML content type",
      new Response("Service unavailable", {
        status: 503,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    ],
    [
      "HTML markup without a content type",
      new Response(
        "  <!DOCTYPE html><html><body><h1>502 Bad Gateway</h1></body></html>",
        { status: 502, headers: { "content-type": "" } },
      ),
    ],
    [
      "an HTML fragment",
      new Response("<html><head><title>Error</title></head></html>", {
        status: 500,
        headers: { "content-type": "text/plain" },
      }),
    ],
  ])("leaves out an error page sent as %s", async (_, response) => {
    fetchMock.mockResolvedValueOnce(response);

    const error = await integrationFetch(ITEMS_URL, fetchInit()).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(IntegrationError);
    expect((error as IntegrationError).providerMessage).toBeUndefined();
  });

  it("keeps a JSON error body as the app's message", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: "List not found" }, { status: 404 }),
    );

    const error = await integrationFetch(ITEMS_URL, fetchInit()).catch(
      (e: unknown) => e,
    );

    expect((error as IntegrationError).providerMessage).toBe(
      '{"error":"List not found"}',
    );
  });

  it("does not retry a connection reset after connect", async () => {
    fetchMock.mockRejectedValue(networkError("ECONNRESET"));

    await expect(
      runWithCallPolicy((signal) => integrationFetch(ITEMS_URL, { signal }), {
        mode: "write",
      }),
    ).rejects.toMatchObject({ kind: "maybe_sent" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a refused connection and succeeds on the second attempt", async () => {
    fetchMock
      .mockRejectedValueOnce(networkError("ECONNREFUSED"))
      .mockResolvedValueOnce(Response.json({ id: "item-1" }));

    await expect(
      runWithCallPolicy((signal) => integrationFetch(ITEMS_URL, { signal }), {
        mode: "write",
      }),
    ).resolves.toEqual({ id: "item-1" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("waits Retry-After: 3 and then retries", async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(
        new Response("slow down", {
          status: 429,
          headers: { "Retry-After": "3" },
        }),
      )
      .mockResolvedValueOnce(Response.json({ id: "item-1" }));

    const result = runWithCallPolicy(
      (signal) => integrationFetch(ITEMS_URL, { signal }),
      { mode: "write" },
    );

    await vi.advanceTimersByTimeAsync(2999);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toEqual({ id: "item-1" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops with rate_limit after one attempt when Retry-After is 60", async () => {
    fetchMock.mockResolvedValue(
      new Response("slow down", {
        status: 429,
        headers: { "Retry-After": "60" },
      }),
    );

    await expect(
      runWithCallPolicy((signal) => integrationFetch(ITEMS_URL, { signal }), {
        mode: "write",
      }),
    ).rejects.toMatchObject({ kind: "rate_limit" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry a 500 on a write", async () => {
    fetchMock.mockImplementation(
      async () => new Response("boom", { status: 500 }),
    );

    await expect(
      runWithCallPolicy((signal) => integrationFetch(ITEMS_URL, { signal }), {
        mode: "write",
      }),
    ).rejects.toMatchObject({ kind: "maybe_sent" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

function fetchInit() {
  return { method: "POST", signal: new AbortController().signal };
}

function networkError(code: string) {
  return new TypeError("fetch failed", {
    cause: Object.assign(new Error(code), { code }),
  });
}
