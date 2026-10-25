import { describe, expect, it, vi } from "vitest";
import { getEmailAccount } from "@/__tests__/helpers";
import { ActionType } from "@/generated/prisma/enums";
import { aiPromptToRules } from "@/utils/ai/rule/prompt-to-rules";

// Run with: pnpm --filter inbox-zero-ai test-ai ai-regression/ai-prompt-to-rules-integrations

vi.mock("server-only", () => ({}));
vi.mock("@/utils/integration-action.server", () => ({
  isIntegrationActionEnabledForUserId: async () => true,
}));

const isAiTest = process.env.RUN_AI_TESTS === "true";

const TIMEOUT = 30_000;

describe.runIf(isAiTest)("aiPromptToRules integration actions", () => {
  it.each([
    {
      prompt: "* Add a Trello card for every invoice email",
      integrationName: "trello",
      integrationToolName: "create-card",
    },
    {
      prompt:
        '* When the weekly status report arrives, comment on my "Weekly status" Trello card',
      integrationName: "trello",
      integrationToolName: "add-comment",
    },
    {
      prompt:
        '* When the movers confirm the office move is done, archive my "Office move" Trello card',
      integrationName: "trello",
      integrationToolName: "move-card",
    },
    {
      prompt: "* Add a Todoist task for emails that ask me to do something",
      integrationName: "todoist",
      integrationToolName: "add-tasks",
    },
  ])(
    "names the app and tool the user asked for: $integrationName/$integrationToolName",
    async ({ prompt, integrationName, integrationToolName }) => {
      const [rule] = await aiPromptToRules({
        emailAccount: getEmailAccount(),
        promptFile: prompt,
      });

      const integrationActions = rule.actions.filter(
        (action) => action.type === ActionType.INTEGRATION,
      );
      expect(integrationActions).toEqual([
        expect.objectContaining({ integrationName, integrationToolName }),
      ]);
    },
    TIMEOUT,
  );

  it(
    "does not add an integration action the user did not ask for",
    async () => {
      const [rule] = await aiPromptToRules({
        emailAccount: getEmailAccount(),
        promptFile: '* Archive newsletters and label them "Newsletter"',
      });

      expect(rule.actions.map((action) => action.type)).not.toContain(
        ActionType.INTEGRATION,
      );
    },
    TIMEOUT,
  );
});
