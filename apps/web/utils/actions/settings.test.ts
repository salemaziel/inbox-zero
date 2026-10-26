import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/__mocks__/prisma";
import {
  updateSensitiveDataPolicyAction,
  updateAiSettingsAction,
} from "./settings";
import { Prisma } from "@/generated/prisma/client";
import { Provider } from "@/utils/llms/config";

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
        aiTaskModels,
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

    expect(mainResult?.validationErrors).toBeDefined();
    expect(taskResult?.validationErrors).toBeDefined();
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
        aiTaskModels,
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
