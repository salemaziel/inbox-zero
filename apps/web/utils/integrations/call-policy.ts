import { IntegrationError } from "@/utils/integrations/types";
import { sleep } from "@/utils/sleep";

const PER_ATTEMPT_TIMEOUT_MS = 15_000;
const MAX_WRITE_ATTEMPTS = 3;
const TOTAL_BUDGET_MS = 30_000;
const MAX_RETRY_AFTER_MS = 10_000;
const DEFAULT_RETRY_AFTER_MS = 1000;
// A connect plus one write needs a few seconds; a shorter retry would mostly
// time out mid-request and turn a definite "nothing sent" into "may have been sent".
const MIN_RETRY_WINDOW_MS = 5000;

export async function runWithCallPolicy<T>(
  attempt: (signal: AbortSignal) => Promise<T>,
  { mode }: { mode: "write" | "read" },
): Promise<T> {
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  const maxAttempts = mode === "write" ? MAX_WRITE_ATTEMPTS : 1;

  for (let attemptNumber = 1; ; attemptNumber++) {
    const timeoutMs = Math.min(PER_ATTEMPT_TIMEOUT_MS, deadline - Date.now());

    try {
      return await runAttempt(attempt, { timeoutMs, mode });
    } catch (error) {
      const integrationError =
        error instanceof IntegrationError
          ? error
          : new IntegrationError({ kind: "maybe_sent", cause: error });

      if (attemptNumber >= maxAttempts) throw integrationError;

      const waitMs = getRetryWaitMs(integrationError);
      if (
        waitMs === null ||
        waitMs + MIN_RETRY_WINDOW_MS > deadline - Date.now()
      ) {
        throw integrationError;
      }
      if (waitMs > 0) await sleep(waitMs);
    }
  }
}

// Racing a timer (instead of trusting the signal) abandons attempts that
// ignore abort, so the budget holds even for a misbehaving client.
async function runAttempt<T>(
  attempt: (signal: AbortSignal) => Promise<T>,
  { timeoutMs, mode }: { timeoutMs: number; mode: "write" | "read" },
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // A write that timed out may already have landed; a read has no effect.
      reject(
        new IntegrationError({
          kind: mode === "write" ? "maybe_sent" : "not_sent",
          message: "Integration call timed out",
        }),
      );
      controller.abort();
    }, timeoutMs);
  });

  try {
    return await Promise.race([attempt(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function getRetryWaitMs(error: IntegrationError): number | null {
  if (error.kind === "not_sent") return 0;
  if (error.kind !== "rate_limit") return null;

  const waitMs = error.retryAfterMs ?? DEFAULT_RETRY_AFTER_MS;
  return waitMs <= MAX_RETRY_AFTER_MS ? waitMs : null;
}
