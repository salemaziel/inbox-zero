import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Provider } from "./config";

const homesDir = path.join(os.tmpdir(), "inbox-zero-cli-provider-test");
const prismaMock = vi.hoisted(() => ({
  aiSubscriptionLogin: { findUnique: vi.fn(), updateMany: vi.fn() },
}));

describe("createCliLanguageModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock("@/env");
    vi.doUnmock("ai-sdk-provider-codex-cli");
    vi.doUnmock("ai-sdk-provider-claude-code");
    vi.doUnmock("@/utils/prisma");
    vi.unstubAllEnvs();
  });

  it("loads the Codex provider lazily once and forwards calls", async () => {
    const doGenerate = vi.fn().mockResolvedValue({ text: "generated" });
    const doStream = vi.fn().mockResolvedValue({ stream: "chunk" });
    const codexExec = vi.fn(() => ({
      doGenerate,
      doStream,
    }));

    const { createCliLanguageModel } = await loadCliProviderModule({
      envOverrides: {
        CODEX_CLI_ALLOW_NPX: true,
        CODEX_CLI_PATH: "/usr/local/bin/codex",
      },
      codexModule: { codexExec },
    });

    const model = createCliLanguageModel({
      provider: Provider.CODEX_CLI,
      modelName: "gpt-5.3-codex",
    }) as any;

    await expect(model.doGenerate("generate-request")).resolves.toEqual({
      text: "generated",
    });
    await expect(model.doStream("stream-request")).resolves.toEqual({
      stream: "chunk",
    });

    expect(codexExec).toHaveBeenCalledTimes(1);
    expect(codexExec).toHaveBeenCalledWith("gpt-5.3-codex", {
      allowNpx: true,
      skipGitRepoCheck: true,
      approvalMode: "never",
      sandboxMode: "read-only",
      codexPath: "/usr/local/bin/codex",
      logger: false,
    });
    expect(doGenerate).toHaveBeenCalledWith("generate-request");
    expect(doStream).toHaveBeenCalledWith("stream-request");
  });

  it("passes Claude Code sandbox settings through to the provider package", async () => {
    const doStream = vi.fn().mockResolvedValue({ stream: "chunk" });
    const claudeCode = vi.fn(() => ({
      doGenerate: vi.fn(),
      doStream,
    }));

    const { createCliLanguageModel } = await loadCliProviderModule({
      claudeModule: { claudeCode },
    });

    const model = createCliLanguageModel({
      provider: Provider.CLAUDE_CODE,
      modelName: "sonnet",
    }) as any;

    await expect(model.doStream("stream-request")).resolves.toEqual({
      stream: "chunk",
    });

    expect(claudeCode).toHaveBeenCalledTimes(1);
    expect(claudeCode).toHaveBeenCalledWith("sonnet", {
      settingSources: [],
      allowedTools: [],
      permissionMode: "default",
      sandbox: { enabled: true },
    });
  });

  it("bridges AI SDK tools to Claude Code through MCP", async () => {
    const doGenerate = vi.fn().mockResolvedValue({
      content: [
        {
          type: "tool-call",
          toolName: "mcp__inboxzero__searchInbox",
          input: { query: "hello" },
        },
      ],
    });
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          type: "tool-call",
          toolName: "mcp__inboxzero__createRule",
          input: { label: "later" },
        });
        controller.close();
      },
    });
    const doStream = vi.fn().mockResolvedValue({ stream });
    const innerModel = {
      specificationVersion: "v4",
      provider: "claude-code",
      modelId: "sonnet",
      supportedUrls: {},
      doGenerate,
      doStream,
    };
    const claudeCode = vi.fn(() => innerModel);
    const mcpServer = { type: "mcp-server" };
    const createAiSdkMcpServer = vi.fn(() => mcpServer);
    const searchInbox = {
      description: "Search inbox",
      inputSchema: {},
      execute: vi.fn(),
    };
    const createRule = {
      description: "Create rule",
      inputSchema: {},
      execute: vi.fn(),
    };

    const { createClaudeCodeLanguageModelWithBridgedTools } =
      await loadCliProviderModule({
        claudeModule: { claudeCode, createAiSdkMcpServer },
      });

    const model = (await createClaudeCodeLanguageModelWithBridgedTools({
      modelName: "sonnet",
      tools: { searchInbox, createRule },
    })) as any;

    await expect(model.doGenerate("generate-request")).resolves.toEqual({
      content: [
        {
          type: "tool-call",
          toolName: "searchInbox",
          input: { query: "hello" },
        },
      ],
    });
    const streamResult = await model.doStream("stream-request");
    const reader = streamResult.stream.getReader();
    await expect(reader.read()).resolves.toEqual({
      done: false,
      value: {
        type: "tool-call",
        toolName: "createRule",
        input: { label: "later" },
      },
    });

    expect(createAiSdkMcpServer).toHaveBeenCalledWith("inboxzero", {
      searchInbox,
      createRule,
    });
    expect(claudeCode).toHaveBeenCalledWith("sonnet", {
      settingSources: [],
      allowedTools: [
        "mcp__inboxzero__searchInbox",
        "mcp__inboxzero__createRule",
      ],
      mcpServers: { inboxzero: mcpServer },
      permissionMode: "default",
      sandbox: { enabled: true },
    });
    expect(doGenerate).toHaveBeenCalledWith("generate-request");
    expect(doStream).toHaveBeenCalledWith("stream-request");
  });

  it("surfaces a clear error when the provider package is missing its factory export", async () => {
    const { createCliLanguageModel } = await loadCliProviderModule({
      codexModule: { codexExec: undefined },
    });

    const model = createCliLanguageModel({
      provider: Provider.CODEX_CLI,
      modelName: "gpt-5.3-codex",
    }) as any;

    await expect(model.doGenerate("generate-request")).rejects.toThrow(
      'CLI LLM provider "codex-cli" package does not export "codexExec". Check the installed package version.',
    );
  });

  it("surfaces a clear error when the loaded model is missing a required method", async () => {
    const codexExec = vi.fn(() => ({
      doGenerate: vi.fn(),
    }));

    const { createCliLanguageModel } = await loadCliProviderModule({
      codexModule: { codexExec },
    });

    const model = createCliLanguageModel({
      provider: Provider.CODEX_CLI,
      modelName: "gpt-5.3-codex",
    }) as any;

    await expect(model.doStream("stream-request")).rejects.toThrow(
      'CLI LLM provider "codex-cli" returned a model without doStream. Check the installed package version.',
    );
  });

  it("runs Codex with the user's own CLI home and blanks host API keys", async () => {
    const codexExec = vi.fn(() => ({
      doGenerate: vi.fn().mockResolvedValue({ text: "ok" }),
      doStream: vi.fn(),
    }));
    prismaMock.aiSubscriptionLogin.findUnique.mockResolvedValue({
      status: "connected",
      credential: null,
    });

    const { createCliLanguageModel } = await loadCliProviderModule({
      codexModule: { codexExec, isAuthenticationError: () => false },
    });
    const model = createCliLanguageModel({
      provider: Provider.CODEX_CLI,
      modelName: "gpt-5.3-codex",
      cliLogin: { userId: "user1", allowServerLogin: false },
    }) as any;

    await expect(model.doGenerate("request")).resolves.toEqual({ text: "ok" });
    expect(codexExec).toHaveBeenCalledWith(
      "gpt-5.3-codex",
      expect.objectContaining({
        env: {
          CODEX_HOME: path.join(homesDir, "user1", "codex"),
          OPENAI_API_KEY: "",
          CODEX_API_KEY: "",
        },
      }),
    );
  });

  it("runs Claude Code with the user's token and blanks every inherited host credential", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "fake-host-api-key");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "fake-host-auth-token");
    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "fake-host-oauth-token");
    const claudeCode = vi.fn(() => ({
      doGenerate: vi.fn().mockResolvedValue({ text: "ok" }),
      doStream: vi.fn(),
    }));
    prismaMock.aiSubscriptionLogin.findUnique.mockResolvedValue({
      status: "connected",
      credential: "fake-user-oauth-token",
    });

    const { createCliLanguageModel } = await loadCliProviderModule({
      claudeModule: { claudeCode, isAuthenticationError: () => false },
    });
    const model = createCliLanguageModel({
      provider: Provider.CLAUDE_CODE,
      modelName: "sonnet",
      cliLogin: { userId: "user1", allowServerLogin: true },
    }) as any;
    await model.doGenerate("request");

    const settings = (claudeCode.mock.calls[0] as unknown[])[1] as {
      env: Record<string, string>;
    };
    expect(settings.env).toMatchObject({
      ANTHROPIC_API_KEY: "",
      ANTHROPIC_AUTH_TOKEN: "",
      CLAUDE_CODE_OAUTH_TOKEN: "fake-user-oauth-token",
      CLAUDE_CONFIG_DIR: path.join(homesDir, "user1", "claude"),
    });
  });

  it("uses the server login for an owner who has not connected an account", async () => {
    const codexExec = vi.fn(() => ({
      doGenerate: vi.fn().mockResolvedValue({ text: "ok" }),
      doStream: vi.fn(),
    }));
    prismaMock.aiSubscriptionLogin.findUnique.mockResolvedValue(null);

    const { createCliLanguageModel } = await loadCliProviderModule({
      codexModule: { codexExec, isAuthenticationError: () => false },
    });
    const model = createCliLanguageModel({
      provider: Provider.CODEX_CLI,
      modelName: "gpt-5.3-codex",
      cliLogin: { userId: "user1", allowServerLogin: true },
    }) as any;
    await model.doGenerate("request");

    expect(codexExec).toHaveBeenCalledWith(
      "gpt-5.3-codex",
      expect.not.objectContaining({ env: expect.anything() }),
    );
  });

  it("asks a user without the server login to connect or reconnect", async () => {
    const codexExec = vi.fn();
    const {
      createCliLanguageModel,
      CONNECT_SUBSCRIPTION_MESSAGE,
      RECONNECT_SUBSCRIPTION_MESSAGE,
    } = await loadCliProviderModule({ codexModule: { codexExec } });
    const scope = { userId: "user1", allowServerLogin: false };

    prismaMock.aiSubscriptionLogin.findUnique.mockResolvedValueOnce(null);
    const notConnected = createCliLanguageModel({
      provider: Provider.CODEX_CLI,
      modelName: "gpt-5.3-codex",
      cliLogin: scope,
    }) as any;
    await expect(notConnected.doGenerate("request")).rejects.toThrow(
      CONNECT_SUBSCRIPTION_MESSAGE,
    );

    prismaMock.aiSubscriptionLogin.findUnique.mockResolvedValueOnce({
      status: "needs-reconnect",
      credential: null,
    });
    const signedOut = createCliLanguageModel({
      provider: Provider.CODEX_CLI,
      modelName: "gpt-5.3-codex",
      cliLogin: scope,
    }) as any;
    await expect(signedOut.doGenerate("request")).rejects.toThrow(
      RECONNECT_SUBSCRIPTION_MESSAGE,
    );
    expect(codexExec).not.toHaveBeenCalled();
  });

  it("marks a rejected user login for reconnect", async () => {
    const authError = new Error("unauthorized");
    const codexExec = vi.fn(() => ({
      doGenerate: vi.fn().mockRejectedValue(authError),
      doStream: vi.fn(),
    }));
    prismaMock.aiSubscriptionLogin.findUnique.mockResolvedValue({
      status: "connected",
      credential: null,
    });

    const { createCliLanguageModel, RECONNECT_SUBSCRIPTION_MESSAGE } =
      await loadCliProviderModule({
        codexModule: {
          codexExec,
          isAuthenticationError: (error: unknown) => error === authError,
        },
      });
    const model = createCliLanguageModel({
      provider: Provider.CODEX_CLI,
      modelName: "gpt-5.3-codex",
      cliLogin: { userId: "user1", allowServerLogin: false },
    }) as any;

    await expect(model.doGenerate("request")).rejects.toThrow(
      RECONNECT_SUBSCRIPTION_MESSAGE,
    );
    expect(prismaMock.aiSubscriptionLogin.updateMany).toHaveBeenCalledWith({
      where: { userId: "user1", provider: Provider.CODEX_CLI },
      data: expect.objectContaining({ status: "needs-reconnect" }),
    });
  });

  it("runs one Codex call at a time per user", async () => {
    let resolveFirst: (value: unknown) => void = () => {};
    const doGenerate = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({ text: "second" });
    const codexExec = vi.fn(() => ({ doGenerate, doStream: vi.fn() }));
    prismaMock.aiSubscriptionLogin.findUnique.mockResolvedValue({
      status: "connected",
      credential: null,
    });

    const { createCliLanguageModel } = await loadCliProviderModule({
      codexModule: { codexExec, isAuthenticationError: () => false },
    });
    const model = createCliLanguageModel({
      provider: Provider.CODEX_CLI,
      modelName: "gpt-5.3-codex",
      cliLogin: { userId: "user1", allowServerLogin: false },
    }) as any;

    const first = model.doGenerate("first");
    const second = model.doGenerate("second");
    await vi.waitFor(() => expect(doGenerate).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(doGenerate).toHaveBeenCalledTimes(1);

    resolveFirst({ text: "first" });
    await expect(first).resolves.toEqual({ text: "first" });
    await expect(second).resolves.toEqual({ text: "second" });
  });
});

async function loadCliProviderModule({
  envOverrides,
  codexModule,
  claudeModule,
}: {
  envOverrides?: Partial<{
    CLI_LLM_ENABLED: boolean;
    CODEX_CLI_ALLOW_NPX: boolean;
    CODEX_CLI_PATH: string | undefined;
  }>;
  codexModule?: Record<string, unknown>;
  claudeModule?: Record<string, unknown>;
} = {}) {
  vi.doMock("@/env", () => ({
    env: {
      CLI_LLM_ENABLED: true,
      CODEX_CLI_ALLOW_NPX: false,
      CODEX_CLI_PATH: undefined,
      CLI_LLM_USER_HOMES_DIR: homesDir,
      ...envOverrides,
    },
  }));
  vi.doMock("@/utils/prisma", () => ({ default: prismaMock }));

  if (codexModule) {
    vi.doMock("ai-sdk-provider-codex-cli", () => codexModule);
  }

  if (claudeModule) {
    vi.doMock("ai-sdk-provider-claude-code", () => claudeModule);
  }

  return import("./cli-provider");
}
