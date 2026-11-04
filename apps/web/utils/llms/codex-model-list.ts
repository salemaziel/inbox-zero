import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { env } from "@/env";
import { assertCliLlmEnabled } from "@/utils/llms/cli-provider";
import { Provider } from "@/utils/llms/config";
import {
  type CliLoginScope,
  isUsableLogin,
  markNeedsReconnect,
  resolveUserCliLogin,
} from "@/utils/llms/subscription-access";
import {
  acquireCodexRun,
  CLI_STOP_WAIT_MS,
  type CliRun,
  type CliRunSettings,
  CODEX_AUTH_FAILURE_RE,
  startCliRun,
} from "@/utils/llms/subscription-run";
import { createScopedLogger } from "@/utils/logger";
import prisma from "@/utils/prisma";

const logger = createScopedLogger("llms/cli-provider");

const CODEX_MODEL_LIST_TIMEOUT_MS = 20 * 1000;
// The full catalog is about 650 KB.
const CODEX_MODEL_LIST_MAX_BYTES = 8 * 1024 * 1024;

// Which login a Codex model listing for this scope runs on, or null when the
// user has no usable login of their own and may not use the server's.
export async function getCodexModelListLogin(
  cliLogin: CliLoginScope,
): Promise<"user" | "server" | null> {
  const login = await prisma.aiSubscriptionLogin.findUnique({
    where: {
      userId_provider: {
        userId: cliLogin.userId,
        provider: Provider.CODEX_CLI,
      },
    },
    select: { status: true, credential: true },
  });
  if (isUsableLogin(login)) return "user";
  return cliLogin.allowServerLogin ? "server" : null;
}

// Codex's model list for one user, read with the same binary, isolation and
// login a run of theirs would use: the user's own login when it is
// connected, else the server's login for owners. The list differs by client
// version and ChatGPT plan. Null means there is no live list to offer: no
// binary configured, no usable login, a rejected login (marked for
// reconnect) or a failed call. `login` is the login the listing ran with,
// null when it stopped before picking one. The user's Codex queue is held
// until the CLI has exited, so a refreshed login is saved back before another
// run starts.
export async function listCodexModels(cliLogin: CliLoginScope): Promise<{
  login: "user" | "server" | null;
  models: unknown[] | null;
}> {
  assertCliLlmEnabled(Provider.CODEX_CLI);
  if (!env.CODEX_CLI_PATH) return { login: null, models: null };

  let release = () => {};
  let run: CliRun | undefined;
  let usedLogin: "user" | "server" | null = null;
  try {
    // A listing waits for the user's running Codex call only so long, so a
    // long chat doesn't hold up the settings page.
    release = await acquireCodexRun(
      cliLogin.userId,
      AbortSignal.timeout(CODEX_MODEL_LIST_TIMEOUT_MS),
    );
    const login = await resolveUserCliLogin(Provider.CODEX_CLI, cliLogin);
    usedLogin = login ? "user" : "server";
    run = await startCliRun(Provider.CODEX_CLI, login);
    const codexHome = run.env?.CODEX_HOME;
    if (!codexHome) throw new Error("Codex run has no CODEX_HOME");
    // Codex's own tracing would put unrelated lines on stderr.
    const { RUST_LOG: _rustLog, ...listEnv } = run.env ?? {};
    const result = await runCodexDebugModels(env.CODEX_CLI_PATH, {
      cwd: run.cwd,
      env: listEnv,
    });

    // Codex writes its model cache only after fetching the list for this
    // login. Without it, the output is the list built into the binary.
    const fetched = await access(path.join(codexHome, "models_cache.json"))
      .then(() => true)
      .catch(() => false);
    if (result.exitCode !== 0 || !fetched) {
      if (login && CODEX_AUTH_FAILURE_RE.test(result.stderr)) {
        await markNeedsReconnect(login);
      }
      return { login: usedLogin, models: null };
    }

    const parsed = JSON.parse(result.stdout) as { models?: unknown };
    return {
      login: usedLogin,
      models: Array.isArray(parsed?.models) ? parsed.models : null,
    };
  } catch (error) {
    logger.warn("Could not list Codex models", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { login: usedLogin, models: null };
  } finally {
    await run?.finish();
    release();
  }
}

// Runs `codex debug models` and resolves once the process has exited, so
// nothing writes to the run folder after it is cleaned up. A CLI still
// running at the time limit is stopped, then killed. It runs in its own
// process group so the native binary behind the npm `codex.js` wrapper is
// killed too. If its output still hasn't closed a grace period after the
// kill, it resolves anyway so the user's queue is never held for good.
function runCodexDebugModels(
  codexPath: string,
  run: CliRunSettings,
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const isScript = /\.(?:c|m)?js$/i.test(codexPath);
  const child = spawn(
    isScript ? process.execPath : codexPath,
    [...(isScript ? [codexPath] : []), "debug", "models"],
    {
      cwd: run.cwd,
      // A copy, never undefined: spawn would otherwise hand the child the
      // host's whole environment, credentials included.
      env: { ...run.env } as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    },
  );
  const signalGroup = (signal: NodeJS.Signals) => {
    if (child.pid === undefined) return;
    try {
      process.kill(-child.pid, signal);
    } catch {
      // The whole group has already exited.
    }
  };

  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    if (stdout.length < CODEX_MODEL_LIST_MAX_BYTES) stdout += chunk;
  });
  child.stderr?.on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-4000);
  });

  return new Promise((resolve) => {
    const timers: NodeJS.Timeout[] = [];
    const after = (ms: number, action: () => void) => {
      const timer = setTimeout(action, ms);
      timer.unref?.();
      timers.push(timer);
    };
    const settle = (result: {
      exitCode: number | null;
      stdout: string;
      stderr: string;
    }) => {
      for (const timer of timers) clearTimeout(timer);
      resolve(result);
    };

    after(CODEX_MODEL_LIST_TIMEOUT_MS, () => {
      signalGroup("SIGTERM");
      after(CLI_STOP_WAIT_MS, () => {
        signalGroup("SIGKILL");
        after(CLI_STOP_WAIT_MS, () => {
          logger.error("Killed Codex model listing never closed; freeing it");
          settle({ exitCode: null, stdout: "", stderr });
        });
      });
    });
    // Also emitted when a kill fails; the process may still be running then,
    // so only a CLI that never started resolves here.
    child.on("error", (error) => {
      if (child.pid === undefined) {
        settle({ exitCode: null, stdout: "", stderr: String(error) });
      }
    });
    child.on("close", (exitCode) => {
      settle({ exitCode, stdout, stderr });
    });
  });
}
