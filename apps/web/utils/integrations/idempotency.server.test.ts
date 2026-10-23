import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { ActionType, ExecutedActionStatus } from "@/generated/prisma/enums";
import prisma from "@/utils/__mocks__/prisma";
import { findPriorIntegrationResult } from "@/utils/integrations/idempotency.server";

vi.mock("server-only", () => ({}));
vi.mock("@/utils/prisma");

const baseOptions = {
  emailAccountId: "account-1",
  messageId: "message-1",
  ruleId: "rule-1",
  integrationName: "fixture",
  integrationToolName: "create_item",
  currentExecutedRuleId: "executed-rule-current",
};

describe("findPriorIntegrationResult", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the newest prior result that has an id", async () => {
    prisma.executedAction.findMany.mockResolvedValue([
      { integrationResult: { externalId: "item-2", url: "https://x.test/2" } },
      { integrationResult: { externalId: "item-1" } },
    ] as never);

    await expect(findPriorIntegrationResult(baseOptions)).resolves.toEqual({
      externalId: "item-2",
      url: "https://x.test/2",
    });
  });

  it("skips rows without an id in favour of an older row with one", async () => {
    prisma.executedAction.findMany.mockResolvedValue([
      { integrationResult: { url: "https://x.test/link-only" } },
      { integrationResult: { externalId: "" } },
      { integrationResult: { externalId: "item-1" } },
    ] as never);

    await expect(findPriorIntegrationResult(baseOptions)).resolves.toEqual({
      externalId: "item-1",
    });
  });

  it("returns null when no row has an id", async () => {
    prisma.executedAction.findMany.mockResolvedValue([
      { integrationResult: { url: "https://x.test/link-only" } },
    ] as never);

    await expect(findPriorIntegrationResult(baseOptions)).resolves.toBeNull();
  });

  it("excludes the current ExecutedRule and scopes to the full tuple", async () => {
    prisma.executedAction.findMany.mockResolvedValue([]);

    await findPriorIntegrationResult(baseOptions);

    expect(prisma.executedAction.findMany).toHaveBeenCalledWith({
      where: {
        type: ActionType.INTEGRATION,
        integrationName: "fixture",
        integrationToolName: "create_item",
        executionStatus: ExecutedActionStatus.SUCCEEDED,
        integrationResult: { not: Prisma.DbNull },
        executedRuleId: { not: "executed-rule-current" },
        executedRule: {
          emailAccountId: "account-1",
          messageId: "message-1",
          ruleId: "rule-1",
        },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { integrationResult: true },
    });
  });

  it("does not query when the rule is gone", async () => {
    await expect(
      findPriorIntegrationResult({ ...baseOptions, ruleId: null }),
    ).resolves.toBeNull();

    expect(prisma.executedAction.findMany).not.toHaveBeenCalled();
  });
});
