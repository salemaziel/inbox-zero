import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActionType } from "@/generated/prisma/enums";
import { createRuleAction } from "@/utils/actions/rule";
import { aiPromptToRules } from "@/utils/ai/rule/prompt-to-rules";

vi.mock("@/utils/middleware", async () => {
  const { createWithEmailAccountTestMiddleware } = await vi.importActual<
    typeof import("@/__tests__/helpers")
  >("@/__tests__/helpers");

  return createWithEmailAccountTestMiddleware();
});
vi.mock("@/utils/actions/rule", () => ({ createRuleAction: vi.fn() }));
vi.mock("@/utils/ai/rule/prompt-to-rules", () => ({
  aiPromptToRules: vi.fn(),
}));
vi.mock("@/utils/user/get", () => ({
  getEmailAccountWithAi: vi.fn().mockResolvedValue({ id: "email-account-1" }),
}));

import { POST } from "./route";

describe("POST /api/mobile/rules", () => {
  beforeEach(() => {
    vi.mocked(aiPromptToRules).mockResolvedValue([
      {
        name: "Invoices",
        condition: {
          aiInstructions: "Invoices",
          conditionalOperator: null,
          static: null,
        },
        actions: [
          {
            type: ActionType.INTEGRATION,
            integrationName: "trello",
            integrationToolName: "create-card",
            fields: { name: null, description: null },
            delayInMinutes: null,
          },
        ],
      },
    ]);
  });

  it("saves an AI-written Trello rule turned off and says what to pick", async () => {
    vi.mocked(createRuleAction).mockResolvedValue({
      data: {
        rule: {
          id: "rule-1",
          enabled: false,
          actions: [
            {
              type: ActionType.INTEGRATION,
              integrationName: "trello",
              integrationToolName: "create-card",
              integrationArgs: { name: "" },
            },
          ],
        },
      },
    } as never);

    const response = await POST(promptRequest(), {} as never);

    expect(createRuleAction).toHaveBeenCalledWith(
      "email-account-1",
      expect.objectContaining({ enabled: false }),
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      rule: { id: "rule-1", enabled: false },
      message:
        "This rule was saved turned off. To finish it, open it in the rule editor, pick the Trello board and list, then turn the rule on.",
    });
  });

  it("answers a rule that fails validation with its message, not a generic error", async () => {
    vi.mocked(createRuleAction).mockResolvedValue({
      validationErrors: {
        formErrors: [],
        fieldErrors: { actions: ["Please enter a value for board"] },
      },
    } as never);

    const response = await POST(promptRequest(), {} as never);

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: "Please enter a value for board",
    });
  });
});

function promptRequest() {
  return new NextRequest("http://localhost/api/mobile/rules", {
    method: "POST",
    body: JSON.stringify({
      source: "prompt",
      prompt: "Add a Trello card for every invoice email",
    }),
  });
}
