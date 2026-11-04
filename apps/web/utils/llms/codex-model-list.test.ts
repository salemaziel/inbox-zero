import {
  access,
  mkdtemp,
  readFile,
  readlink,
  rm,
  writeFile,
} from "node:fs/promises";
import { EventEmitter } from "node:events";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Provider } from "./config";

const prismaMock = vi.hoisted(() => ({
  aiSubscriptionLogin: { findUnique: vi.fn(), updateMany: vi.fn() },
}));
const connectedAt = new Date("2026-10-01T00:00:00Z");
const FAKE_CODEX_AUTH = '{"tokens":{"refresh_token":"fake-refresh-1"}}';

describe("listCodexModels", () => {
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
    vi.doUnmock("node:child_process");
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("lists Codex models with the user's own login, holding their queue and saving a refreshed login back", async () => {
    const refreshed = '{"tokens":{"refresh_token":"fake-refresh-2"}}';
    let authSeen: string | null = null;
    let queueHeld = false;
    prismaMock.aiSubscriptionLogin.findUnique.mockResolvedValue({
      status: "connected",
      credential: FAKE_CODEX_AUTH,
      connectedAt,
    });
    const spawn = fakeCodexSpawn(async ({ codexHome }) => {
      authSeen = await readFile(path.join(codexHome, "auth.json"), "utf8");
      queueHeld = getCodexRunQueues().has("user1");
      await writeFile(path.join(codexHome, "auth.json"), refreshed);
      await writeFile(path.join(codexHome, "models_cache.json"), "{}");
      return { stdout: JSON.stringify({ models: [{ slug: "gpt-6-luna" }] }) };
    });
    const { listCodexModels } = await loadCliProviderModule({
      envOverrides: { CODEX_CLI_PATH: "/opt/codex" },
      spawn,
    });

    const models = await listCodexModels({
      userId: "user1",
      allowServerLogin: true,
    });

    expect(models).toEqual({
      login: "user",
      models: [{ slug: "gpt-6-luna" }],
    });
    expect(spawn).toHaveBeenCalledWith(
      "/opt/codex",
      ["debug", "models"],
      expect.objectContaining({
        env: expect.objectContaining({ CODEX_HOME: expect.any(String) }),
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
    expect(authSeen).toBe(FAKE_CODEX_AUTH);
    expect(queueHeld).toBe(true);
    // The queue entry is dropped once its release has settled.
    await new Promise((resolve) => setImmediate(resolve));
    expect(getCodexRunQueues().has("user1")).toBe(false);
    expect(prismaMock.aiSubscriptionLogin.updateMany).toHaveBeenCalledWith({
      where: {
        userId: "user1",
        provider: Provider.CODEX_CLI,
        status: "connected",
        connectedAt,
      },
      data: { credential: refreshed },
    });
    const { cwd } = spawn.mock.calls[0][2] as { cwd: string };
    await expect(access(path.dirname(cwd))).rejects.toThrow();
  });

  it("uses the server login for an owner without a login, and never for anyone else", async () => {
    const hostHome = await mkdtemp(path.join(os.tmpdir(), "codex-host-"));
    vi.stubEnv("CODEX_HOME", hostHome);
    prismaMock.aiSubscriptionLogin.findUnique.mockResolvedValue(null);
    let authLink: string | null = null;
    const spawn = fakeCodexSpawn(async ({ codexHome }) => {
      authLink = await readlinkSafe(codexHome);
      await writeFile(path.join(codexHome, "models_cache.json"), "{}");
      return { stdout: JSON.stringify({ models: [] }) };
    });
    const { listCodexModels, getCodexModelListLogin } =
      await loadCliProviderModule({
        envOverrides: { CODEX_CLI_PATH: "/opt/codex" },
        spawn,
      });
    const owner = { userId: "owner1", allowServerLogin: true };
    const nonOwner = { userId: "user2", allowServerLogin: false };

    expect(await getCodexModelListLogin(owner)).toBe("server");
    expect(await getCodexModelListLogin(nonOwner)).toBeNull();
    expect(await listCodexModels(nonOwner)).toEqual({
      login: null,
      models: null,
    });
    expect(spawn).not.toHaveBeenCalled();

    expect(await listCodexModels(owner)).toEqual({
      login: "server",
      models: [],
    });
    expect(authLink).toBe(path.join(hostHome, "auth.json"));
    await rm(hostHome, { recursive: true, force: true });
  });

  it("marks a login for reconnect when a failed listing says its sign-in was rejected", async () => {
    prismaMock.aiSubscriptionLogin.findUnique.mockResolvedValue({
      status: "connected",
      credential: FAKE_CODEX_AUTH,
      connectedAt,
    });
    const spawn = fakeCodexSpawn(async () => ({
      stdout: "",
      stderr: "error: 401 Unauthorized while refreshing models",
      exitCode: 1,
    }));
    const { listCodexModels } = await loadCliProviderModule({
      envOverrides: { CODEX_CLI_PATH: "/opt/codex" },
      spawn,
    });

    const listed = await listCodexModels({
      userId: "user1",
      allowServerLogin: false,
    });

    expect(listed).toEqual({ login: "user", models: null });
    expect(prismaMock.aiSubscriptionLogin.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "needs-reconnect" }),
      }),
    );
  });

  it("keeps the login of a listing that succeeded whatever Codex logged, and runs it without the host's tracing", async () => {
    vi.stubEnv("RUST_LOG", "debug");
    prismaMock.aiSubscriptionLogin.findUnique.mockResolvedValue({
      status: "connected",
      credential: FAKE_CODEX_AUTH,
      connectedAt,
    });
    const spawn = fakeCodexSpawn(async ({ codexHome }) => {
      await writeFile(path.join(codexHome, "models_cache.json"), "{}");
      return {
        stdout: JSON.stringify({ models: [{ slug: "gpt-6-luna" }] }),
        stderr: "DEBUG refresh token still valid; took 401 ms",
      };
    });
    const { listCodexModels } = await loadCliProviderModule({
      envOverrides: { CODEX_CLI_PATH: "/opt/codex" },
      spawn,
    });

    const listed = await listCodexModels({
      userId: "user1",
      allowServerLogin: false,
    });

    expect(listed).toEqual({ login: "user", models: [{ slug: "gpt-6-luna" }] });
    expect(prismaMock.aiSubscriptionLogin.updateMany).not.toHaveBeenCalled();
    const { env } = spawn.mock.calls[0][2] as { env: Record<string, string> };
    expect(env).not.toHaveProperty("RUST_LOG");
  });

  it("keeps the host's Codex API keys only for a listing on the server login", async () => {
    vi.stubEnv("OPENAI_API_KEY", "fake-host-openai-key");
    vi.stubEnv("CODEX_API_KEY", "fake-host-codex-key");
    const hostHome = await mkdtemp(path.join(os.tmpdir(), "codex-host-"));
    vi.stubEnv("CODEX_HOME", hostHome);
    prismaMock.aiSubscriptionLogin.findUnique
      .mockResolvedValueOnce({
        status: "connected",
        credential: FAKE_CODEX_AUTH,
        connectedAt,
      })
      .mockResolvedValueOnce(null);
    const spawn = fakeCodexSpawn(async ({ codexHome }) => {
      await writeFile(path.join(codexHome, "models_cache.json"), "{}");
      return { stdout: JSON.stringify({ models: [] }) };
    });
    const { listCodexModels } = await loadCliProviderModule({
      envOverrides: { CODEX_CLI_PATH: "/opt/codex" },
      spawn,
    });

    await listCodexModels({ userId: "user1", allowServerLogin: true });
    await listCodexModels({ userId: "owner1", allowServerLogin: true });

    const [userEnv, serverEnv] = spawn.mock.calls.map(
      (call) => (call[2] as { env: Record<string, string> }).env,
    );
    expect(userEnv).toMatchObject({ OPENAI_API_KEY: "", CODEX_API_KEY: "" });
    expect(serverEnv).toMatchObject({
      OPENAI_API_KEY: "fake-host-openai-key",
      CODEX_API_KEY: "fake-host-codex-key",
    });
    await rm(hostHome, { recursive: true, force: true });
  });

  it("saves a refreshed login back before freeing the user's queue", async () => {
    const refreshed = '{"tokens":{"refresh_token":"fake-refresh-2"}}';
    let finishSave = () => {};
    prismaMock.aiSubscriptionLogin.updateMany.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
        }),
    );
    prismaMock.aiSubscriptionLogin.findUnique.mockResolvedValue({
      status: "connected",
      credential: FAKE_CODEX_AUTH,
      connectedAt,
    });
    const spawn = fakeCodexSpawn(async ({ codexHome }) => {
      await writeFile(path.join(codexHome, "auth.json"), refreshed);
      await writeFile(path.join(codexHome, "models_cache.json"), "{}");
      return { stdout: JSON.stringify({ models: [] }) };
    });
    const { listCodexModels } = await loadCliProviderModule({
      envOverrides: { CODEX_CLI_PATH: "/opt/codex" },
      spawn,
    });

    let settled = false;
    const listing = listCodexModels({
      userId: "user1",
      allowServerLogin: false,
    }).finally(() => {
      settled = true;
    });
    await vi.waitFor(() =>
      expect(prismaMock.aiSubscriptionLogin.updateMany).toHaveBeenCalled(),
    );
    await flushFileWork();
    expect(settled).toBe(false);
    expect(getCodexRunQueues().has("user1")).toBe(true);

    finishSave();
    await listing;
    await new Promise((resolve) => setImmediate(resolve));
    expect(getCodexRunQueues().has("user1")).toBe(false);
  });

  it("stops a listing past its time limit, killing Codex's whole process group, and frees the queue even if its output never closes", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    prismaMock.aiSubscriptionLogin.findUnique.mockResolvedValue({
      status: "connected",
      credential: FAKE_CODEX_AUTH,
      connectedAt,
    });
    const child = Object.assign(new EventEmitter(), {
      pid: 4242,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(),
    });
    const spawn = vi.fn(() => child);
    const { listCodexModels, CLI_STOP_WAIT_MS } = await loadCliProviderModule({
      envOverrides: { CODEX_CLI_PATH: "/opt/codex/bin/codex.js" },
      spawn,
    });

    let settled = false;
    const listing = listCodexModels({
      userId: "user1",
      allowServerLogin: false,
    }).finally(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      ["/opt/codex/bin/codex.js", "debug", "models"],
      expect.objectContaining({ detached: true }),
    );

    await vi.advanceTimersByTimeAsync(20 * 1000);
    expect(kill).toHaveBeenCalledWith(-4242, "SIGTERM");
    await vi.advanceTimersByTimeAsync(CLI_STOP_WAIT_MS);
    expect(kill).toHaveBeenCalledWith(-4242, "SIGKILL");
    // A failed kill doesn't count as the CLI having exited.
    child.emit("error", new Error("kill EPERM"));
    await flushFileWork();
    expect(settled).toBe(false);
    expect(getCodexRunQueues().has("user1")).toBe(true);

    await vi.advanceTimersByTimeAsync(CLI_STOP_WAIT_MS);
    vi.useRealTimers();
    expect(await listing).toEqual({ login: "user", models: null });
    await new Promise((resolve) => setImmediate(resolve));
    expect(getCodexRunQueues().has("user1")).toBe(false);
    kill.mockRestore();
  });

  it("gives up on a listing whose turn in the user's queue doesn't come in time", async () => {
    const queueWait = new AbortController();
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(queueWait.signal);
    const spawn = fakeCodexSpawn(async () => ({ stdout: "{}" }));
    const { listCodexModels } = await loadCliProviderModule({
      envOverrides: { CODEX_CLI_PATH: "/opt/codex" },
      spawn,
    });
    // A long Codex run holds the user's queue.
    getCodexRunQueues().set("user1", new Promise(() => {}));

    const listing = listCodexModels({
      userId: "user1",
      allowServerLogin: false,
    });
    expect(timeout).toHaveBeenCalledWith(20 * 1000);
    queueWait.abort(new Error("timed out"));

    expect(await listing).toEqual({ login: null, models: null });
    expect(spawn).not.toHaveBeenCalled();
    expect(prismaMock.aiSubscriptionLogin.findUnique).not.toHaveBeenCalled();
    timeout.mockRestore();
  });

  it("treats a list Codex didn't fetch for this login as no list", async () => {
    prismaMock.aiSubscriptionLogin.findUnique.mockResolvedValue({
      status: "connected",
      credential: FAKE_CODEX_AUTH,
      connectedAt,
    });
    // Codex printed its built-in list and wrote no model cache.
    const spawn = fakeCodexSpawn(async () => ({
      stdout: JSON.stringify({ models: [{ slug: "gpt-5.5" }] }),
    }));
    const { listCodexModels } = await loadCliProviderModule({
      envOverrides: { CODEX_CLI_PATH: "/opt/codex" },
      spawn,
    });

    expect(
      await listCodexModels({ userId: "user1", allowServerLogin: false }),
    ).toEqual({ login: "user", models: null });
    expect(prismaMock.aiSubscriptionLogin.updateMany).not.toHaveBeenCalled();
  });

  it("does not list models without a configured Codex binary", async () => {
    const spawn = fakeCodexSpawn(async () => ({ stdout: "{}" }));
    const { listCodexModels } = await loadCliProviderModule({ spawn });

    expect(
      await listCodexModels({ userId: "owner1", allowServerLogin: true }),
    ).toEqual({ login: null, models: null });
    expect(spawn).not.toHaveBeenCalled();
  });
});

