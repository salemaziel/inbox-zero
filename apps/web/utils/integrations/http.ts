import { MAX_PROVIDER_MESSAGE_LENGTH } from "@/utils/integrations/provider-message";
import { IntegrationError } from "@/utils/integrations/types";
import type { IntegrationErrorKind } from "@/utils/integrations/types";
import { createScopedLogger } from "@/utils/logger";
import { getRetryAfterDelayMs } from "@/utils/retry/provider-retry";

const logger = createScopedLogger("integrations/http");

const HTML_DOCUMENT_PATTERN = /^<(!doctype html|html)\b/i;

// Only failures before the request leaves the machine are safe to retry; a
// reset or socket error after connect may follow a write that already landed.
const NOT_SENT_NETWORK_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "UND_ERR_CONNECT_TIMEOUT",
]);

// Apps whose status codes don't map cleanly (for example a 401 that only
// means "no access to this board") classify their own error responses;
// returning undefined keeps the default mapping.
type ClassifyError = (
  status: number,
  body: string,
) => { kind: IntegrationErrorKind; providerMessage?: string } | undefined;

export async function integrationFetch(
  url: string,
  init: RequestInit & { signal: AbortSignal },
  { classifyError }: { classifyError?: ClassifyError } = {},
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

    const classified = classifyError?.(response.status, body);
    throw new IntegrationError({
      kind: classified?.kind ?? getKindForStatus(response.status),
      message: `Integration request failed with status ${response.status}`,
      providerMessage:
        classified?.providerMessage ?? getProviderMessage(response, body),
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

// A proxy or CDN error page is markup, not something the app said.
function getProviderMessage(response: Response, body: string) {
  const text = body.trim();
  if (!text) return;

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/html") || HTML_DOCUMENT_PATTERN.test(text)) {
    return;
  }

  return text.slice(0, MAX_PROVIDER_MESSAGE_LENGTH);
}

function getCauseCode(error: unknown): string {
  if (!(error instanceof Error)) return "";
  const cause = error.cause as { code?: unknown } | undefined;
  return typeof cause?.code === "string" ? cause.code : "";
}
