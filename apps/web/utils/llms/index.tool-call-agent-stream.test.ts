import { simulateReadableStream, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import prisma from "@/utils/__mocks__/prisma";
import { Provider } from "@/utils/llms/config";
import { CONNECT_SUBSCRIPTION_MESSAGE } from "@/utils/llms/cli-provider";
import { assertTrialAiUsageAllowed } from "@/utils/llms/model-usage-guard";
import { LlmUseCase } from "@/utils/llms/use-cases";
import { toolCallAgentStream } from "./index";

const { mockGetModelForUseCase, mockClaudeCode } = vi.hoisted(() => ({
  mockGetModelForUseCase: vi.fn(),
  mockClaudeCode: vi.fn(),
}));

vi.mock("@/utils/prisma");

vi.mock("@/env", async (importActual) => {
  const actual = await importActual<typeof import("@/env")>();
  return {
    env: { ...actual.env, CLI_LLM_ENABLED: true },
  };
});

vi.mock("ai-sdk-provider-claude-code", () => ({
  claudeCode: mockClaudeCode,
  createAiSdkMcpServer: vi.fn(() => ({ type: "mcp-server" })),
  isAuthenticationError: () => false,
}));

vi.mock("@/utils/llms/use-cases", async (importActual) => ({
  ...(await importActual<typeof import("@/utils/llms/use-cases")>()),
  getModelForUseCase: mockGetModelForUseCase,
}));

vi.mock("@/utils/llms/model-usage-guard", () => ({
  assertTrialAiUsageAllowed: vi.fn(),
  shouldForceNanoModel: vi.fn().mockResolvedValue({ shouldForce: false }),
}));

vi.mock("@/utils/usage", () => ({ saveAiUsage: vi.fn() }));

vi.mock("@/utils/posthog", () => ({
  getPosthogLlmClient: vi.fn(() => undefined),
  isPosthogLlmEvalApproved: vi.fn(() => false),
}));

describe("toolCallAgentStream abort", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not start further tool calls once the run is stopped", async () => {
    const controller = new AbortController();
    // The stop lands while the first tool call is running.
    const archive = vi.fn(async () => {
      controller.abort();
      return "archived";
    });
    mockGetModelForUseCase.mockReturnValue({
      provider: "openai",
      modelName: "test-model",
      model: createToolCallingModel(),
      fallbackModels: [],
      hasUserApiKey: true,
    });

    const result = await toolCallAgentStream({
      userAi: {
        id: "user-id",
        email: "user@test.com",
        emailVerified: true,
        aiProvider: null,
        aiModel: null,
        aiApiKey: null,
        aiTaskModels: null,
      },
      userEmail: "user@test.com",
      emailAccountId: "email-account-id",
      useCase: LlmUseCase.AssistantChat,
      usageLabel: "test",
      promptHardening: { trust: "untrusted", level: "full" },
      messages: [{ role: "user", content: "Archive everything" }],
      tools: {
        archive: tool({ inputSchema: z.object({}), execute: archive }),
      },
      abortSignal: controller.signal,
    });

    const chunkTypes: string[] = [];
    for await (const chunk of result.toUIMessageStream()) {
      chunkTypes.push(chunk.type);
    }

    expect(chunkTypes).toContain("abort");
    expect(archive).toHaveBeenCalledTimes(1);
  });
});

describe("toolCallAgentStream with a user's Claude subscription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs bridged tool calls with the user's own login, not the server's", async () => {
    prisma.aiSubscriptionLogin.findUnique.mockResolvedValue({
      status: "connected",
      credential: "fake-user-oauth-token",
    } as any);
    mockClaudeCode.mockImplementation(() => createTextModel());
    mockGetModelForUseCase.mockReturnValue({
      provider: Provider.CLAUDE_CODE,
      modelName: "sonnet",
      model: createTextModel(),
      cliLogin: { userId: "user-1", allowServerLogin: false },
      fallbackModels: [],
      hasUserApiKey: true,
    });

    const result = await toolCallAgentStream({
      userAi: {
        id: "user-id",
        email: "user@test.com",
        emailVerified: true,
        aiProvider: null,
        aiModel: null,
        aiApiKey: null,
        aiTaskModels: null,
      },
      userEmail: "user@test.com",
      emailAccountId: "email-account-id",
      useCase: LlmUseCase.AssistantChat,
      usageLabel: "test",
      promptHardening: { trust: "untrusted", level: "full" },
      messages: [{ role: "user", content: "Archive everything" }],
      tools: {
        archive: tool({ inputSchema: z.object({}), execute: vi.fn() }),
      },
    });
    for await (const _chunk of result.toUIMessageStream()) {
      // drain
    }

    expect(mockClaudeCode).toHaveBeenCalled();
    for (const [, settings] of mockClaudeCode.mock.calls) {
      expect(settings.env).toMatchObject({
        CLAUDE_CODE_OAUTH_TOKEN: "fake-user-oauth-token",
        CLAUDE_CONFIG_DIR: expect.any(String),
      });
    }
    expect(prisma.aiSubscriptionLogin.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_provider: { userId: "user-1", provider: Provider.CLAUDE_CODE },
        },
      }),
    );
  });
});

