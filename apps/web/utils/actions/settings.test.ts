import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/__mocks__/prisma";
import {
  updateDecisionModelApiKeyAction,
  updateSensitiveDataPolicyAction,
  updateAiSettingsAction,
} from "./settings";
import { Prisma } from "@/generated/prisma/client";
import {
  Provider,
  SUBSCRIPTION_MODELS,
  type SubscriptionModel,
} from "@/utils/llms/config";
import { getSubscriptionModels } from "@/utils/llms/subscription-models";

vi.mock("@/utils/prisma");
vi.mock("@/utils/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "user-1", email: "user@example.com" },
  })),
}));

const { clearSpecificErrorMessagesMock, mockEnv } = vi.hoisted(() => ({
  clearSpecificErrorMessagesMock: vi.fn(),
  mockEnv: {
    AZURE_RESOURCE_NAME: "azure-resource",
    CLI_LLM_ENABLED: true,
    CLI_LLM_OWNER_EMAILS: "owner@example.com" as string | undefined,
    EMAIL_ENCRYPT_SECRET: "test-email-secret",
    EMAIL_ENCRYPT_SALT: "test-email-salt",
    NEXT_PUBLIC_AI_MODEL_SETTINGS_DISABLED: false,
    NEXT_PUBLIC_SENSITIVE_DATA_POLICY_LOCKED: false,
  },
}));

vi.mock("@/env", () => ({
  env: mockEnv,
}));

// The real list comes from the Codex CLI; tests use the built-in one unless a
// test sets its own.
vi.mock("@/utils/llms/subscription-models", () => ({
  getSubscriptionModels: vi.fn(),
}));

vi.mock("@/utils/error-messages", async (importActual) => {
  const actual = await importActual<typeof import("@/utils/error-messages")>();

  return {
    ...actual,
    clearSpecificErrorMessages: clearSpecificErrorMessagesMock,
  };
});

