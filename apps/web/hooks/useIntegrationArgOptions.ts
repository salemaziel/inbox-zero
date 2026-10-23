import useSWR from "swr";
import type { GetIntegrationArgOptionsResponse } from "@/app/api/mcp/[integration]/arg-options/route";

/**
 * Loads the selectable options for a remote-select integration argument.
 * The spec decides which read tool is called, so this works for any
 * integration without a per-integration hook. Pass `parents` for an arg that
 * depends on other args; pass null while a parent is still unset.
 */
export function useIntegrationArgOptions({
  integration,
  tool,
  argKey,
  parents,
  enabled,
}: {
  integration: string | null | undefined;
  tool: string | null | undefined;
  argKey: string | null | undefined;
  parents?: Record<string, string> | null;
  enabled: boolean;
}) {
  const canFetch =
    enabled && parents !== null && !!integration && !!tool && !!argKey;
  const query = new URLSearchParams({ tool: tool ?? "", argKey: argKey ?? "" });
  if (parents && Object.keys(parents).length > 0) {
    query.set("parents", JSON.stringify(parents));
  }

  return useSWR<GetIntegrationArgOptionsResponse>(
    canFetch
      ? `/api/mcp/${encodeURIComponent(integration)}/arg-options?${query}`
      : null,
  );
}