describe("toolCallAgentStream spend guards for an owner's subscription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("counts an owner's run as their own only when their own login is connected", async () => {
    for (const [status, hasUserApiKey] of [
      ["connected", true],
      ["needs-reconnect", false],
    ] as const) {
      vi.mocked(assertTrialAiUsageAllowed).mockClear();
      prisma.aiSubscriptionLogin.findUnique.mockResolvedValue({
        status,
        credential: "fake-user-oauth-token",
      } as any);
      mockGetModelForUseCase.mockReturnValue({
        provider: Provider.CLAUDE_CODE,
        modelName: "sonnet",
        model: createTextModel(),
        cliLogin: { userId: "user-1", allowServerLogin: true },
        fallbackModels: [],
        hasUserApiKey: false,
      });

      const result = await toolCallAgentStream({
        userAi: {
          id: "user-1",
          email: "owner@test.com",
          emailVerified: true,
          aiProvider: Provider.CLAUDE_CODE,
          aiModel: null,
          aiApiKey: null,
          aiTaskModels: null,
        },
        userEmail: "owner@test.com",
        emailAccountId: "email-account-id",
        useCase: LlmUseCase.AssistantChat,
        usageLabel: "test",
        promptHardening: { trust: "untrusted", level: "full" },
        messages: [{ role: "user", content: "Hi" }],
        tools: {},
      });
      for await (const _chunk of result.toUIMessageStream()) {
        // drain
      }

      expect(assertTrialAiUsageAllowed).toHaveBeenCalledWith(
        expect.objectContaining({ hasUserApiKey }),
      );
    }
  });
});

describe("toolCallAgentStream with a missing subscription login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fails before streaming when a user's own login isn't connected", async () => {
    prisma.aiSubscriptionLogin.findUnique.mockResolvedValue(null);
    mockGetModelForUseCase.mockReturnValue({
      provider: Provider.CLAUDE_CODE,
      modelName: "sonnet",
      model: createTextModel(),
      cliLogin: { userId: "user-1", allowServerLogin: false },
      fallbackModels: [],
      hasUserApiKey: true,
    });

    await expect(
      toolCallAgentStream({
        userAi: {
          id: "user-1",
          email: "user@test.com",
          emailVerified: true,
          aiProvider: Provider.CLAUDE_CODE,
          aiModel: null,
          aiApiKey: null,
          aiTaskModels: null,
        },
        userEmail: "user@test.com",
        emailAccountId: "email-account-id",
        useCase: LlmUseCase.AssistantChat,
        usageLabel: "test",
        promptHardening: { trust: "untrusted", level: "full" },
        messages: [{ role: "user", content: "Hi" }],
        tools: {},
      }),
    ).rejects.toThrow(CONNECT_SUBSCRIPTION_MESSAGE);
    expect(mockClaudeCode).not.toHaveBeenCalled();
  });
});

function createTextModel() {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: "done" },
          { type: "text-end", id: "t1" },
          {
            type: "finish",
            finishReason: { unified: "stop", raw: undefined },
            usage: {
              inputTokens: {
                total: 1,
                noCache: 1,
                cacheRead: undefined,
                cacheWrite: undefined,
              },
              outputTokens: { total: 1, text: 1, reasoning: undefined },
            },
          },
        ],
      }),
    }),
  });
}

function createToolCallingModel() {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "archive",
            input: "{}",
          },
          {
            type: "tool-call",
            toolCallId: "call-2",
            toolName: "archive",
            input: "{}",
          },
          {
            type: "finish",
            finishReason: { unified: "tool-calls", raw: undefined },
            usage: {
              inputTokens: {
                total: 1,
                noCache: 1,
                cacheRead: undefined,
                cacheWrite: undefined,
              },
              outputTokens: { total: 1, text: 1, reasoning: undefined },
            },
          },
        ],
      }),
    }),
  });
}
