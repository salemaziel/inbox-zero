import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActionType, SystemType } from "@/generated/prisma/enums";
import { ConditionType } from "@/utils/config";

const {
  actualRuleModule,
  createEmailProviderMock,
  createRuleHistoryMock,
  setRuleEnabledMock,
} = vi.hoisted(() => ({
  actualRuleModule: {} as { setRuleEnabled?: typeof setRuleEnabled },
  createEmailProviderMock: vi.fn(),
  createRuleHistoryMock: vi.fn(),
  setRuleEnabledMock: vi.fn(),
}));

vi.mock("@/utils/rule/rule", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/rule/rule")>();
  actualRuleModule.setRuleEnabled = actual.setRuleEnabled;
  return {
    ...actual,
    setRuleEnabled: setRuleEnabledMock,
  };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/utils/prisma");
vi.mock("@/utils/email/provider", () => ({
  createEmailProvider: createEmailProviderMock,
}));
vi.mock("@/utils/rule/rule-history", () => ({
  createRuleHistory: createRuleHistoryMock,
}));
vi.mock("@/utils/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: "u1", email: "owner@example.com" } })),
}));

import prisma from "@/utils/__mocks__/prisma";
import { createEmailProvider } from "@/utils/email/provider";
import {
  createRulesOnboardingAction,
  deleteRuleAction,
  enableDraftRepliesAction,
  toggleAllRulesAction,
  toggleRuleAction,
  updateRuleAction,
} from "@/utils/actions/rule";
import type { setRuleEnabled } from "@/utils/rule/rule";
import { RULE_MANAGED_BY_ORGANIZATION_ERROR } from "@/utils/organizations/rules";
import { SafeError } from "@/utils/error";

describe("enableDraftRepliesAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createEmailProvider).mockResolvedValue({} as any);
  });

  it("re-enables the existing to-reply rule before adding draft actions", async () => {
    (
      prisma.emailAccount.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      email: "owner@example.com",
      account: { userId: "u1", provider: "google" },
    });

    prisma.rule.findUnique.mockResolvedValue({
      id: "rule-1",
      enabled: false,
      systemType: SystemType.TO_REPLY,
      actions: [],
    } as never);

    setRuleEnabledMock.mockResolvedValue({
      id: "rule-1",
      enabled: true,
      actions: [],
    });

    await enableDraftRepliesAction("ea_1" as never, { enable: true } as never);

    expect(setRuleEnabledMock).toHaveBeenCalledWith({
      ruleId: "rule-1",
      emailAccountId: "ea_1",
      enabled: true,
    });
    expect(prisma.action.create).toHaveBeenCalledWith({
      data: {
        emailAccountId: "ea_1",
        messagingChannelEmailAccountId: null,
        ruleId: "rule-1",
        type: ActionType.DRAFT_EMAIL,
      },
    });
  });

  it("disables the existing to-reply rule when draft replies are turned off", async () => {
    (
      prisma.emailAccount.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      email: "owner@example.com",
      account: { userId: "u1", provider: "google" },
    });

    prisma.rule.findUnique.mockResolvedValue({
      id: "rule-1",
      enabled: true,
      systemType: SystemType.TO_REPLY,
      actions: [{ type: ActionType.DRAFT_EMAIL }],
    } as never);

    setRuleEnabledMock.mockResolvedValue({
      id: "rule-1",
      enabled: false,
      actions: [{ type: ActionType.DRAFT_EMAIL }],
    });

    await enableDraftRepliesAction("ea_1" as never, { enable: false } as never);

    expect(setRuleEnabledMock).toHaveBeenCalledWith({
      ruleId: "rule-1",
      emailAccountId: "ea_1",
      enabled: false,
    });
    expect(prisma.action.deleteMany).toHaveBeenCalledWith({
      where: {
        ruleId: "rule-1",
        type: ActionType.DRAFT_EMAIL,
      },
    });
  });
});

describe("deleteRuleAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createEmailProvider).mockResolvedValue({} as any);
  });

  it("rejects deleting default rules", async () => {
    (
      prisma.emailAccount.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      email: "owner@example.com",
      account: { userId: "u1", provider: "google" },
    });

    prisma.rule.findUnique.mockResolvedValue({
      id: "rule-1",
      emailAccountId: "ea_1",
      systemType: SystemType.NEWSLETTER,
      groupId: null,
    } as never);

    const result = await deleteRuleAction(
      "ea_1" as never,
      {
        id: "rule-1",
      } as never,
    );

    expect(result?.serverError).toBe(
      "Default rules cannot be deleted. Disable them instead.",
    );
    expect(prisma.rule.delete).not.toHaveBeenCalled();
    expect(prisma.group.deleteMany).not.toHaveBeenCalled();
  });
});

