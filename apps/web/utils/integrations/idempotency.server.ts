import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { ActionType, ExecutedActionStatus } from "@/generated/prisma/enums";
import {
  type IntegrationCallResult,
  parseIntegrationCallResult,
} from "@/utils/integrations/result";
import prisma from "@/utils/prisma";

const MAX_PRIOR_ROWS = 20;

// Excludes the current ExecutedRule because each action's SUCCEEDED outcome is
// persisted before the next one runs; otherwise a second identical action in
// the same rule would be skipped on its first run.
export async function findPriorIntegrationResult({
  emailAccountId,
  messageId,
  ruleId,
  integrationName,
  integrationToolName,
  currentExecutedRuleId,
}: {
  emailAccountId: string;
  messageId: string;
  ruleId: string | null;
  integrationName: string;
  integrationToolName: string;
  currentExecutedRuleId: string;
}): Promise<(IntegrationCallResult & { externalId: string }) | null> {
  if (!ruleId) return null;

  const rows = await prisma.executedAction.findMany({
    where: {
      type: ActionType.INTEGRATION,
      integrationName,
      integrationToolName,
      executionStatus: ExecutedActionStatus.SUCCEEDED,
      integrationResult: { not: Prisma.DbNull },
      executedRuleId: { not: currentExecutedRuleId },
      executedRule: { emailAccountId, messageId, ruleId },
    },
    orderBy: { createdAt: "desc" },
    take: MAX_PRIOR_ROWS,
    select: { integrationResult: true },
  });

  for (const row of rows) {
    const parsed = parseIntegrationCallResult(row.integrationResult);
    if (parsed?.externalId) return { ...parsed, externalId: parsed.externalId };
  }

  return null;
}
