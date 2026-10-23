import { IntegrationError } from "@/utils/integrations/types";
import type { IntegrationErrorKind } from "@/utils/integrations/types";
import { createScopedLogger } from "@/utils/logger";
import { getRetryAfterDelayMs } from "@/utils/retry/provider-retry";

const logger = createScopedLogger("integrations/http");

const MAX_PROVIDER_MESSAGE_LENGTH = 500;

// Only failures before the request leaves the machine are safe to retry; a
// reset or socket error after connect may follow a write that already landed.
const NOT_SENT_NETWORK_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "UND_ERR_CONNECT_TIMEOUT",
]);

export async function integrationFetch(
  url: string,
  init: RequestInit & { signal: AbortSignal },
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    throw new IntegrationError({
      kind: NOT_SENT_NETWORK_CODES.has(getCauseCode(error))
        ? "not_sent"
        : "maybe_sent",
      message: "Integration request failed",
      cause: error,
    });
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    logger.trace("Integration request failed", {
      status: response.status,
      body,
    });

    throw new IntegrationError({
      kind: getKindForStatus(response.status),
      message: `Integration request failed with status ${response.status}`,
      providerMessage:
        body.trim().slice(0, MAX_PROVIDER_MESSAGE_LENGTH) || undefined,
      retryAfterMs:
        response.status === 429
          ? getRetryAfterDelayMs(
              response.headers.get("retry-after") ?? undefined,
            )
          : undefined,
    });
  }

  let body: string;
  try {
    body = await response.text();
  } catch (error) {
    throw new IntegrationError({
      kind: "maybe_sent",
      message: "Integration response could not be read",
      cause: error,
    });
  }

  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

function getKindForStatus(status: number): IntegrationErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "maybe_sent";
  return "permanent";
}

function getCauseCode(error: unknown): string {
  if (!(error instanceof Error)) return "";
  const cause = error.cause as { code?: unknown } | undefined;
  return typeof cause?.code === "string" ? cause.code : "";
}
