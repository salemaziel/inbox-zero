import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { env } from "@/env";
import { SafeError } from "@/utils/error";
import { Provider } from "@/utils/llms/config";
import {
  assertCliLlmEnabled,
  CLI_SUBSCRIPTION_PROVIDERS,
  writeCodexHome,
} from "@/utils/llms/cli-provider";
import { createScopedLogger } from "@/utils/logger";
import prisma from "@/utils/prisma";

// Runs the real Claude Code / Codex CLI sign-in on the server. The person
// finishes it in their own browser. CLI output can carry the sign-in URL, the
// device code, and the minted token, so it is only parsed in memory and is
// never logged or put into an error.

export type SubscriptionProvider = (typeof CLI_SUBSCRIPTION_PROVIDERS)[number];

type LoginStatus =
  | "starting"
  | "waiting"
  | "verifying"
  | "connected"
  | "failed"
  | "cancelled"
  | "expired";

type LoginSession = {
  id: string;
  userId: string;
  provider: SubscriptionProvider;
  status: LoginStatus;
  url?: string;
  deviceCode?: string;
  error?: string;
  expiresAt: number;
  output: string;
  codeSubmitted: boolean;
  child?: ChildProcessWithoutNullStreams;
  tempDir?: string;
  timer?: NodeJS.Timeout;
};

export type SubscriptionLoginView = {
  status: LoginStatus;
  url: string | null;
  deviceCode: string | null;
  error: string | null;
  expiresAt: string;
  needsCode: boolean;
};

export const SUBSCRIPTION_LOGIN_TTL_MS = 10 * 60 * 1000;
// Each sign-in keeps a terminal and a Node CLI alive, so the server caps them.
export const MAX_ACTIVE_SUBSCRIPTION_LOGINS = 5;
export const SUBSCRIPTION_LOGIN_START_COOLDOWN_MS = 30 * 1000;
const MAX_OUTPUT_CHARS = 64 * 1024;
// Claude's sign-in prompt is an Ink text field: a carriage return glued to the
// pasted code folds into the paste, so Return is sent as its own write.
const CODE_SUBMIT_SETTLE_MS = 150;
const ACTIVE_STATUSES: LoginStatus[] = ["starting", "waiting", "verifying"];

const logger = createScopedLogger("llms/subscription-login");

// Server actions and route handlers can load separate module copies, so the
// open sign-ins live on globalThis to be reachable from both.
const globalForLogins = globalThis as unknown as {
  inboxZeroSubscriptionLogins?: Map<string, LoginSession>;
  inboxZeroSubscriptionLoginStarts?: Map<string, number>;
};
globalForLogins.inboxZeroSubscriptionLogins ??= new Map();
globalForLogins.inboxZeroSubscriptionLoginStarts ??= new Map();
const sessions = globalForLogins.inboxZeroSubscriptionLogins;
// When each user last started a sign-in.
const lastStarts = globalForLogins.inboxZeroSubscriptionLoginStarts;

export function isSubscriptionProvider(
  provider: string,
): provider is SubscriptionProvider {
  return CLI_SUBSCRIPTION_PROVIDERS.some((value) => value === provider);
}

export function getSubscriptionLogin({
  userId,
  provider,
}: {
  userId: string;
  provider: SubscriptionProvider;
}): SubscriptionLoginView | null {
  const session = sessions.get(sessionKey(userId, provider));
  if (!session) return null;
  expireIfDue(session);
  return toView(session);
}

export async function startSubscriptionLogin({
  userId,
  provider,
}: {
  userId: string;
  provider: SubscriptionProvider;
}): Promise<SubscriptionLoginView> {
  assertCliLlmEnabled(provider);

  const key = sessionKey(userId, provider);
  const existing = sessions.get(key);
  if (existing) {
    expireIfDue(existing);
    if (isActive(existing)) return toView(existing);
    sessions.delete(key);
  }
  assertCanStartLogin(userId);

  const session: LoginSession = {
    id: randomUUID(),
    userId,
    provider,
    status: "starting",
    expiresAt: Date.now() + SUBSCRIPTION_LOGIN_TTL_MS,
    output: "",
    codeSubmitted: false,
  };
  sessions.set(key, session);
  session.timer = setTimeout(
    () => expireIfDue(session),
    SUBSCRIPTION_LOGIN_TTL_MS,
  );
  session.timer.unref?.();

  try {
    const { command, childEnv } = await prepareLogin(session);
    if (session.status !== "starting") return toView(session);
    launchLogin(session, command, childEnv);
  } catch (error) {
    logger.warn("Could not start CLI sign-in", { provider });
    await finish(session, "failed", "Could not start sign-in on the server.");
    if (error instanceof SafeError) throw error;
  }

  return toView(session);
}

