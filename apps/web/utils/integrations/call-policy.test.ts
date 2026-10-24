import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runWithCallPolicy } from "@/utils/integrations/call-policy";
import { IntegrationError } from "@/utils/integrations/types";

describe("runWithCallPolicy", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries a not_sent failure and returns the second attempt's result", async () => {
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(new IntegrationError({ kind: "not_sent" }))
      .mockResolvedValueOnce({ id: "item-1" });

    await expect(
      runWithCallPolicy(attempt, { mode: "write" }),
    ).resolves.toEqual({ id: "item-1" });
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("stops after 3 attempts when every attempt is not_sent", async () => {
    const attempt = vi
      .fn()
      .mockRejectedValue(new IntegrationError({ kind: "not_sent" }));

    await expect(
      runWithCallPolicy(attempt, { mode: "write" }),
    ).rejects.toMatchObject({ kind: "not_sent" });
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it("waits the requested rate-limit time before retrying", async () => {
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(
        new IntegrationError({ kind: "rate_limit", retryAfterMs: 3000 }),
      )
      .mockResolvedValueOnce("ok");

    const result = runWithCallPolicy(attempt, { mode: "write" });

    await vi.advanceTimersByTimeAsync(2999);
    expect(attempt).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe("ok");
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("waits 1 s when a rate limit names no wait", async () => {
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(new IntegrationError({ kind: "rate_limit" }))
      .mockResolvedValueOnce("ok");

    const result = runWithCallPolicy(attempt, { mode: "write" });

    await vi.advanceTimersByTimeAsync(999);
    expect(attempt).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe("ok");
  });

  it("stops without waiting when the rate-limit wait is over 10 s", async () => {
    const attempt = vi
      .fn()
      .mockRejectedValue(
        new IntegrationError({ kind: "rate_limit", retryAfterMs: 10_001 }),
      );

    await expect(
      runWithCallPolicy(attempt, { mode: "write" }),
    ).rejects.toMatchObject({ kind: "rate_limit" });
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(Date.now()).toBe(new Date("2026-01-01T00:00:00.000Z").getTime());
  });

  it("returns rate_limit after three rate-limited attempts", async () => {
    const attempt = vi
      .fn()
      .mockRejectedValue(
        new IntegrationError({ kind: "rate_limit", retryAfterMs: 1000 }),
      );

    const result = runWithCallPolicy(attempt, { mode: "write" });
    const assertion = expect(result).rejects.toMatchObject({
      kind: "rate_limit",
    });
    await vi.advanceTimersByTimeAsync(2000);

    await assertion;
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it("stops when the rate-limit wait does not fit the remaining budget", async () => {
    const attempt = vi
      .fn()
      .mockImplementationOnce(() =>
        rejectAfter(
          14_000,
          new IntegrationError({ kind: "rate_limit", retryAfterMs: 1000 }),
        ),
      )
      .mockImplementationOnce(() =>
        rejectAfter(
          14_000,
          new IntegrationError({ kind: "rate_limit", retryAfterMs: 3000 }),
        ),
      );

    const result = runWithCallPolicy(attempt, { mode: "write" });
    const assertion = expect(result).rejects.toMatchObject({
      kind: "rate_limit",
    });
    await vi.advanceTimersByTimeAsync(29_000);

    await assertion;
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("abandons an attempt that never settles at 15 s and reports maybe_sent", async () => {
    let signal: AbortSignal | undefined;
    const attempt = vi.fn((s: AbortSignal) => {
      signal = s;
      return new Promise<never>(() => {});
    });

    let settled = false;
    const result = runWithCallPolicy(attempt, { mode: "write" });
    result
      .catch(() => {})
      .finally(() => {
        settled = true;
      });

    await vi.advanceTimersByTimeAsync(14_999);
    expect(settled).toBe(false);
    expect(signal?.aborted).toBe(false);

    const assertion = expect(result).rejects.toMatchObject({
      kind: "maybe_sent",
    });
    await vi.advanceTimersByTimeAsync(1);

    await assertion;
    expect(signal?.aborted).toBe(true);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("does not start a retry with less than 5 s left and returns the last definite error", async () => {
    const attempt = vi.fn(() =>
      rejectAfter(14_000, new IntegrationError({ kind: "not_sent" })),
    );

    const result = runWithCallPolicy(attempt, { mode: "write" });
    const assertion = expect(result).rejects.toMatchObject({
      kind: "not_sent",
    });
    await vi.advanceTimersByTimeAsync(30_000);

    await assertion;
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("does not start a retry when the rate-limit wait leaves less than 5 s", async () => {
    const attempt = vi
      .fn()
      .mockImplementationOnce(() =>
        rejectAfter(14_000, new IntegrationError({ kind: "not_sent" })),
      )
      .mockImplementationOnce(() =>
        rejectAfter(
          11_000,
          new IntegrationError({ kind: "rate_limit", retryAfterMs: 1000 }),
        ),
      )
      .mockResolvedValue("ok");

    const result = runWithCallPolicy(attempt, { mode: "write" });
    const assertion = expect(result).rejects.toMatchObject({
      kind: "rate_limit",
    });
    await vi.advanceTimersByTimeAsync(30_000);

    await assertion;
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("caps the last attempt so the total never exceeds 30 s", async () => {
    const start = Date.now();
    const signals: AbortSignal[] = [];
    const attempt = vi.fn((signal: AbortSignal) => {
      signals.push(signal);
      if (signals.length < 3) {
        return rejectAfter(10_000, new IntegrationError({ kind: "not_sent" }));
      }
      return new Promise<never>(() => {});
    });

    let finishedAt: number | undefined;
    const result = runWithCallPolicy(attempt, { mode: "write" });
    result
      .catch(() => {})
      .finally(() => {
        finishedAt = Date.now();
      });
    const assertion = expect(result).rejects.toMatchObject({
      kind: "maybe_sent",
    });

    await vi.advanceTimersByTimeAsync(60_000);

    await assertion;
    expect(attempt).toHaveBeenCalledTimes(3);
    expect(finishedAt! - start).toBe(30_000);
    expect(signals[2].aborted).toBe(true);
  });

  it("never retries a timed-out write", async () => {
    const attempt = vi
      .fn()
      .mockImplementationOnce(() => new Promise<never>(() => {}))
      .mockResolvedValueOnce("ok");

    const result = runWithCallPolicy(attempt, { mode: "write" });
    const assertion = expect(result).rejects.toMatchObject({
      kind: "maybe_sent",
    });
    await vi.advanceTimersByTimeAsync(30_000);

    await assertion;
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it.each([
    "maybe_sent",
    "auth",
    "permanent",
  ] as const)("never retries a %s failure", async (kind) => {
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(new IntegrationError({ kind }))
      .mockResolvedValueOnce("ok");

    await expect(
      runWithCallPolicy(attempt, { mode: "write" }),
    ).rejects.toMatchObject({ kind });
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("treats an unclassified write failure as maybe_sent and keeps the cause", async () => {
    const cause = new Error("socket hang up");
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(cause)
      .mockResolvedValue("ok");

    const error = await runWithCallPolicy(attempt, { mode: "write" }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(IntegrationError);
    expect(error).toMatchObject({ kind: "maybe_sent", cause });
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("makes one attempt in read mode, even for retryable failures", async () => {
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(new IntegrationError({ kind: "not_sent" }))
      .mockResolvedValueOnce("ok");

    await expect(
      runWithCallPolicy(attempt, { mode: "read" }),
    ).rejects.toMatchObject({ kind: "not_sent" });
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("reports a read-mode timeout as not_sent at 15 s", async () => {
    const attempt = vi.fn(() => new Promise<never>(() => {}));

    const result = runWithCallPolicy(attempt, { mode: "read" });
    const assertion = expect(result).rejects.toMatchObject({
      kind: "not_sent",
    });
    await vi.advanceTimersByTimeAsync(15_000);

    await assertion;
    expect(attempt).toHaveBeenCalledTimes(1);
  });
});

function rejectAfter(ms: number, error: unknown) {
  return new Promise<never>((_, reject) => {
    setTimeout(() => reject(error), ms);
  });
}
