import { beforeEach, describe, it, expect, vi } from "vitest";
import {
  createRuleBody,
  type CreateRuleBody,
  updateRuleBody,
} from "./rule.validation";
import { ActionType } from "@/generated/prisma/enums";
import { ConditionType } from "@/utils/config";
import { WEBHOOK_ACTION_DISABLED_MESSAGE } from "@/utils/outbound-webhook/action";
import { DELETE_EMAIL_ACTION_DISABLED_MESSAGE } from "@/utils/delete-email-action";

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {
    webhookActionsEnabled: true,
    deleteEmailActionEnabled: false,
  },
}));

vi.mock("@/env", () => ({
  env: {
    get NEXT_PUBLIC_WEBHOOK_ACTION_ENABLED() {
      return mockEnv.webhookActionsEnabled;
    },
    get NEXT_PUBLIC_DELETE_EMAIL_ACTION_ENABLED() {
      return mockEnv.deleteEmailActionEnabled;
    },
  },
}));

describe("createRuleBody", () => {
  const validAction = {
    type: ActionType.ARCHIVE,
  };

  const validCondition = {
    type: ConditionType.AI,
    instructions: "Archive all newsletters",
  };

  const validRule: CreateRuleBody = {
    name: "Test Rule",
    actions: [validAction],
    conditions: [validCondition],
  };

  describe("name validation", () => {
    it("accepts valid name", () => {
      const result = createRuleBody.safeParse(validRule);
      expect(result.success).toBe(true);
    });

    it("rejects empty name", () => {
      const result = createRuleBody.safeParse({
        ...validRule,
        name: "",
      });
      expect(result.success).toBe(false);
    });

    it("rejects whitespace-only name", () => {
      const result = createRuleBody.safeParse({
        ...validRule,
        name: "   ",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("actions validation", () => {
    it("requires at least one action", () => {
      const result = createRuleBody.safeParse({
        ...validRule,
        actions: [],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain("at least one action");
      }
    });

    it("accepts multiple actions", () => {
      const result = createRuleBody.safeParse({
        ...validRule,
        actions: [{ type: ActionType.ARCHIVE }, { type: ActionType.MARK_READ }],
      });
      expect(result.success).toBe(true);
    });
  });

  describe("conditions validation", () => {
    it("requires at least one condition", () => {
      const result = createRuleBody.safeParse({
        ...validRule,
        conditions: [],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain(
          "at least one condition",
        );
      }
    });

    it("rejects duplicate AI conditions", () => {
      const result = createRuleBody.safeParse({
        ...validRule,
        conditions: [
          { type: ConditionType.AI, instructions: "First AI condition" },
          { type: ConditionType.AI, instructions: "Second AI condition" },
        ],
      });
      expect(result.success).toBe(false);
    });

    it("allows one AI condition with multiple static conditions", () => {
      const result = createRuleBody.safeParse({
        ...validRule,
        conditions: [
          { type: ConditionType.AI, instructions: "AI condition" },
          { type: ConditionType.STATIC, from: "test@example.com" },
          { type: ConditionType.STATIC, subject: "Newsletter" },
        ],
      });
      expect(result.success).toBe(true);
    });

    it("rejects duplicate static conditions with same fields", () => {
      const result = createRuleBody.safeParse({
        ...validRule,
        conditions: [
          { type: ConditionType.STATIC, from: "test1@example.com" },
          { type: ConditionType.STATIC, from: "test2@example.com" },
        ],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain("duplicate");
      }
    });

    it("allows static conditions with different fields", () => {
      const result = createRuleBody.safeParse({
        ...validRule,
        conditions: [
          { type: ConditionType.STATIC, from: "test@example.com" },
          { type: ConditionType.STATIC, subject: "Newsletter" },
        ],
      });
      expect(result.success).toBe(true);
    });
  });

  describe("action-specific validation (superRefine)", () => {
    beforeEach(() => {
      mockEnv.webhookActionsEnabled = true;
      mockEnv.deleteEmailActionEnabled = false;
    });

    describe("LABEL action", () => {
      it("requires labelId value for LABEL action", () => {
        const result = createRuleBody.safeParse({
          ...validRule,
          actions: [{ type: ActionType.LABEL }],
        });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0].message).toContain("label name");
        }
      });

      it("accepts labelId.value for LABEL action", () => {
        const result = createRuleBody.safeParse({
          ...validRule,
          actions: [
            {
              type: ActionType.LABEL,
              labelId: { value: "inbox/newsletters" },
            },
          ],
        });
        expect(result.success).toBe(true);
      });

      it("accepts labelId.name for LABEL action", () => {
        const result = createRuleBody.safeParse({
          ...validRule,
          actions: [
            {
              type: ActionType.LABEL,
              labelId: { name: "Newsletters" },
            },
          ],
        });
        expect(result.success).toBe(true);
      });
    });

    describe("FORWARD action", () => {
      it("requires to.value for FORWARD action", () => {
        const result = createRuleBody.safeParse({
          ...validRule,
          actions: [{ type: ActionType.FORWARD }],
        });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0].message).toContain("email address");
        }
      });

      it("accepts valid to.value for FORWARD action", () => {
        const result = createRuleBody.safeParse({
          ...validRule,
          actions: [
            {
              type: ActionType.FORWARD,
              to: { value: "forward@example.com" },
            },
          ],
        });
        expect(result.success).toBe(true);
      });
    });

    describe("SEND_EMAIL action", () => {
      it("requires to.value for SEND_EMAIL action", () => {
        const result = createRuleBody.safeParse({
          ...validRule,
          actions: [
            {
              type: ActionType.SEND_EMAIL,
              subject: { value: "Hello" },
              content: { value: "World" },
            },
          ],
        });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0].message).toContain("send to");
        }
      });

      it("accepts valid to.value for SEND_EMAIL action", () => {
        const result = createRuleBody.safeParse({
          ...validRule,
          actions: [
            {
              type: ActionType.SEND_EMAIL,
              to: { value: "recipient@example.com" },
              subject: { value: "Hello" },
              content: { value: "World" },
            },
          ],
        });
        expect(result.success).toBe(true);
      });
    });

    describe("DRAFT_MESSAGING_CHANNEL action", () => {
      it("requires messagingChannelId for new chat draft actions", () => {
        const result = createRuleBody.safeParse({
          ...validRule,
          actions: [{ type: ActionType.DRAFT_MESSAGING_CHANNEL }],
        });

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0].message).toBe(
            "Please choose a chat destination",
          );
        }
      });

      it("allows persisted legacy chat draft actions without messagingChannelId", () => {
        const result = createRuleBody.safeParse({
          ...validRule,
          actions: [
            {
              id: "action-legacy-draft",
              type: ActionType.DRAFT_MESSAGING_CHANNEL,
              messagingChannelId: null,
            },
          ],
        });

        expect(result.success).toBe(true);
      });
    });

    describe("CALL_WEBHOOK action", () => {
      it("requires url.value for CALL_WEBHOOK action", () => {
        const result = createRuleBody.safeParse({
          ...validRule,
          actions: [{ type: ActionType.CALL_WEBHOOK }],
        });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0].message).toContain("webhook URL");
        }
      });

      it("accepts valid url.value for CALL_WEBHOOK action", () => {
        const result = createRuleBody.safeParse({
          ...validRule,
          actions: [
            {
              type: ActionType.CALL_WEBHOOK,
              url: { value: "https://api.example.com/webhook" },
            },
          ],
        });
        expect(result.success).toBe(true);
      });

      it("rejects CALL_WEBHOOK when webhook actions are disabled", () => {
        mockEnv.webhookActionsEnabled = false;

        const result = createRuleBody.safeParse({
          ...validRule,
          actions: [
            {
              type: ActionType.CALL_WEBHOOK,
              url: { value: "https://api.example.com/webhook" },
            },
          ],
        });

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0].message).toBe(
            WEBHOOK_ACTION_DISABLED_MESSAGE,
          );
          expect(result.error.issues[0].path).toEqual(["actions", 0, "type"]);
        }
      });
    });

    describe("DELETE action", () => {
      it("rejects DELETE when delete email actions are disabled", () => {
        mockEnv.deleteEmailActionEnabled = false;

        const result = createRuleBody.safeParse({
          ...validRule,
          actions: [{ type: ActionType.DELETE }],
        });

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0].message).toBe(
            DELETE_EMAIL_ACTION_DISABLED_MESSAGE,
          );
          expect(result.error.issues[0].path).toEqual(["actions", 0, "type"]);
        }
      });

      it("accepts DELETE when delete email actions are enabled", () => {
        mockEnv.deleteEmailActionEnabled = true;

        const result = createRuleBody.safeParse({
          ...validRule,
          actions: [{ type: ActionType.DELETE }],
        });

        expect(result.success).toBe(true);
      });

      it("accepts an existing DELETE on update when the feature is disabled", () => {
        mockEnv.deleteEmailActionEnabled = false;

        const result = updateRuleBody.safeParse({
          ...validRule,
          id: "rule-id",
          actions: [{ id: "action-id", type: ActionType.DELETE }],
        });

        expect(result.success).toBe(true);
      });
    });

    describe("MOVE_FOLDER action", () => {
      it("requires folderName for MOVE_FOLDER action", () => {
        const result = createRuleBody.safeParse({
          ...validRule,
          actions: [{ type: ActionType.MOVE_FOLDER }],
        });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0].message).toContain("folder");
        }
      });

      it("accepts folderName without folderId", () => {
        const result = createRuleBody.safeParse({
          ...validRule,
          actions: [
            {
              type: ActionType.MOVE_FOLDER,
              folderName: { value: "Archive" },
            },
          ],
        });
        expect(result.success).toBe(true);
      });

      it("accepts valid folderName and folderId", () => {
        const result = createRuleBody.safeParse({
          ...validRule,
          actions: [
            {
              type: ActionType.MOVE_FOLDER,
              folderName: { value: "Archive" },
              folderId: { value: "folder123" },
            },
          ],
        });
        expect(result.success).toBe(true);
      });
    });
  });
});

