import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const handleCallbackMock = vi.hoisted(() => vi.fn());

vi.mock("@vercel/queue", () => ({
  handleCallback: handleCallbackMock,
}));

import { createForwardingQueueHandler } from "./create-forwarding-queue-handler";

describe("createForwardingQueueHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handleCallbackMock.mockReturnValue(vi.fn());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 404 without running the queue handler when not on Vercel", async () => {
    vi.stubEnv("VERCEL", "");
    const queueHandler = vi.fn();
    handleCallbackMock.mockReturnValue(queueHandler);

    const handler = createTestHandler();
    const response = await handler(
      new Request("http://localhost/api/test/queue", {
        method: "POST",
        body: JSON.stringify({ id: "1" }),
      }),
    );

    expect(response.status).toBe(404);
    expect(queueHandler).not.toHaveBeenCalled();
  });

  it("passes the request to the queue handler on Vercel", async () => {
    vi.stubEnv("VERCEL", "1");
    const queueHandler = vi.fn().mockResolvedValue(new Response("ok"));
    handleCallbackMock.mockReturnValue(queueHandler);

    const handler = createTestHandler();
    const request = new Request("http://localhost/api/test/queue", {
      method: "POST",
    });
    const response = await handler(request);

    expect(response.status).toBe(200);
    expect(queueHandler).toHaveBeenCalledWith(request);
  });

  it("acknowledges a failing message after the configured delivery limit", () => {
    createForwardingQueueHandler({
      loggerScope: "test/queue",
      schema: z.object({ id: z.string() }),
      path: "/api/test",
      invalidPayloadMessage: "Invalid test payload",
      visibilityTimeoutSeconds: 30,
      maxDeliveryAttempts: 5,
    });

    const retry = handleCallbackMock.mock.calls[0][1].retry;

    expect(
      retry(new Error("Temporary failure"), {
        messageId: "message-id",
        deliveryCount: 4,
      }),
    ).toEqual({ afterSeconds: 80 });
    expect(
      retry(new Error("Persistent failure"), {
        messageId: "message-id",
        deliveryCount: 5,
      }),
    ).toEqual({ acknowledge: true });
  });
});

function createTestHandler() {
  return createForwardingQueueHandler({
    loggerScope: "test/queue",
    schema: z.object({ id: z.string() }),
    path: "/api/test",
    invalidPayloadMessage: "Invalid test payload",
    visibilityTimeoutSeconds: 30,
  });
}
