import type { IntegrationCallResult } from "@/utils/integrations/result";
import type { IntegrationArgOption } from "@/utils/mcp/tool-specs";

export type IntegrationErrorKind =
  | "auth"
  | "rate_limit"
  | "not_sent"
  | "maybe_sent"
  | "permanent";

export class IntegrationError extends Error {
  readonly kind: IntegrationErrorKind;
  // Kept off `message` so the app's text never reaches logs above trace.
  readonly providerMessage?: string;
  readonly retryAfterMs?: number;

  constructor({
    kind,
    message,
    providerMessage,
    retryAfterMs,
    cause,
  }: {
    kind: IntegrationErrorKind;
    message?: string;
    providerMessage?: string;
    retryAfterMs?: number;
    cause?: unknown;
  }) {
    super(message ?? `Integration call failed (${kind})`, { cause });
    this.name = "IntegrationError";
    this.kind = kind;
    this.providerMessage = providerMessage;
    this.retryAfterMs = retryAfterMs;
  }
}

export type NativeConnection = {
  id: string;
  emailAccountId: string;
  accessToken: string;
};

export type NativeIntegrationExecutor = {
  run(
    conn: NativeConnection,
    call: { tool: string; payload: Record<string, unknown> },
    o: { signal: AbortSignal },
  ): Promise<unknown>;
  parseResult(raw: unknown, tool: string): IntegrationCallResult | null;
  listOptions(
    conn: NativeConnection,
    argKey: string,
    parents: Record<string, string>,
    o: { signal: AbortSignal },
  ): Promise<IntegrationArgOption[]>;
  testConnection(
    cred: { accessToken: string },
    o: { signal: AbortSignal },
  ): Promise<void>;
  revoke?(conn: NativeConnection, o: { signal: AbortSignal }): Promise<void>;
  buildAuthorizeUrl?(o: { returnUrl: string }): string;
};