describe("INTEGRATION action validation", () => {
  const validRule = {
    name: "Todoist Rule",
    conditions: [{ type: ConditionType.AI, instructions: "Action items" }],
  };
  const integrationAction = {
    type: ActionType.INTEGRATION,
    integrationName: "todoist",
    integrationToolName: "add-tasks",
    integrationArgs: {
      content: "{{Short action item based on the email}}",
      projectId: "inbox",
      projectName: "Inbox",
    },
  };

  it("accepts an integration action with task content", () => {
    const result = createRuleBody.safeParse({
      ...validRule,
      actions: [integrationAction],
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty task content, which the AI fills at execution", () => {
    const result = createRuleBody.safeParse({
      ...validRule,
      actions: [
        {
          ...integrationAction,
          integrationArgs: { content: "", projectId: "inbox" },
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown argument keys", () => {
    const result = createRuleBody.safeParse({
      ...validRule,
      actions: [
        {
          ...integrationAction,
          integrationArgs: { content: "Review", labels: "urgent" },
        },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("Unknown argument");
    }
  });

  it("asks for an app and action when the integration action names none", () => {
    const result = createRuleBody.safeParse({
      ...validRule,
      actions: [
        {
          ...integrationAction,
          integrationName: null,
          integrationToolName: null,
        },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain(
        "doesn't say which app and action to use",
      );
    }
  });

  describe("choices only the rule editor can make", () => {
    const trelloAction = {
      type: ActionType.INTEGRATION,
      integrationName: "trello",
      integrationToolName: "create-card",
      integrationArgs: { name: "", labelId: "none", due: "none" },
    };

    it("asks for them on a rule saved turned on", () => {
      const result = createRuleBody.safeParse({
        ...validRule,
        actions: [trelloAction],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toEqual([
          expect.objectContaining({
            message: "Please enter a value for board",
            path: ["actions", 0, "integrationArgs", "boardId"],
          }),
          expect.objectContaining({
            message: "Please enter a value for list",
            path: ["actions", 0, "integrationArgs", "listId"],
          }),
        ]);
      }
    });

    it("leaves them for later on a new rule saved turned off", () => {
      const result = createRuleBody.safeParse({
        ...validRule,
        enabled: false,
        actions: [trelloAction],
      });
      expect(result.success).toBe(true);
    });

    it("still asks for them when an existing rule is saved", () => {
      const result = createRuleBody.safeParse({
        ...validRule,
        id: "rule-1",
        enabled: false,
        actions: [trelloAction],
      });
      expect(result.success).toBe(false);
    });
  });

  it("rejects unknown integration names", () => {
    const result = createRuleBody.safeParse({
      ...validRule,
      actions: [{ ...integrationAction, integrationName: "not-a-real-app" }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("Unknown integration");
    }
  });

  describe("email-field markers", () => {
    function parseWithArgs(integrationArgs: Record<string, string>) {
      return createRuleBody.safeParse({
        ...validRule,
        actions: [{ ...integrationAction, integrationArgs }],
      });
    }

    it("rejects an unknown marker, naming it and the available fields", () => {
      const result = parseWithArgs({ content: "Reply to [[sender]]" });
      expect(result.success).toBe(false);
      if (!result.success) {
        const issue = result.error.issues[0];
        expect(issue.path.slice(-2)).toEqual(["integrationArgs", "content"]);
        expect(issue.message).toBe(
          "Unknown field [[sender]]. Available: subject, from, to, date, snippet, link, ruleName.",
        );
      }
    });

    it("rejects a marker with the wrong case", () => {
      const result = parseWithArgs({ content: "[[Subject]]" });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain("[[Subject]]");
      }
    });

    it("reports one issue per unknown marker outside AI segments", () => {
      const result = parseWithArgs({
        content: "[[foo]] {{write [[bar]] here}} [[foo]] [[baz]]",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.map((issue) => issue.message)).toEqual([
          expect.stringContaining("[[foo]]"),
          expect.stringContaining("[[baz]]"),
        ]);
      }
    });

    it("accepts marker-like text inside an AI segment, which runtime leaves as written", () => {
      const result = parseWithArgs({
        content: "{{summarize the [[Body]] section}} for [[subject]]",
      });
      expect(result.success).toBe(true);
    });

    it("accepts known markers, with or without inner spaces", () => {
      const result = parseWithArgs({
        content: "[[subject]] from [[ from ]] ([[ruleName]])",
        description: "[[link]] [[snippet]] [[to]] [[date]]",
      });
      expect(result.success).toBe(true);
    });

    it("ignores marker-like text in a select arg", () => {
      const result = parseWithArgs({ content: "Review", dueString: "[[foo]]" });
      expect(result.success).toBe(true);
    });
  });

  it("rejects tools that are not registered write tools", () => {
    const result = createRuleBody.safeParse({
      ...validRule,
      actions: [{ ...integrationAction, integrationToolName: "delete-tasks" }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain(
        "Unsupported integration tool",
      );
    }
  });
});
