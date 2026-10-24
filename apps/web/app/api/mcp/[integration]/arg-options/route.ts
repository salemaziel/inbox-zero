import { NextResponse } from "next/server";
import { z } from "zod";
import { withEmailAccount } from "@/utils/middleware";
import { SafeError } from "@/utils/error";
import { getIntegrationArgOptions } from "@/utils/integrations/arg-options.server";

const parentsSchema = z.record(z.string(), z.string());

export type GetIntegrationArgOptionsResponse = Awaited<
  ReturnType<typeof getIntegrationArgOptions>
>;

export const GET = withEmailAccount(
  "mcp/arg-options",
  async (request, { params }) => {
    const { integration } = await params;
    const searchParams = request.nextUrl.searchParams;

    return NextResponse.json(
      await getIntegrationArgOptions({
        emailAccountId: request.auth.emailAccountId,
        integration,
        tool: searchParams.get("tool"),
        argKey: searchParams.get("argKey"),
        parents: parseParents(searchParams.get("parents")),
        logger: request.logger,
      }),
    );
  },
);

function parseParents(raw: string | null): Record<string, string> | undefined {
  if (raw === null) return;

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new SafeError("Invalid parents");
  }

  const parsed = parentsSchema.safeParse(json);
  if (!parsed.success) throw new SafeError("Invalid parents");
  return parsed.data;
}