export function submitSubscriptionLoginCode({
  userId,
  code,
}: {
  userId: string;
  code: string;
}) {
  const session = sessions.get(sessionKey(userId, Provider.CLAUDE_CODE));
  if (session) expireIfDue(session);
  if (
    !session?.child ||
    session.status !== "waiting" ||
    !session.url ||
    session.codeSubmitted
  ) {
    throw new SafeError(
      "This sign-in can't accept a code anymore. Start sign-in again.",
    );
  }

  const child = session.child;
  session.codeSubmitted = true;
  session.status = "verifying";
  child.stdin.write(code);
  setTimeout(() => {
    if (!child.killed) child.stdin.write("\r");
  }, CODE_SUBMIT_SETTLE_MS);
}

export async function cancelSubscriptionLogin({
  userId,
  provider,
}: {
  userId: string;
  provider: SubscriptionProvider;
}) {
  const key = sessionKey(userId, provider);
  const session = sessions.get(key);
  if (!session) return;
  if (isActive(session)) await finish(session, "cancelled");
  sessions.delete(key);
}

export async function disconnectSubscriptionLogin({
  userId,
  provider,
}: {
  userId: string;
  provider: SubscriptionProvider;
}) {
  await cancelSubscriptionLogin({ userId, provider });
  await prisma.aiSubscriptionLogin.deleteMany({ where: { userId, provider } });
}

export function parseClaudeLoginUrl(text: string): string | null {
  const lines = stripTerminalControls(text).split("\n");

  for (let i = 0; i < lines.length; i++) {
    const start = lines[i].search(/https:\/\/claude\.(?:ai|com)\//);
    if (start === -1) continue;

    // A narrow terminal hard-wraps the URL across lines with no separator.
    let candidate = lines[i].slice(start).trim();
    let lastLine = i;
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j].trim();
      if (!next || !URL_CHARS_ONLY_RE.test(next)) break;
      candidate += next;
      lastLine = j;
    }

    // Output arrives in chunks; a URL on the final, unterminated line may be
    // cut short.
    if (lastLine === lines.length - 1) return null;
    if (isClaudeLoginUrl(candidate)) return candidate;
  }

  return null;
}

export function parseClaudeSetupToken(text: string): string | null {
  const clean = stripTerminalControls(text);
  const before = clean.search(/OAuth token[^\n]*:/i);
  if (before === -1) return null;

  const afterBefore = clean.slice(before).replace(/^[^\n]*\n?/, "");
  const after = afterBefore.search(/Store this token/i);
  // Between the two anchors the token may be wrapped across lines.
  const tokenBlock =
    after === -1
      ? (afterBefore.split("\n").find((line) => line.trim()) ?? "")
      : afterBefore.slice(0, after).replace(/\s+/g, "");

  const match = tokenBlock.trim().match(/^sk-ant-oat01-[A-Za-z0-9_-]{20,}$/);
  return match ? match[0] : null;
}

export function parseCodexDeviceLogin(
  text: string,
): { url: string; code: string } | null {
  const clean = stripTerminalControls(text);
  const urlMatch = clean.match(/https:\/\/auth\.openai\.com\/codex\/device\b/);
  if (!urlMatch || urlMatch.index === undefined) return null;

  const afterUrl = clean.slice(urlMatch.index + urlMatch[0].length);
  const codeMatch = afterUrl.match(/(?:^|\s)([A-Z0-9]{4}-[A-Z0-9]{4,6})(?=\s)/);
  if (!codeMatch) return null;

  return { url: urlMatch[0], code: codeMatch[1] };
}

