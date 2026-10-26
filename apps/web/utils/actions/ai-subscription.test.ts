import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/__mocks__/prisma";
import { Prisma } from "@/generated/prisma/client";
import { Provider } from "@/utils/llms/config";
import { disconnectAiSubscriptionAction } from "./ai-subscription";

vi.mock("@/utils/prisma");
vi.mock("@/utils/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "user-1", email: "user@example.com" },
  })),
}));
vi.mock("@/utils/llms/subscription-login", () => ({
  cancelSubscriptionLogin: vi.fn(),
  disconnectSubscriptionLogin: vi.fn(),
  startSubscriptionLogin: vi.fn(),
  submitSubscriptionLoginCode: vi.fn(),
}));

describe("disconnectAiSubscriptionAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clears the main provider and every task entry that used the account", async () => {
    mockUser({
      aiProvider: Provider.CLAUDE_CODE,
      aiTaskModels: {
        chat: { provider: Provider.CLAUDE_CODE, model: "opus" },
        economy: { provider: Provider.CODEX_CLI, model: "gpt-6-luna" },
      },
    });

    await disconnectAiSubscriptionAction({ provider: Provider.CLAUDE_CODE });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: {
        aiProvider: null,
        aiModel: null,
        aiApiKey: null,
        aiTaskModels: {
          economy: { provider: Provider.CODEX_CLI, model: "gpt-6-luna" },
        },
      },
    });
  });

  it("keeps an API-key main provider and drops only the account's task entries", async () => {
    mockUser({
      aiProvider: Provider.OPEN_AI,
      aiTaskModels: {
        nano: { provider: Provider.CODEX_CLI, model: "gpt-6-luna" },
      },
    });

    await disconnectAiSubscriptionAction({ provider: Provider.CODEX_CLI });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { aiTaskModels: Prisma.DbNull },
    });
  });

  it("leaves settings alone when nothing used the account", async () => {
    mockUser({ aiProvider: Provider.OPEN_AI, aiTaskModels: null });

    await disconnectAiSubscriptionAction({ provider: Provider.CODEX_CLI });

    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

function mockUser(user: {
  aiProvider: string | null;
  aiTaskModels: Prisma.JsonValue;
}) {
  prisma.user.findUnique.mockResolvedValue(
    user as Awaited<ReturnType<typeof prisma.user.findUnique>>,
  );
}