describe("updateRuleAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createEmailProvider).mockResolvedValue({} as any);
    prisma.rule.findMany.mockResolvedValue([]);
  });

  it("scopes the rule update to the bound email account", async () => {
    (
      prisma.emailAccount.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      email: "owner@example.com",
      account: { userId: "u1", provider: "google" },
    });

    prisma.rule.update.mockResolvedValue({
      id: "victim-rule",
      actions: [],
      group: null,
    } as never);

    const result = await updateRuleAction(
      "attacker-account" as never,
      {
        id: "victim-rule",
        name: "Updated rule",
        instructions: null,
        groupId: null,
        runOnThreads: true,
        digest: false,
        actions: [
          {
            type: ActionType.ARCHIVE,
            messagingChannelId: null,
            labelId: null,
            subject: null,
            content: null,
            to: null,
            cc: null,
            bcc: null,
            url: null,
            folderName: null,
            folderId: null,
            delayInMinutes: null,
          },
        ],
        conditions: [
          {
            type: ConditionType.STATIC,
            instructions: null,
            to: null,
            from: "sender@example.com",
            subject: null,
            body: null,
          },
        ],
        conditionalOperator: "AND",
        systemType: null,
      } as never,
    );

    expect(result?.serverError).toBeUndefined();
    expect(prisma.rule.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "victim-rule",
          emailAccountId: "attacker-account",
        },
      }),
    );
  });

  it("rejects updating an org-managed rule copy", async () => {
    (
      prisma.emailAccount.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      email: "owner@example.com",
      account: { userId: "u1", provider: "google" },
    });

    prisma.rule.findUnique.mockResolvedValue({
      organizationRuleId: "org-rule-1",
    } as never);

    const result = await updateRuleAction(
      "ea_1" as never,
      {
        id: "managed-rule",
        name: "Updated rule",
        instructions: null,
        groupId: null,
        runOnThreads: true,
        digest: false,
        actions: [
          {
            type: ActionType.ARCHIVE,
            messagingChannelId: null,
            labelId: null,
            subject: null,
            content: null,
            to: null,
            cc: null,
            bcc: null,
            url: null,
            folderName: null,
            folderId: null,
            delayInMinutes: null,
          },
        ],
        conditions: [
          {
            type: ConditionType.STATIC,
            instructions: null,
            to: null,
            from: "sender@example.com",
            subject: null,
            body: null,
          },
        ],
        conditionalOperator: "AND",
        systemType: null,
      } as never,
    );

    expect(result?.serverError).toBe(RULE_MANAGED_BY_ORGANIZATION_ERROR);
    expect(prisma.rule.update).not.toHaveBeenCalled();
  });
});

describe("toggleRuleAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createEmailProvider).mockResolvedValue({} as any);
  });

  it("rejects toggling an org-managed rule copy via the personal path", async () => {
    (
      prisma.emailAccount.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      email: "owner@example.com",
      account: { userId: "u1", provider: "google" },
    });

    prisma.rule.findUnique.mockResolvedValue({
      organizationRuleId: "org-rule-1",
    } as never);

    const result = await toggleRuleAction(
      "ea_1" as never,
      { ruleId: "managed-rule", enabled: true } as never,
    );

    expect(result?.serverError).toBe(RULE_MANAGED_BY_ORGANIZATION_ERROR);
    expect(setRuleEnabledMock).not.toHaveBeenCalled();
  });

  it("won't turn on a rule whose Trello action still needs editor choices", async () => {
    setRuleEnabledMock.mockImplementation(actualRuleModule.setRuleEnabled!);
    (
      prisma.emailAccount.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      email: "owner@example.com",
      account: { userId: "u1", provider: "google" },
    });
    prisma.rule.findUnique.mockResolvedValue({
      organizationRuleId: null,
    } as never);
    prisma.rule.findFirst.mockResolvedValue({
      actions: [unfinishedTrelloAction()],
    } as never);

    const result = await toggleRuleAction(
      "ea_1" as never,
      { ruleId: "invoices-rule", enabled: true } as never,
    );

    expect(result?.serverError).toBe(
      "This rule can't be turned on yet. Open it in the rule editor, pick the Trello board and list, then turn it on.",
    );
    expect(prisma.rule.update).not.toHaveBeenCalled();
  });
});

