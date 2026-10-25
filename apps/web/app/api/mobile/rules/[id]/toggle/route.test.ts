import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActionType } from "@/generated/prisma/enums";
import prisma from "@/utils/__mocks__/prisma";

vi.mock("@/utils/middleware", async () => {
  const { createWithEmailAccountTestMiddleware } = await vi.importActual<
    typeof import("@/__tests__/helpers")
  >("@/__tests__/helpers");

  return createWithEmailAccountTestMiddleware();
});
vi.mock("@/utils/prisma");
vi.mock("@/utils/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "user-1", email: "user@example.com" },
  })),
}));
vi.mock("@/utils/rule/rule-history", () => ({
  createRuleHistory: vi.fn(),
  ruleHistoryRuleInclude: { actions: true, group: true },
}));

import { POST } from "./route";

describe("POST /api/mobile/rules/[id]/toggle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.emailAccount.findUnique.mockResolvedValue({
      email: "user@example.com",
      account: { userId: "user-1", provider: "google" },
    } as never);
    prisma.rule.findUnique.mockResolvedValue({
      organizationRuleId: null,
    } as never);
    prisma.rule.update.mockResolvedValue({
      id: "rule-1",
      actions: [],
      group: null,
    } as never);
  });

  it("won't turn on a rule whose Trello action still needs editor choices", async () => {
    prisma.rule.findFirst.mockResolvedValue({
      actions: [
        {
          type: ActionType.INTEGRATION,
          integrationName: "trello",
          integrationToolName: "add-comment",
          integrationArgs: { boardId: "board-1", text: "" },
        },
      ],
    } as never);

    const response = await toggle(true);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error:
        "This rule can't be turned on yet. Open it in the rule editor, pick the Trello card, then turn it on.",
    });
    expect(prisma.rule.update).not.toHaveBeenCalled();
  });

  it("turns on a finished rule as before", async () => {
    prisma.rule.findFirst.mockResolvedValue({ actions: [] } as never);

    const response = await toggle(true);

    expect(response.status).toBe(200);
    expect(prisma.rule.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { enabled: true } }),
    );
  });
});

function toggle(enabled: boolean) {
  return POST(
    new NextRequest("http://localhost/api/mobile/rules/rule-1/toggle", {
      method: "POST",
      body: JSON.stringify({ enabled }),
    }),
    { params: Promise.resolve({ id: "rule-1" }) } as never,
  );
}