describe("updateAiSettingsAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser({ email: "user@example.com" });
    prisma.user.updateMany.mockResolvedValue({ count: 1 } as never);
    prisma.aiSubscriptionLogin.findMany.mockResolvedValue([]);
    mockEnv.CLI_LLM_ENABLED = true;
    mockEnv.CLI_LLM_OWNER_EMAILS = "owner@example.com";
    mockEnv.NEXT_PUBLIC_AI_MODEL_SETTINGS_DISABLED = false;
    mockEnv.NEXT_PUBLIC_SENSITIVE_DATA_POLICY_LOCKED = false;
    vi.mocked(getSubscriptionModels).mockImplementation(async (provider) => [
      ...(SUBSCRIPTION_MODELS[provider]?.models ?? []),
    ]);
  });

  it("keeps the stored API key when the provider is unchanged and the form leaves it blank", async () => {
    await updateAiSettingsAction({
      aiProvider: Provider.OPEN_AI,
      aiModel: "gpt-5.1",
      aiApiKey: undefined,
    });

    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: {
        aiProvider: Provider.OPEN_AI,
        aiModel: "gpt-5.1",
        aiApiKey: "stored-api-key",
        aiReasoningEffort: null,
        aiTaskModels: Prisma.DbNull,
      },
    });
    expect(clearSpecificErrorMessagesMock).toHaveBeenCalled();
  });

  it("requires a new API key when switching providers", async () => {
    const result = await updateAiSettingsAction({
      aiProvider: Provider.ANTHROPIC,
      aiModel: "claude-sonnet-4-5",
      aiApiKey: undefined,
    });

    expect(result?.serverError).toBe(
      "You must provide an API key for this provider",
    );
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it("rejects account-level AI model updates when deployment settings are disabled", async () => {
    mockEnv.NEXT_PUBLIC_AI_MODEL_SETTINGS_DISABLED = true;

    const result = await updateAiSettingsAction({
      aiProvider: Provider.OPEN_AI,
      aiModel: "gpt-5.1",
      aiApiKey: "new-api-key",
    });

    expect(result?.serverError).toBe(
      "AI model settings are managed by the deployment.",
    );
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it("saves a connected subscription as the main provider without an API key", async () => {
    mockConnectedLogins([Provider.CLAUDE_CODE]);

    const result = await updateAiSettingsAction({
      aiProvider: Provider.CLAUDE_CODE,
      aiModel: "opus",
      aiApiKey: "ignored-key",
    });

    expect(result?.serverError).toBeUndefined();
    expect(prisma.aiSubscriptionLogin.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1", status: "connected" },
      select: { provider: true },
    });
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: {
        aiProvider: Provider.CLAUDE_CODE,
        aiModel: "opus",
        aiApiKey: null,
        aiReasoningEffort: null,
        aiTaskModels: Prisma.DbNull,
      },
    });
  });

  it("rejects a subscription provider that isn't connected", async () => {
    const result = await updateAiSettingsAction({
      aiProvider: Provider.CODEX_CLI,
      aiModel: "gpt-6.1-sol",
    });

    expect(result?.serverError).toBe("Connect this account before using it.");
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it("lets a verified owner pick subscriptions they haven't connected, which run on the server login", async () => {
    mockUser({ email: "owner@example.com" });
    const aiTaskModels = {
      economy: { provider: Provider.CLAUDE_CODE, model: "haiku" },
    };

    const result = await updateAiSettingsAction({
      aiProvider: Provider.CODEX_CLI,
      aiModel: "gpt-6.1-sol",
      aiTaskModels,
    });

    expect(result?.serverError).toBeUndefined();
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: {
        aiProvider: Provider.CODEX_CLI,
        aiModel: "gpt-6.1-sol",
        aiApiKey: null,
        aiReasoningEffort: null,
        aiTaskModels: {
          economy: { ...aiTaskModels.economy, reasoningEffort: null },
        },
      },
    });
  });

  it("does not treat an unverified owner address as the owner when saving", async () => {
    mockUser({ email: "owner@example.com", emailVerified: false });

    const result = await updateAiSettingsAction({
      aiProvider: Provider.CODEX_CLI,
      aiModel: "gpt-6.1-sol",
    });

    expect(result?.serverError).toBe("Connect this account before using it.");
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a subscription model from another provider's list", async () => {
    mockConnectedLogins([Provider.CLAUDE_CODE, Provider.CODEX_CLI]);

    const mainResult = await updateAiSettingsAction({
      aiProvider: Provider.CLAUDE_CODE,
      aiModel: "gpt-6.1-sol",
    });
    const taskResult = await updateAiSettingsAction({
      aiProvider: Provider.CLAUDE_CODE,
      aiModel: "sonnet",
      aiTaskModels: {
        economy: { provider: Provider.CODEX_CLI, model: "opus" },
      },
    });

    expect(mainResult?.serverError).toBe(
      "Pick a model from this account's list.",
    );
    expect(taskResult?.serverError).toBe(
      "Pick a model from this account's list.",
    );
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it("saves per-task entries on the main API key provider and a connected subscription", async () => {
    mockConnectedLogins([Provider.CODEX_CLI]);
    const aiTaskModels = {
      chat: { provider: Provider.OPEN_AI, model: "gpt-5.1-mini" },
      economy: { provider: Provider.CODEX_CLI, model: "gpt-6-luna" },
    };

    await updateAiSettingsAction({
      aiProvider: Provider.OPEN_AI,
      aiModel: "gpt-5.1",
      aiTaskModels,
    });

    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: {
        aiProvider: Provider.OPEN_AI,
        aiModel: "gpt-5.1",
        aiApiKey: "stored-api-key",
        aiReasoningEffort: null,
        aiTaskModels: {
          chat: { ...aiTaskModels.chat, reasoningEffort: null },
          economy: { ...aiTaskModels.economy, reasoningEffort: null },
        },
      },
    });
  });

  it("rejects a per-task provider that is neither the main provider nor connected", async () => {
    mockConnectedLogins([Provider.CODEX_CLI]);

    const notMain = await updateAiSettingsAction({
      aiProvider: Provider.OPEN_AI,
      aiModel: "gpt-5.1",
      aiTaskModels: {
        draft: { provider: Provider.ANTHROPIC, model: "claude-sonnet-4-5" },
      },
    });
    const notConnected = await updateAiSettingsAction({
      aiProvider: Provider.CODEX_CLI,
      aiModel: "gpt-6.1-sol",
      aiTaskModels: { chat: { provider: Provider.CLAUDE_CODE, model: "opus" } },
    });

    const message =
      "Each task can only use your main provider or an AI subscription you've connected.";
    expect(notMain?.serverError).toBe(message);
    expect(notConnected?.serverError).toBe(message);
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it("accepts a model the CLI lists even when the built-in list lacks it", async () => {
    mockConnectedLogins([Provider.CODEX_CLI]);
    vi.mocked(getSubscriptionModels).mockResolvedValue([
      codexModel("gpt-7-nova", ["low", "medium", "high"]),
    ]);

    const listed = await updateAiSettingsAction({
      aiProvider: Provider.CODEX_CLI,
      aiModel: "gpt-7-nova",
    });
    const unlisted = await updateAiSettingsAction({
      aiProvider: Provider.CODEX_CLI,
      aiModel: "gpt-6.1-sol",
    });

    expect(listed?.serverError).toBeUndefined();
    // Checked against this user's own list, read with their own login.
    expect(getSubscriptionModels).toHaveBeenCalledWith(Provider.CODEX_CLI, {
      userId: "user-1",
      allowServerLogin: false,
    });
    expect(unlisted?.serverError).toBe(
      "Pick a model from this account's list.",
    );
    expect(prisma.user.updateMany).toHaveBeenCalledTimes(1);
  });

  it("keeps saved models the current list lacks while they're left unchanged, and nothing new", async () => {
    mockConnectedLogins([Provider.CODEX_CLI]);
    prisma.user.findUnique.mockResolvedValue({
      email: "user@example.com",
      emailVerified: true,
      aiProvider: Provider.CODEX_CLI,
      aiModel: "gpt-6.2-x",
      aiReasoningEffort: "high",
      aiTaskModels: {
        economy: {
          provider: Provider.CODEX_CLI,
          model: "gpt-6.2-x-mini",
          reasoningEffort: "low",
        },
      },
    } as Awaited<ReturnType<typeof prisma.user.findUnique>>);
    const saved = {
      aiProvider: Provider.CODEX_CLI,
      aiModel: "gpt-6.2-x",
      aiReasoningEffort: "high" as const,
      aiTaskModels: {
        economy: {
          provider: Provider.CODEX_CLI,
          model: "gpt-6.2-x-mini",
          reasoningEffort: "low" as const,
        },
      },
    };

    // The listing timed out, so only the built-in list is known.
    const unchanged = await updateAiSettingsAction(saved);
    const newLevel = await updateAiSettingsAction({
      ...saved,
      aiReasoningEffort: "medium",
    });
    const newTaskModel = await updateAiSettingsAction({
      ...saved,
      aiTaskModels: {
        nano: { provider: Provider.CODEX_CLI, model: "gpt-6.2-x-mini" },
      },
    });

    expect(unchanged?.serverError).toBeUndefined();
    expect(newLevel?.serverError).toBe(
      "Pick a model from this account's list.",
    );
    expect(newTaskModel?.serverError).toBe(
      "Pick a model from this account's list.",
    );
    expect(prisma.user.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ aiModel: "gpt-6.2-x" }),
      }),
    );
  });

  it("saves thinking levels the model offers, for the main model and per task", async () => {
    mockConnectedLogins([Provider.CODEX_CLI]);

    const result = await updateAiSettingsAction({
      aiProvider: Provider.CODEX_CLI,
      aiModel: "gpt-6.1-sol",
      aiReasoningEffort: "high",
      aiTaskModels: {
        economy: {
          provider: Provider.CODEX_CLI,
          model: "gpt-6-luna",
          reasoningEffort: "low",
        },
      },
    });

    expect(result?.serverError).toBeUndefined();
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: {
        aiProvider: Provider.CODEX_CLI,
        aiModel: "gpt-6.1-sol",
        aiApiKey: null,
        aiReasoningEffort: "high",
        aiTaskModels: {
          economy: {
            provider: Provider.CODEX_CLI,
            model: "gpt-6-luna",
            reasoningEffort: "low",
          },
        },
      },
    });
  });

  it("rejects a thinking level the model doesn't offer", async () => {
    mockConnectedLogins([Provider.CLAUDE_CODE]);

    const main = await updateAiSettingsAction({
      aiProvider: Provider.CLAUDE_CODE,
      aiModel: "haiku",
      aiReasoningEffort: "low",
    });
    const task = await updateAiSettingsAction({
      aiProvider: Provider.CLAUDE_CODE,
      aiModel: "sonnet",
      aiTaskModels: {
        nano: {
          provider: Provider.CLAUDE_CODE,
          model: "haiku",
          reasoningEffort: "max",
        },
      },
    });

    expect(main?.serverError).toBe(
      "Haiku doesn't offer that thinking level. Pick another one.",
    );
    expect(task?.serverError).toBe(
      "Haiku doesn't offer that thinking level. Pick another one.",
    );
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it("rejects thinking levels outside the known set before they reach the CLI", async () => {
    mockConnectedLogins([Provider.CODEX_CLI]);

    const result = await updateAiSettingsAction({
      aiProvider: Provider.CODEX_CLI,
      aiModel: "gpt-6.1-sol",
      aiReasoningEffort: "ultra --dangerously-bypass" as never,
    });

    expect(result?.validationErrors).toBeDefined();
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it("drops thinking levels on API key providers", async () => {
    await updateAiSettingsAction({
      aiProvider: Provider.OPEN_AI,
      aiModel: "gpt-5.1",
      aiReasoningEffort: "high",
      aiTaskModels: {
        chat: {
          provider: Provider.OPEN_AI,
          model: "gpt-5.1",
          reasoningEffort: "high",
        },
      },
    });

    expect(prisma.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          aiReasoningEffort: null,
          aiTaskModels: {
            chat: {
              provider: Provider.OPEN_AI,
              model: "gpt-5.1",
              reasoningEffort: null,
            },
          },
        }),
      }),
    );
  });

  it("rejects subscription providers when the server has them turned off", async () => {
    mockEnv.CLI_LLM_ENABLED = false;
    mockConnectedLogins([Provider.CLAUDE_CODE]);

    const result = await updateAiSettingsAction({
      aiProvider: Provider.CLAUDE_CODE,
      aiModel: "sonnet",
    });

    expect(result?.serverError).toBe(
      "AI subscriptions aren't enabled on this server.",
    );
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });
});

describe("updateDecisionModelApiKeyAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv.NEXT_PUBLIC_AI_MODEL_SETTINGS_DISABLED = false;
  });

  it("saves and removes the user's own key for the chosen provider only", async () => {
    await updateDecisionModelApiKeyAction({
      provider: "typesafe",
      apiKey: "  fake-typesafe-key  ",
    });
    await updateDecisionModelApiKeyAction({
      provider: "openrouter",
      apiKey: null,
    });

    expect(prisma.user.update).toHaveBeenNthCalledWith(1, {
      where: { id: "user-1" },
      data: { decisionTypesafeApiKey: "fake-typesafe-key" },
    });
    expect(prisma.user.update).toHaveBeenNthCalledWith(2, {
      where: { id: "user-1" },
      data: { decisionOpenrouterApiKey: null },
    });
  });

  it("rejects a blank key", async () => {
    const result = await updateDecisionModelApiKeyAction({
      provider: "typesafe",
      apiKey: "   ",
    });

    expect(result?.validationErrors).toBeDefined();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

describe("updateSensitiveDataPolicyAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv.NEXT_PUBLIC_SENSITIVE_DATA_POLICY_LOCKED = false;
    prisma.emailAccount.findUnique.mockResolvedValue({
      email: "user@example.com",
      account: {
        userId: "user-1",
        provider: "google",
      },
    } as Awaited<ReturnType<typeof prisma.emailAccount.findUnique>>);
  });

  it("saves the account-level policy when deployment policy is editable", async () => {
    await updateSensitiveDataPolicyAction("email-account-1", {
      sensitiveDataPolicy: "REDACT",
    });

    expect(prisma.emailAccount.update).toHaveBeenCalledWith({
      where: { id: "email-account-1" },
      data: { sensitiveDataPolicy: "REDACT" },
    });
  });

  it("rejects account-level policy updates when deployment policy is locked", async () => {
    mockEnv.NEXT_PUBLIC_SENSITIVE_DATA_POLICY_LOCKED = true;

    const result = await updateSensitiveDataPolicyAction("email-account-1", {
      sensitiveDataPolicy: "BLOCK",
    });

    expect(result?.serverError).toBe(
      "Sensitive data protection is managed by the deployment.",
    );
    expect(prisma.emailAccount.update).not.toHaveBeenCalled();
  });
});

function mockConnectedLogins(providers: string[]) {
  prisma.aiSubscriptionLogin.findMany.mockResolvedValue(
    providers.map((provider) => ({ provider })) as Awaited<
      ReturnType<typeof prisma.aiSubscriptionLogin.findMany>
    >,
  );
}

function mockUser({
  email,
  emailVerified = true,
}: {
  email: string;
  emailVerified?: boolean;
}) {
  prisma.user.findUnique.mockResolvedValue({
    email,
    emailVerified,
    aiProvider: Provider.OPEN_AI,
    aiApiKey: "stored-api-key",
  } as Awaited<ReturnType<typeof prisma.user.findUnique>>);
}

function codexModel(
  value: string,
  efforts: SubscriptionModel["efforts"],
): SubscriptionModel {
  return {
    value,
    label: value,
    description: null,
    efforts,
    defaultEffort: null,
    weight: null,
  };
}