async function loadCliProviderModule({
  envOverrides,
  codexModule,
  claudeModule,
  spawn,
}: {
  envOverrides?: Partial<{
    CLI_LLM_ENABLED: boolean;
    CODEX_CLI_ALLOW_NPX: boolean;
    CODEX_CLI_PATH: string | undefined;
  }>;
  codexModule?: Record<string, unknown>;
  claudeModule?: Record<string, unknown>;
  spawn?: (...args: unknown[]) => unknown;
} = {}) {
  if (spawn) {
    vi.doMock("node:child_process", () => ({ spawn }));
  }
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

  return {
    ...(await import("./codex-model-list")),
    ...(await import("./subscription-run")),
  };
}

// Fake timers don't wait for real file work, such as removing a run's folder
// before its slot is freed; a run of real file calls lets that finish first.
async function flushFileWork() {
  for (let i = 0; i < 50; i++) await access(os.tmpdir());
}

async function readlinkSafe(codexHome: string) {
  return readlink(path.join(codexHome, "auth.json")).catch(() => null);
}

function getCodexRunQueues() {
  return (
    (globalThis as { inboxZeroCodexRunQueues?: Map<string, unknown> })
      .inboxZeroCodexRunQueues ?? new Map()
  );
}

// A stand-in for the Codex CLI: runs `act` in the run's Codex home, prints
// its output and exits.
function fakeCodexSpawn(
  act: (run: {
    codexHome: string;
  }) => Promise<{ stdout: string; stderr?: string; exitCode?: number }>,
) {
  return vi.fn(
    (
      _command: string,
      _args: string[],
      options: { env: Record<string, string> },
    ) => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: PassThrough;
        stderr: PassThrough;
        kill: () => void;
      };
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = vi.fn();
      act({ codexHome: options.env.CODEX_HOME }).then(
        ({ stdout, stderr = "", exitCode = 0 }) => {
          child.stdout.end(stdout);
          child.stderr.end(stderr);
          setImmediate(() => child.emit("close", exitCode));
        },
        // A failed step ends the run, so the test fails rather than hangs.
        (error) => child.emit("error", error),
      );
      return child;
    },
  );
}
