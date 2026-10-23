import { z } from "zod";

export const integrationCallResultSchema = z.object({
  externalId: z.string().min(1).max(500).optional(),
  url: z.string().url().max(2000).optional(),
});

export type IntegrationCallResult = z.infer<typeof integrationCallResultSchema>;

// A bad url must not discard a valid id: the id is what makes reruns idempotent.
export function parseIntegrationCallResult(
  raw: unknown,
): IntegrationCallResult | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const { externalId, url } = raw as Record<string, unknown>;
  const result: IntegrationCallResult = {};

  if (externalId !== undefined) {
    const parsedId =
      integrationCallResultSchema.shape.externalId.safeParse(externalId);
    if (!parsedId.success) return null;
    result.externalId = parsedId.data;
  }

  if (url !== undefined) {
    const parsedUrl = integrationCallResultSchema.shape.url.safeParse(url);
    if (parsedUrl.success) result.url = parsedUrl.data;
  }

  return result.externalId || result.url ? result : null;
}

export function getSafeIntegrationResultUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;

  try {
    const url = new URL(value);
    return url.protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}
