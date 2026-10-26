import { EventEmitter } from "node:events";
import { access, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/__mocks__/prisma";
import { Provider } from "./config";
import {
  disconnectSubscriptionLogin,
  getSubscriptionLogin,
  parseClaudeLoginUrl,
  parseClaudeSetupToken,
  parseCodexDeviceLogin,
  startSubscriptionLogin,
  MAX_ACTIVE_SUBSCRIPTION_LOGINS,
  SUBSCRIPTION_LOGIN_START_COOLDOWN_MS,
  SUBSCRIPTION_LOGIN_TTL_MS,
  submitSubscriptionLoginCode,
} from "./subscription-login";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock("@/utils/prisma");
vi.mock("node:child_process", () => ({ spawn: spawnMock }));
vi.mock("@/env", () => ({
  env: {
    CLI_LLM_ENABLED: true,
    CODEX_CLI_PATH: undefined,
  },
}));

// Synthetic values only; the shapes follow the CLI output.
const CLAUDE_URL =
  "https://claude.com/cai/oauth/authorize?code=true&client_id=cid&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&scope=user%3Ainference&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256&state=0123456789abcdef";
const FAKE_TOKEN_A = "sk-ant-oat01-AAAABBBBCCCCDDDDEEEE1111";
const FAKE_TOKEN_B = "2222FFFFGGGG_HHHH-IIII";
const CLAUDE_PROMPT_OUTPUT = [
  "\x1b[1mWelcome to Claude Code\x1b[22m",
  "Browser didn't open? Use the url below to sign in (c to copy)",
  "",
  `\x1b]8;;${CLAUDE_URL}\x07${CLAUDE_URL.slice(0, 60)}\n${CLAUDE_URL.slice(60)}\x1b]8;;\x07`,
  "",
  "Paste code here if prompted >",
  "",
].join("\r\n");
const CLAUDE_SUCCESS_OUTPUT = [
  "✓ Long-lived authentication token created successfully!",
  "",
  "Your OAuth token (valid for 1 year):",
  "",
  FAKE_TOKEN_A,
  FAKE_TOKEN_B,
  "",
  "Store this token securely. You won't be able to see it again.",
  "",
].join("\r");
const CODEX_OUTPUT =
  "\x1b[94m1. Open this link\x1b[0m\r\n   https://auth.openai.com/codex/device\r\n\r\n2. Enter this one-time code \x1b[90m(expires in 15 minutes)\x1b[0m\r\n   \x1b[94mWXYZ-12345\x1b[0m\r\n";

describe("parseClaudeLoginUrl", () => {
  it("reads the URL from an OSC 8 hyperlink with wrapped display text", () => {
    expect(parseClaudeLoginUrl(CLAUDE_PROMPT_OUTPUT)).toBe(CLAUDE_URL);
  });

  it("reassembles a plain-text URL hard-wrapped by the terminal", () => {
    const output = `Use the url below to sign in\n${CLAUDE_URL.slice(0, 80)}\n${CLAUDE_URL.slice(80)}\nPaste code here if prompted >\n`;
    expect(parseClaudeLoginUrl(output)).toBe(CLAUDE_URL);
  });

  it("waits while the URL may still be arriving", () => {
    expect(parseClaudeLoginUrl(`Use the url below\n${CLAUDE_URL}`)).toBeNull();
  });

  it("rejects a look-alike host", () => {
    const output = `${CLAUDE_URL.replace("claude.com", "claude.com.evil.test")}\n`;
    expect(parseClaudeLoginUrl(output)).toBeNull();
  });
});

describe("parseClaudeSetupToken", () => {
  it("joins a token wrapped between the success anchors", () => {
    expect(parseClaudeSetupToken(CLAUDE_SUCCESS_OUTPUT)).toBe(
      `${FAKE_TOKEN_A}${FAKE_TOKEN_B}`,
    );
  });

  it("ignores token-shaped text outside the success screen", () => {
    expect(
      parseClaudeSetupToken(`Error: ${FAKE_TOKEN_A}${FAKE_TOKEN_B}\n`),
    ).toBeNull();
  });
});

describe("parseCodexDeviceLogin", () => {
  it("reads the device URL and one-time code from colored output", () => {
    expect(parseCodexDeviceLogin(CODEX_OUTPUT)).toEqual({
      url: "https://auth.openai.com/codex/device",
      code: "WXYZ-12345",
    });
  });

  it("waits until the whole code has arrived", () => {
    expect(parseCodexDeviceLogin(CODEX_OUTPUT.slice(0, -12))).toBeNull();
  });
});

describe("subscription login sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const state = globalThis as {
      inboxZeroSubscriptionLogins?: Map<string, unknown>;
      inboxZeroSubscriptionLoginStarts?: Map<string, unknown>;
    };
    state.inboxZeroSubscriptionLogins?.clear();
    state.inboxZeroSubscriptionLoginStarts?.clear();
  });

  afterEach(async () => {
    vi.useRealTimers();
    const open = (
      globalThis as {
        inboxZeroSubscriptionLogins?: Map<string, { tempDir?: string }>;
      }
    ).inboxZeroSubscriptionLogins;
    for (const session of open?.values() ?? []) {
      if (session.tempDir) {
        await rm(session.tempDir, { recursive: true, force: true });
      }
    }
  });

  it("keeps one active sign-in per user and provider", async () => {
    const child = mockSpawnedChild();

    const first = await startSubscriptionLogin({
      userId: "user1",
      provider: Provider.CODEX_CLI,
    });
    child.stdout.emit("data", Buffer.from(CODEX_OUTPUT));
    const second = await startSubscriptionLogin({
      userId: "user1",
      provider: Provider.CODEX_CLI,
    });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(first.status).toBe("starting");
    expect(second).toMatchObject({
      status: "waiting",
      url: "https://auth.openai.com/codex/device",
      deviceCode: "WXYZ-12345",
    });
  });

  it("makes a user wait before starting another sign-in", async () => {
    mockSpawnedChild();
    await startSubscriptionLogin({
      userId: "user1",
      provider: Provider.CODEX_CLI,
    });

    await expect(
      startSubscriptionLogin({
        userId: "user1",
        provider: Provider.CLAUDE_CODE,
      }),
    ).rejects.toThrow("Wait a few seconds");
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it("caps how many sign-ins run on the server at once", async () => {
    for (let i = 0; i < MAX_ACTIVE_SUBSCRIPTION_LOGINS; i++) {
      mockSpawnedChild();
      await startSubscriptionLogin({
        userId: `user${i}`,
        provider: Provider.CODEX_CLI,
      });
    }

    await expect(
      startSubscriptionLogin({
        userId: "one-too-many",
        provider: Provider.CODEX_CLI,
      }),
    ).rejects.toThrow("Too many sign-ins");
    expect(spawnMock).toHaveBeenCalledTimes(MAX_ACTIVE_SUBSCRIPTION_LOGINS);
  });

  it("runs the CLI with host credentials blanked", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "fake-host-api-key");
    vi.stubEnv("OPENAI_API_KEY", "fake-host-openai-key");
    mockSpawnedChild();

    await startSubscriptionLogin({
      userId: "user1",
      provider: Provider.CLAUDE_CODE,
    });

    const [command, args, options] = spawnMock.mock.calls[0];
    expect(command).toBe("script");
    expect(args[1]).toContain("claude setup-token");
    expect(options.env).toMatchObject({
      ANTHROPIC_API_KEY: "",
      CLAUDE_CODE_OAUTH_TOKEN: "",
      OPENAI_API_KEY: "",
      CODEX_API_KEY: "",
      BROWSER: "true",
    });
    expect(options.env.CLAUDE_CONFIG_DIR).toContain("inbox-zero-cli-login-");
    vi.unstubAllEnvs();
  });

  it("expires a sign-in after ten minutes and stops the CLI", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const child = mockSpawnedChild();

    await startSubscriptionLogin({
      userId: "user1",
      provider: Provider.CODEX_CLI,
    });
    vi.advanceTimersByTime(SUBSCRIPTION_LOGIN_TTL_MS);

    expect(
      getSubscriptionLogin({ userId: "user1", provider: Provider.CODEX_CLI }),
    ).toMatchObject({ status: "expired" });
    expect(child.kill).toHaveBeenCalled();

    mockSpawnedChild();
    await startSubscriptionLogin({
      userId: "user1",
      provider: Provider.CODEX_CLI,
    });
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });

  it("submits the Claude code and saves the minted token", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const child = mockSpawnedChild();
    prisma.aiSubscriptionLogin.upsert.mockResolvedValue({} as never);

    await startSubscriptionLogin({
      userId: "user1",
      provider: Provider.CLAUDE_CODE,
    });
    child.stdout.emit("data", Buffer.from(CLAUDE_PROMPT_OUTPUT));
    expect(
      getSubscriptionLogin({ userId: "user1", provider: Provider.CLAUDE_CODE }),
    ).toMatchObject({ status: "waiting", url: CLAUDE_URL, needsCode: true });

    submitSubscriptionLoginCode({ userId: "user1", code: "fake-code#state" });
    vi.advanceTimersByTime(200);
    expect(child.stdin.write).toHaveBeenNthCalledWith(1, "fake-code#state");
    expect(child.stdin.write).toHaveBeenNthCalledWith(2, "\r");
    expect(() =>
      submitSubscriptionLoginCode({ userId: "user1", code: "again" }),
    ).toThrow();

    child.stdout.emit("data", Buffer.from(CLAUDE_SUCCESS_OUTPUT));
    child.emit("close", 0);

    await vi.waitFor(() =>
      expect(
        getSubscriptionLogin({
          userId: "user1",
          provider: Provider.CLAUDE_CODE,
        })?.status,
      ).toBe("connected"),
    );
    expect(prisma.aiSubscriptionLogin.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          userId: "user1",
          provider: Provider.CLAUDE_CODE,
          credential: `${FAKE_TOKEN_A}${FAKE_TOKEN_B}`,
          status: "connected",
        }),
      }),
    );
  });

  it("does not bring back a login disconnected while its save was in flight", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const child = mockSpawnedChild();
    let finishUpsert: (value: unknown) => void = () => {};
    let saved = false;
    prisma.aiSubscriptionLogin.upsert.mockReturnValue(
      new Promise((resolve) => {
        finishUpsert = resolve;
      }).then(() => {
        saved = true;
      }) as never,
    );
    const deletedAfterSave: boolean[] = [];
    prisma.aiSubscriptionLogin.deleteMany.mockImplementation((async () => {
      deletedAfterSave.push(saved);
      return { count: 1 };
    }) as never);

    await startSubscriptionLogin({
      userId: "user1",
      provider: Provider.CLAUDE_CODE,
    });
    child.stdout.emit("data", Buffer.from(CLAUDE_PROMPT_OUTPUT));
    submitSubscriptionLoginCode({ userId: "user1", code: "fake-code#state" });
    vi.advanceTimersByTime(200);
    child.stdout.emit("data", Buffer.from(CLAUDE_SUCCESS_OUTPUT));
    child.emit("close", 0);
    await vi.waitFor(() =>
      expect(prisma.aiSubscriptionLogin.upsert).toHaveBeenCalled(),
    );

    vi.useRealTimers();
    const disconnected = disconnectSubscriptionLogin({
      userId: "user1",
      provider: Provider.CLAUDE_CODE,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    finishUpsert({});
    await disconnected;

    expect(deletedAfterSave.length).toBeGreaterThan(0);
    expect(deletedAfterSave.at(-1)).toBe(true);
    expect(
      getSubscriptionLogin({ userId: "user1", provider: Provider.CLAUDE_CODE }),
    ).toBeNull();
  });

  it("saves Codex's auth.json to the database only when the CLI exits cleanly and wrote it", async () => {
    const failing = mockSpawnedChild();
    await startSubscriptionLogin({
      userId: "user1",
      provider: Provider.CODEX_CLI,
    });
    failing.emit("close", 0);
    await vi.waitFor(() =>
      expect(
        getSubscriptionLogin({ userId: "user1", provider: Provider.CODEX_CLI })
          ?.status,
      ).toBe("failed"),
    );
    expect(prisma.aiSubscriptionLogin.upsert).not.toHaveBeenCalled();

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + SUBSCRIPTION_LOGIN_START_COOLDOWN_MS);
    const child = mockSpawnedChild();
    prisma.aiSubscriptionLogin.upsert.mockResolvedValue({} as never);
    await startSubscriptionLogin({
      userId: "user1",
      provider: Provider.CODEX_CLI,
    });
    const home: string = spawnMock.mock.calls[1][2].env.CODEX_HOME;
    expect((await stat(home)).mode & 0o777).toBe(0o700);
    const fakeAuthJson = '{"tokens":{"refresh_token":"fake-refresh"}}';
    await writeFile(path.join(home, "auth.json"), fakeAuthJson);
    child.emit("close", 0);

    await vi.waitFor(() =>
      expect(
        getSubscriptionLogin({ userId: "user1", provider: Provider.CODEX_CLI })
          ?.status,
      ).toBe("connected"),
    );
    expect(prisma.aiSubscriptionLogin.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ credential: fakeAuthJson }),
      }),
    );
    await expect(access(home)).rejects.toThrow();
  });
});

function mockSpawnedChild() {
  const child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    stdin: { write: vi.fn() },
    killed: false,
    kill: vi.fn(),
  });
  spawnMock.mockReturnValueOnce(child);
  return child;
}