describe("toggleAllRulesAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (
      prisma.emailAccount.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      email: "owner@example.com",
      account: { userId: "u1", provider: "google" },
    });
    prisma.rule.updateMany.mockResolvedValue({ count: 2 });
  });

  it("turns on every other rule, leaves unfinished ones off and names them", async () => {
    prisma.rule.findMany.mockResolvedValue([
      {
        id: "invoices-rule",
        name: "Invoices",
        actions: [unfinishedTrelloAction()],
      },
      {
        id: "tasks-rule",
        name: "Tasks",
        actions: [
          {
            type: ActionType.INTEGRATION,
            integrationName: "todoist",
            integrationToolName: "add-tasks",
            integrationArgs: { content: "", projectId: "inbox" },
          },
        ],
      },
      {
        id: "projects-rule",
        name: "Projects",
        actions: [
          {
            type: ActionType.INTEGRATION,
            integrationName: "trello",
            integrationToolName: "create-card",
            integrationArgs: {
              boardId: "board-1",
              boardName: "Ops",
              listId: "list-1",
              listName: "To do",
              name: "",
            },
          },
        ],
      },
    ] as never);

    const result = await toggleAllRulesAction(
      "ea_1" as never,
      { enabled: true } as never,
    );

    expect(prisma.rule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          emailAccountId: "ea_1",
          organizationRuleId: null,
          enabled: false,
          actions: { some: { type: ActionType.INTEGRATION } },
        },
      }),
    );
    expect(prisma.rule.updateMany).toHaveBeenCalledWith({
      where: {
        emailAccountId: "ea_1",
        organizationRuleId: null,
        id: { notIn: ["invoices-rule"] },
      },
      data: { enabled: true },
    });
    expect(result?.data).toEqual({
      success: true,
      message:
        "Every other rule is on. Invoices stays off until it's finished: open it in the rule editor, pick the board, list or card, then turn it on.",
    });
  });

  it("doesn't say other rules are on when there are none", async () => {
    prisma.rule.findMany.mockResolvedValue([
      {
        id: "invoices-rule",
        name: "Invoices",
        actions: [unfinishedTrelloAction()],
      },
    ] as never);
    prisma.rule.updateMany.mockResolvedValue({ count: 0 });

    const result = await toggleAllRulesAction(
      "ea_1" as never,
      { enabled: true } as never,
    );

    expect(result?.data).toEqual({
      success: true,
      message:
        "Invoices stays off until it's finished: open it in the rule editor, pick the board, list or card, then turn it on.",
    });
  });

  it("turns on every rule when none is unfinished", async () => {
    prisma.rule.findMany.mockResolvedValue([]);

    const result = await toggleAllRulesAction(
      "ea_1" as never,
      { enabled: true } as never,
    );

    expect(prisma.rule.updateMany).toHaveBeenCalledWith({
      where: { emailAccountId: "ea_1", organizationRuleId: null },
      data: { enabled: true },
    });
    expect(result?.data).toEqual({ success: true });
  });
});

describe("createRulesOnboardingAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fails the action without unhandled rejections when the provider cannot be created", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);

    (
      prisma.emailAccount.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: "ea_1",
      email: "owner@example.com",
      account: { userId: "u1", provider: "google" },
    });
    vi.mocked(createEmailProvider).mockRejectedValue(
      new SafeError("No refresh token"),
    );

    try {
      const result = await createRulesOnboardingAction(
        "ea_1" as never,
        [
          {
            key: SystemType.TO_REPLY,
            name: "To Reply",
            description: "",
            action: "label",
          },
          {
            key: null,
            name: "Custom",
            description: "",
            action: "label",
          },
        ] as never,
      );
      await new Promise((resolve) => setImmediate(resolve));

      expect(result?.serverError).toBeDefined();
      expect(unhandled).toEqual([]);
      expect(createEmailProvider).toHaveBeenCalledTimes(1);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});

function unfinishedTrelloAction() {
  return {
    type: ActionType.INTEGRATION,
    integrationName: "trello",
    integrationToolName: "create-card",
    integrationArgs: { boardId: "", name: "" },
  };
}
