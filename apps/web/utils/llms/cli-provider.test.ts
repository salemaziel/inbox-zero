import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Provider } from "./config";

const prismaMock = vi.hoisted(() => ({
  aiSubscriptionLogin: { findUnique: vi.fn(), updateMany: vi.fn() },
}));
const connectedAt = new Date("2026-10-01T00:00:00Z");
const FAKE_CODEX_AUTH = '{"tokens":{"refresh_token":"fake-refresh-1"}}';

describe("createCliLanguageModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    (
      globalThis as { inboxZeroCodexRunQueues?: Map<string, unknown> }
    ).inboxZeroCodexRunQueues?.clear();
  });

  afterEach(() => {
    vi.doUnmock("@/env");
    vi.doUnmock("ai-sdk-provider-codex-cli");
    vi.doUnmock("ai-sdk-provider-claude-code");
    vi.doUnmock("@/utils/prisma");
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("builds each Codex call in its own empty folder and removes it afterwards", async () => {
    const doGenerate = vi.fn().mockResolvedValue({ text: "generated" });
    const doStream = vi.fn().mockResolvedValue({ stream: emptyStream() });
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

    await expect(
      model.doGenerate({ prompt: "generate-request" }),
    ).resolves.toEqual({
      text: "generated",
    });
    await expect(model.doStream({ prompt: "stream-request" })).resolves.toEqual(
      {
        stream: expect.any(ReadableStream),
      },
    );

    expect(codexExec).toHaveBeenCalledTimes(2);
    expect(codexExec).toHaveBeenCalledWith("gpt-5.3-codex", {
      allowNpx: true,
      skipGitRepoCheck: true,
      approvalMode: "never",
      sandboxMode: "read-only",
      codexPath: "/usr/local/bin/codex",
      cwd: expect.stringContaining("inbox-zero-cli-run-"),
      env: expect.any(Object),
      logger: false,
    });
    const cwd = getSettings(codexExec).cwd as string;
    await expect(access(cwd)).rejects.toThrow();
    expect(doGenerate).toHaveBeenCalledWith({
      prompt: "generate-request",
      abortSignal: expect.any(AbortSignal),
    });
    expect(doStream).toHaveBeenCalledWith({
      prompt: "stream-request",
      abortSignal: expect.any(AbortSignal),
    });
  });

  it("runs Claude Code with no built-in tools, no saved transcripts and an empty folder", async () => {
    const doStream = vi.fn().mockResolvedValue({ stream: emptyStream() });
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

    await expect(model.doStream({ prompt: "stream-request" })).resolves.toEqual(
      {
        stream: expect.any(ReadableStream),
      },
    );

    expect(claudeCode).toHaveBeenCalledTimes(1);
    expect(claudeCode).toHaveBeenCalledWith("sonnet", {
      settingSources: [],
      tools: [],
      persistSession: false,
      cwd: expect.stringContaining("inbox-zero-cli-run-"),
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

    await expect(
      model.doGenerate({ prompt: "generate-request" }),
    ).resolves.toEqual({
      content: [
        {
          type: "tool-call",
          toolName: "searchInbox",
          input: { query: "hello" },
        },
      ],
    });
    const streamResult = await model.doStream({ prompt: "stream-request" });
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
      tools: [],
      persistSession: false,
      cwd: expect.stringContaining("inbox-zero-cli-run-"),
      allowedTools: [
        "mcp__inboxzero__searchInbox",
        "mcp__inboxzero__createRule",
      ],
      mcpServers: { inboxzero: mcpServer },
      permissionMode: "default",
      sandbox: { enabled: true },
    });
    expect(doGenerate).toHaveBeenCalledWith({
      prompt: "generate-request",
      abortSignal: expect.any(AbortSignal),
    });
    expect(doStream).toHaveBeenCalledWith({
      prompt: "stream-request",
      abortSignal: expect.any(AbortSignal),
    });
  });

  it("surfaces a clear error when the provider package is missing its factory export", async () => {
    const { createCliLanguageModel } = await loadCliProviderModule({
      codexModule: { codexExec: undefined },
    });

    const model = createCliLanguageModel({
      provider: Provider.CODEX_CLI,
      modelName: "gpt-5.3-codex",
    }) as any;

    await expect(
      model.doGenerate({ prompt: "generate-request" }),
    ).rejects.toThrow(
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

    await expect(model.doStream({ prompt: "stream-request" })).rejects.toThrow(
      'CLI LLM provider "codex-cli" returned a model without doStream. Check the installed package version.',
    );
  });

  it("runs Codex with the user's login in a throwaway home and only safe host variables", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://fake-host-db");
    vi.stubEnv("EMAIL_ENCRYPT_SECRET", "fake-host-secret");
    vi.stubEnv("OPENAI_API_KEY", "fake-host-openai-key");
    vi.stubEnv("CODEX_API_KEY", "fake-host-codex-key");
    vi.stubEnv("LANG", "en_US.UTF-8");
    let authSeenByCli: string | null = null;
    const codexExec = vi.fn((_model: string, settings: any) => ({
      doGenerate: vi.fn(async () => {
        authSeenByCli = await readFile(
          path.join(settings.env.CODEX_HOME, "auth.json"),
          "utf8",
        );
        return { text: "ok" };
      }),
      doStream: vi.fn(),
    }));
    prismaMock.aiSubscriptionLogin.findUnique.mockResolvedValue({
      status: "connected",
      credential: FAKE_CODEX_AUTH,
      connectedAt,
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
    const { env: childEnv, cwd } = getSettings(codexExec) as {
      env: Record<string, string>;
      cwd: string;
    };
    expect(authSeenByCli).toBe(FAKE_CODEX_AUTH);
    expect(childEnv).toMatchObject({
      DATABASE_URL: "",
      EMAIL_ENCRYPT_SECRET: "",
      OPENAI_API_KEY: "",
      CODEX_API_KEY: "",
      LANG: "en_US.UTF-8",
      PATH: process.env.PATH,
    });
    expect(childEnv.CODEX_HOME.startsWith(path.dirname(cwd))).toBe(true);
    expect(prismaMock.aiSubscriptionLogin.updateMany).not.toHaveBeenCalled();
    await expect(access(childEnv.CODEX_HOME)).rejects.toThrow();
  });

  it("saves a refreshed Codex login back to the sign-in it started from", async () => {
    const refreshed = '{"tokens":{"refresh_token":"fake-refresh-2"}}';
    const codexExec = vi.fn((_model: string, settings: any) => ({
      doGenerate: vi.fn(async () => {
        await writeFile(
          path.join(settings.env.CODEX_HOME, "auth.json"),
          refreshed,
        );
        return { text: "ok" };
      }),
      doStream: vi.fn(),
    }));
    prismaMock.aiSubscriptionLogin.findUnique.mockResolvedValue({
      status: "connected",
      credential: FAKE_CODEX_AUTH,
      connectedAt,
    });

    const { createCliLanguageModel } = await loadCliProviderModule({
      codexModule: { codexExec, isAuthenticationError: () => false },
    });
    const model = createCliLanguageModel({
      provider: Provider.CODEX_CLI,
      modelName: "gpt-5.3-codex",
      cliLogin: { userId: "user1", allowServerLogin: false },
    }) as any;
    await model.doGenerate("request");

    expect(prismaMock.aiSubscriptionLogin.updateMany).toHaveBeenCalledWith({
      where: {
        userId: "user1",
        provider: Provider.CODEX_CLI,
        status: "connected",
        connectedAt,
      },
      data: { credential: refreshed },
    });
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
      connectedAt,
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

    const settings = getSettings(claudeCode) as {
      env: Record<string, string>;
      cwd: string;
    };
    expect(settings.env).toMatchObject({
      ANTHROPIC_API_KEY: "",
      ANTHROPIC_AUTH_TOKEN: "",
      CLAUDE_CODE_OAUTH_TOKEN: "fake-user-oauth-token",
    });
    expect(
      settings.env.CLAUDE_CONFIG_DIR.startsWith(path.dirname(settings.cwd)),
    ).toBe(true);
  });

  it("uses the server login for an owner who has not connected an account", async () => {
    const hostCodexHome = await mkdtemp(
      path.join(os.tmpdir(), "inbox-zero-test-host-codex-"),
    );
    await writeFile(path.join(hostCodexHome, "auth.json"), FAKE_CODEX_AUTH);
    await writeFile(
      path.join(hostCodexHome, "config.toml"),
      '[mcp_servers.host]\ncommand = "host-mcp"\n',
    );
    vi.stubEnv("CODEX_HOME", hostCodexHome);
    vi.stubEnv("DATABASE_URL", "postgres://fake-host-db");
    vi.stubEnv("OPENAI_API_KEY", "fake-host-openai-key");
    let seenByCli: { auth: string; config: string } | null = null;
    const codexExec = vi.fn((_model: string, settings: any) => ({
      doGenerate: vi.fn(async () => {
        const runHome = settings.env.CODEX_HOME;
        seenByCli = {
          auth: await readFile(path.join(runHome, "auth.json"), "utf8"),
          config: await readFile(path.join(runHome, "config.toml"), "utf8"),
        };
        return { text: "ok" };
      }),
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

    const childEnv = getSettings(codexExec).env as Record<string, string>;
    expect(childEnv).toMatchObject({
      DATABASE_URL: "",
      OPENAI_API_KEY: "fake-host-openai-key",
    });
    expect(childEnv.CODEX_HOME).not.toBe(hostCodexHome);
    expect(seenByCli).toEqual({
      auth: FAKE_CODEX_AUTH,
      config: expect.not.stringContaining("mcp_servers"),
    });
    await expect(access(childEnv.CODEX_HOME)).rejects.toThrow();
    await rm(hostCodexHome, { recursive: true, force: true });
  });

  it("gives every Codex run a config with its built-in tools turned off", async () => {
    let configSeenByCli = "";
    const codexExec = vi.fn((_model: string, settings: any) => ({
      doGenerate: vi.fn(async () => {
        configSeenByCli = await readFile(
          path.join(settings.env.CODEX_HOME, "config.toml"),
          "utf8",
        );
        return { text: "ok" };
      }),
      doStream: vi.fn(),
    }));
    prismaMock.aiSubscriptionLogin.findUnique.mockResolvedValue({
      status: "connected",
      credential: FAKE_CODEX_AUTH,
      connectedAt,
    });

    const { createCliLanguageModel } = await loadCliProviderModule({
      codexModule: { codexExec, isAuthenticationError: () => false },
    });
    const model = createCliLanguageModel({
      provider: Provider.CODEX_CLI,
      modelName: "gpt-5.3-codex",
      cliLogin: { userId: "user1", allowServerLogin: false },
    }) as any;
    await model.doGenerate("request");

    for (const line of [
      'web_search = "disabled"',
      "shell_tool = false",
      "view_image = false",
      "multi_agent = false",
      "apps = false",
      "plugins = false",
    ]) {
      expect(configSeenByCli).toContain(line);
    }
    expect(configSeenByCli).toMatch(/\[agents\]\nenabled = false/);
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
      credential: FAKE_CODEX_AUTH,
      connectedAt,
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
      credential: FAKE_CODEX_AUTH,
      connectedAt,
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
      where: {
        userId: "user1",
        provider: Provider.CODEX_CLI,
        status: "connected",
        connectedAt,
      },
      data: expect.objectContaining({ status: "needs-reconnect" }),
    });
  });

  it("marks a login rejected inside a Claude stream for reconnect", async () => {
    const authError = new Error("unauthorized");
    const claudeCode = vi.fn(() => ({
      doGenerate: vi.fn(),
      doStream: vi.fn().mockResolvedValue({
        stream: streamOf([{ type: "error", error: authError }]),
      }),
    }));
    prismaMock.aiSubscriptionLogin.findUnique.mockResolvedValue({
      status: "connected",
      credential: "fake-user-oauth-token",
      connectedAt,
    });

    const { createCliLanguageModel, RECONNECT_SUBSCRIPTION_MESSAGE } =
      await loadCliProviderModule({
        claudeModule: {
          claudeCode,
          isAuthenticationError: (error: unknown) => error === authError,
        },
      });
    const model = createCliLanguageModel({
      provider: Provider.CLAUDE_CODE,
      modelName: "sonnet",
      cliLogin: { userId: "user1", allowServerLogin: false },
    }) as any;
    const { stream } = await model.doStream("request");
    const parts = await readAll(stream);

    expect((parts[0] as { error: Error }).error.message).toBe(
      RECONNECT_SUBSCRIPTION_MESSAGE,
    );
    expect(prismaMock.aiSubscriptionLogin.updateMany).toHaveBeenCalledWith({
      where: {
        userId: "user1",
        provider: Provider.CLAUDE_CODE,
        status: "connected",
        connectedAt,
      },
      data: expect.objectContaining({ status: "needs-reconnect" }),
    });
  });

  it("marks a Codex login rejected mid-stream for reconnect and frees the run slot", async () => {
    const exitError = Object.assign(new Error("Codex CLI exited with code 1"), {
      data: { exitCode: 1, stderr: "Error: 401 Unauthorized" },
    });
    const doStream = vi
      .fn()
      .mockResolvedValueOnce({
        stream: new ReadableStream({
          start(controller) {
            controller.error(exitError);
          },
        }),
      })
      .mockResolvedValueOnce({ stream: emptyStream() });
    const codexExec = vi.fn(() => ({ doGenerate: vi.fn(), doStream }));
    prismaMock.aiSubscriptionLogin.findUnique.mockResolvedValue({
      status: "connected",
      credential: FAKE_CODEX_AUTH,
      connectedAt,
    });

    const { createCliLanguageModel, RECONNECT_SUBSCRIPTION_MESSAGE } =
      await loadCliProviderModule({
        codexModule: { codexExec, isAuthenticationError: () => false },
      });
    const model = createCliLanguageModel({
      provider: Provider.CODEX_CLI,
      modelName: "gpt-5.3-codex",
      cliLogin: { userId: "user1", allowServerLogin: false },
    }) as any;
    const first = await model.doStream({});
    await expect(readAll(first.stream)).rejects.toThrow(
      RECONNECT_SUBSCRIPTION_MESSAGE,
    );

    expect(prismaMock.aiSubscriptionLogin.updateMany).toHaveBeenCalledWith({
      where: {
        userId: "user1",
        provider: Provider.CODEX_CLI,
        status: "connected",
        connectedAt,
      },
      data: expect.objectContaining({ status: "needs-reconnect" }),
    });
    const second = await model.doStream("second");
    await expect(readAll(second.stream)).resolves.toEqual([]);
  });

  it("lets a Codex call cancelled while queued leave without blocking later calls", async () => {
    let resolveFirst: (value: unknown) => void = () => {};
    const doGenerate = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValue({ text: "later" });
    const codexExec = vi.fn(() => ({ doGenerate, doStream: vi.fn() }));
    prismaMock.aiSubscriptionLogin.findUnique.mockResolvedValue({
      status: "connected",
      credential: FAKE_CODEX_AUTH,
      connectedAt,
    });

    const { createCliLanguageModel } = await loadCliProviderModule({
      codexModule: { codexExec, isAuthenticationError: () => false },
    });
    const model = createCliLanguageModel({
      provider: Provider.CODEX_CLI,
      modelName: "gpt-5.3-codex",
      cliLogin: { userId: "user1", allowServerLogin: false },
    }) as any;

    const first = model.doGenerate({});
    await vi.waitFor(() => expect(doGenerate).toHaveBeenCalledTimes(1));
    const controller = new AbortController();
    const cancelled = model.doGenerate({ abortSignal: controller.signal });
    const third = model.doGenerate({});
    controller.abort(new Error("stopped"));
    await expect(cancelled).rejects.toThrow("stopped");

    resolveFirst({ text: "first" });
    await expect(first).resolves.toEqual({ text: "first" });
    await expect(third).resolves.toEqual({ text: "later" });
    expect(doGenerate).toHaveBeenCalledTimes(2);
  });

  it("stops a Codex stream nobody finishes after the time limit and frees its slot once the CLI exits", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let exitCli: () => void = () => {};
    let cliSignal: AbortSignal | undefined;
    const doStream = vi
      .fn()
      .mockImplementationOnce(async (options: { abortSignal: AbortSignal }) => {
        cliSignal = options.abortSignal;
        return {
          stream: new ReadableStream({
            start(controller) {
              // Like the provider: the stream errors when the killed CLI exits.
              exitCli = () => controller.error(new Error("Codex CLI exited"));
            },
          }),
        };
      })
      .mockResolvedValueOnce({ stream: emptyStream() });
    const codexExec = vi.fn(() => ({ doGenerate: vi.fn(), doStream }));
    prismaMock.aiSubscriptionLogin.findUnique.mockResolvedValue({
      status: "connected",
      credential: FAKE_CODEX_AUTH,
      connectedAt,
    });

    const { createCliLanguageModel, MAX_CLI_CALL_MS } =
      await loadCliProviderModule({
        codexModule: { codexExec, isAuthenticationError: () => false },
      });
    const model = createCliLanguageModel({
      provider: Provider.CODEX_CLI,
      modelName: "gpt-5.3-codex",
      cliLogin: { userId: "user1", allowServerLogin: false },
    }) as any;

    await model.doStream({});
    const codexHome = getSettings(codexExec).env as Record<string, string>;
    const second = model.doStream({});
    let secondStarted = false;
    second.then(() => {
      secondStarted = true;
    });
    await vi.advanceTimersByTimeAsync(MAX_CLI_CALL_MS - 1000);
    expect(cliSignal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1000);
    expect(cliSignal?.aborted).toBe(true);
    expect(secondStarted).toBe(false);
    await expect(access(codexHome.CODEX_HOME)).resolves.toBeUndefined();

    exitCli();
    vi.useRealTimers();
    await expect(second).resolves.toEqual({
      stream: expect.any(ReadableStream),
    });
    await expect(access(codexHome.CODEX_HOME)).rejects.toThrow();
  });

  it("frees the slot of a stopped CLI that never exits after a bounded wait", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const doStream = vi
      .fn()
      .mockResolvedValueOnce({ stream: new ReadableStream() })
      .mockResolvedValueOnce({ stream: emptyStream() });
    const codexExec = vi.fn(() => ({ doGenerate: vi.fn(), doStream }));
    prismaMock.aiSubscriptionLogin.findUnique.mockResolvedValue({
      status: "connected",
      credential: FAKE_CODEX_AUTH,
      connectedAt,
    });

    const { createCliLanguageModel, MAX_CLI_CALL_MS, CLI_STOP_WAIT_MS } =
      await loadCliProviderModule({
        codexModule: { codexExec, isAuthenticationError: () => false },
      });
    const model = createCliLanguageModel({
      provider: Provider.CODEX_CLI,
      modelName: "gpt-5.3-codex",
      cliLogin: { userId: "user1", allowServerLogin: false },
    }) as any;

    await model.doStream({});
    const second = model.doStream({});
    let secondStarted = false;
    second.then(() => {
      secondStarted = true;
    });
    await vi.advanceTimersByTimeAsync(MAX_CLI_CALL_MS + CLI_STOP_WAIT_MS - 1);
    expect(secondStarted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    vi.useRealTimers();
    await expect(second).resolves.toEqual({
      stream: expect.any(ReadableStream),
    });
  });

  it("stops the CLI when the reader cancels the stream", async () => {
    let cliSignal: AbortSignal | undefined;
    const doStream = vi.fn(async (options: { abortSignal: AbortSignal }) => {
      cliSignal = options.abortSignal;
      return {
        stream: new ReadableStream({
          start(controller) {
            options.abortSignal.addEventListener("abort", () =>
              controller.error(new Error("Codex CLI exited")),
            );
          },
        }),
      };
    });
    const codexExec = vi.fn(() => ({ doGenerate: vi.fn(), doStream }));

    const { createCliLanguageModel } = await loadCliProviderModule({
      codexModule: { codexExec, isAuthenticationError: () => false },
    });
    const model = createCliLanguageModel({
      provider: Provider.CODEX_CLI,
      modelName: "gpt-5.3-codex",
    }) as any;

    const { stream } = await model.doStream({});
    await stream.cancel("client went away");

    expect(cliSignal?.aborted).toBe(true);
    const cwd = getSettings(codexExec).cwd as string;
    await expect(access(cwd)).rejects.toThrow();
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
      credential: FAKE_CODEX_AUTH,
      connectedAt,
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

function getSettings(factory: { mock: { calls: unknown[][] } }) {
  return factory.mock.calls[0][1] as Record<string, unknown>;
}

function emptyStream() {
  return new ReadableStream({
    start(controller) {
      controller.close();
    },
  });
}

function streamOf(parts: unknown[]) {
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });
}

async function readAll(stream: ReadableStream<unknown>) {
  const parts: unknown[] = [];
  for await (const part of stream as unknown as AsyncIterable<unknown>) {
    parts.push(part);
  }
  return parts;
}