const URL_CHARS_ONLY_RE = /^[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+$/;
// biome-ignore-start lint/suspicious/noControlCharactersInRegex: terminal escape sequences
const OSC8_HYPERLINK_RE =
  /\x1b\]8;[^;\x07\x1b]*;([^\x07\x1b]*)(?:\x07|\x1b\\)[\s\S]*?\x1b\]8;[^;\x07\x1b]*;(?:\x07|\x1b\\)/g;
const OSC_ANY_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const CSI_HORIZONTAL_MOVE_RE = /\x1b\[[0-9;]*[GC]/g;
const CSI_ANY_RE = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const ESC_SHORT_RE = /\x1b[()][A-Za-z0-9]|\x1b[=>78]/g;
// biome-ignore-end lint/suspicious/noControlCharactersInRegex: terminal escape sequences

function assertCanStartLogin(userId: string) {
  const now = Date.now();
  const lastStart = lastStarts.get(userId);
  if (
    lastStart !== undefined &&
    now - lastStart < SUBSCRIPTION_LOGIN_START_COOLDOWN_MS
  ) {
    throw new SafeError("Wait a few seconds before starting another sign-in.");
  }

  let active = 0;
  for (const session of sessions.values()) {
    expireIfDue(session);
    if (isActive(session)) active++;
  }
  if (active >= MAX_ACTIVE_SUBSCRIPTION_LOGINS) {
    throw new SafeError(
      "Too many sign-ins are in progress. Try again in a few minutes.",
    );
  }

  for (const [id, startedAt] of lastStarts) {
    if (now - startedAt >= SUBSCRIPTION_LOGIN_START_COOLDOWN_MS) {
      lastStarts.delete(id);
    }
  }
  lastStarts.set(userId, now);
}

function sessionKey(userId: string, provider: SubscriptionProvider) {
  return `${userId}:${provider}`;
}

function isActive(session: LoginSession) {
  return ACTIVE_STATUSES.includes(session.status);
}

function expireIfDue(session: LoginSession) {
  if (isActive(session) && Date.now() >= session.expiresAt) {
    finish(session, "expired", "Sign-in timed out. Start again.");
  }
}

function toView(session: LoginSession): SubscriptionLoginView {
  return {
    status: session.status,
    url: session.url ?? null,
    deviceCode: session.deviceCode ?? null,
    error: session.error ?? null,
    expiresAt: new Date(session.expiresAt).toISOString(),
    needsCode:
      session.provider === Provider.CLAUDE_CODE &&
      session.status === "waiting" &&
      !!session.url &&
      !session.codeSubmitted,
  };
}

async function prepareLogin(session: LoginSession) {
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ANTHROPIC_API_KEY: "",
    ANTHROPIC_AUTH_TOKEN: "",
    CLAUDE_CODE_OAUTH_TOKEN: "",
    OPENAI_API_KEY: "",
    CODEX_API_KEY: "",
    // The CLI would otherwise try to open a browser on the server.
    BROWSER: "true",
  };

  // A fresh 0700 folder, so the server's own login is never seen. For Codex
  // the auth.json written here is saved to the database, then the folder is
  // deleted.
  session.tempDir = await mkdtemp(
    path.join(os.tmpdir(), "inbox-zero-cli-login-"),
  );

  if (session.provider === Provider.CLAUDE_CODE) {
    childEnv.CLAUDE_CONFIG_DIR = session.tempDir;
    return { command: "claude setup-token", childEnv };
  }

  await writeCodexHome(session.tempDir);
  childEnv.CODEX_HOME = session.tempDir;
  const codex = env.CODEX_CLI_PATH ? shellQuote(env.CODEX_CLI_PATH) : "codex";
  return { command: `${codex} login --device-auth`, childEnv };
}

function launchLogin(
  session: LoginSession,
  command: string,
  childEnv: NodeJS.ProcessEnv,
) {
  // Both CLIs need a terminal. util-linux `script` provides one; the wide
  // terminal keeps the sign-in URL on one line.
  const child = spawn(
    "script",
    [
      "-qfec",
      `stty cols 500 rows 50 2>/dev/null; exec ${command}`,
      "/dev/null",
    ],
    { env: childEnv, stdio: ["pipe", "pipe", "pipe"] },
  );
  session.child = child;

  const onData = (chunk: Buffer) => {
    if (!isActive(session)) return;
    session.output = (session.output + chunk.toString("utf8")).slice(
      -MAX_OUTPUT_CHARS,
    );
    if (session.url) return;

    if (session.provider === Provider.CLAUDE_CODE) {
      const url = parseClaudeLoginUrl(session.output);
      if (url) {
        session.url = url;
        session.status = "waiting";
      }
      return;
    }

    const prompt = parseCodexDeviceLogin(session.output);
    if (prompt) {
      session.url = prompt.url;
      session.deviceCode = prompt.code;
      session.status = "waiting";
    }
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);

  child.once("error", () => {
    logger.warn("CLI sign-in terminal unavailable", {
      provider: session.provider,
    });
    finish(
      session,
      "failed",
      "Sign-in needs the `script` command (util-linux) on the server.",
    );
  });

  child.once("close", (exitCode) => {
    completeLogin(session, exitCode).catch(() => {
      logger.error("Could not save CLI sign-in", {
        provider: session.provider,
      });
      return finish(session, "failed", "Could not save the sign-in.");
    });
  });
}

async function completeLogin(session: LoginSession, exitCode: number | null) {
  session.child = undefined;
  if (!isActive(session)) return;

  const failMessage = "Sign-in didn't finish. Start again.";

  if (session.provider === Provider.CLAUDE_CODE) {
    const token = parseClaudeSetupToken(session.output);
    if (exitCode !== 0 || !token) {
      logger.warn("Claude sign-in did not produce a token", { exitCode });
      return finish(session, "failed", failMessage);
    }
    await saveLogin(session, token);
    return finish(session, "connected");
  }

  const authJson = session.tempDir
    ? await readFile(path.join(session.tempDir, "auth.json"), "utf8").catch(
        () => null,
      )
    : null;
  if (exitCode !== 0 || !authJson || !isJsonObject(authJson)) {
    logger.warn("Codex sign-in did not finish", { exitCode });
    return finish(session, "failed", failMessage);
  }
  await saveLogin(session, authJson);
  return finish(session, "connected");
}

async function saveLogin(session: LoginSession, credential: string) {
  const { userId, provider } = session;
  const data = {
    credential,
    status: "connected",
    lastError: null,
    connectedAt: new Date(),
  };
  await prisma.aiSubscriptionLogin.upsert({
    where: { userId_provider: { userId, provider } },
    create: { userId, provider, ...data },
    update: data,
  });
  logger.info("Connected CLI subscription login", { provider });
}

async function finish(
  session: LoginSession,
  status: LoginStatus,
  error?: string,
) {
  session.status = status;
  session.error = error;
  session.output = "";
  if (session.timer) clearTimeout(session.timer);
  session.child?.kill("SIGTERM");
  session.child = undefined;

  const { tempDir } = session;
  session.tempDir = undefined;
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
}

// Strips ANSI/OSC sequences: OSC 8 hyperlinks become their URL, cursor moves
// become a space so Ink's column layout still reads as words.
function stripTerminalControls(text: string): string {
  return text
    .replace(OSC8_HYPERLINK_RE, "$1")
    .replace(OSC_ANY_RE, "")
    .replace(CSI_HORIZONTAL_MOVE_RE, " ")
    .replace(CSI_ANY_RE, "")
    .replace(ESC_SHORT_RE, "")
    .replace(/\r\n|\r/g, "\n");
}

function isClaudeLoginUrl(candidate: string): boolean {
  try {
    const url = new URL(candidate);
    return (
      url.protocol === "https:" &&
      (url.hostname === "claude.ai" || url.hostname === "claude.com") &&
      url.pathname.endsWith("/oauth/authorize") &&
      url.searchParams.has("code_challenge") &&
      url.searchParams.has("state")
    );
  } catch {
    return false;
  }
}

function isJsonObject(text: string): boolean {
  try {
    const value: unknown = JSON.parse(text);
    return !!value && typeof value === "object";
  } catch {
    return false;
  }
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
