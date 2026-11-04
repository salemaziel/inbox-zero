import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import { env } from "@/env";
import { SafeError } from "@/utils/error";
import {
  assertCliLlmEnabled,
  getFactory,
  getModelMethod,
  importOptionalProviderPackage,
} from "@/utils/llms/cli-provider";
import {
  buildCodexBridgedModel,
  CLI_TOOLS_MCP_SERVER_NAME,
  parseCodexMcpPayload,
} from "@/utils/llms/codex-tool-bridge";
import { Provider } from "@/utils/llms/config";
import {
  type CliLoginScope,
  markNeedsReconnect,
  RECONNECT_SUBSCRIPTION_MESSAGE,
  resolveUserCliLogin,
  type UserCliLogin,
} from "@/utils/llms/subscription-access";
import type { ResolvedModel } from "@/utils/llms/model";
import {
  isSubscriptionProvider,
  type ReasoningEffort,
  SUBSCRIPTION_MODELS,
} from "@/utils/llms/subscription-config";
import { createScopedLogger } from "@/utils/logger";
import prisma from "@/utils/prisma";

type CliProviderModule = Record<string, unknown>;

export type McpBridgedTool = {
  description?: string;
  inputSchema: unknown;
  execute?: (input: never, options?: unknown) => unknown;
};

type McpBridgeFactory = (
  name: string,
  tools: Record<string, McpBridgedTool>,
) => unknown;

// The working folder and env one CLI call runs with.
export type CliRunSettings = { cwd: string; env?: Record<string, string> };

export type CliRun = CliRunSettings & { finish: () => Promise<void> };

type BuiltCliModel = {
  model: LanguageModelV4;
  // Rewrites each response part before the caller sees it.
  mapPart?: (part: unknown) => unknown;
  // Runs once the CLI has exited; the run is freed when it settles.
  close?: () => Promise<void>;
};

type BuildCliModel = (
  module: CliProviderModule,
  // `abortSignal` aborts when the run is stopped.
  run: CliRunSettings & { abortSignal: AbortSignal },
) => BuiltCliModel | Promise<BuiltCliModel>;

const logger = createScopedLogger("llms/cli-provider");

const CLAUDE_CODE_PACKAGE = "ai-sdk-provider-claude-code";
const CODEX_CLI_PACKAGE = "ai-sdk-provider-codex-cli";
// Every Codex run gets only this config, never the host's: no shell, file,
// image, web or sub-agent tools and no MCP servers, plugins or apps. The only
// tools a run can get are Inbox Zero's own, added per run over MCP.
// Checked with `codex debug prompt-input` on Codex CLI 0.164.0.
const CODEX_CONFIG_TOML = `cli_auth_credentials_store = "file"
web_search = "disabled"

[features]
shell_tool = false
view_image = false
multi_agent = false
image_generation = false
apps = false
plugins = false
computer_use = false
browser_use = false

[agents]
enabled = false
`;

// Host variables a Codex run may inherit. ai-sdk-provider-codex-cli spreads
// the whole server env into the child, so every other key is blanked.
const CODEX_SAFE_ENV_RE =
  /^(?:PATH|HOME|USER|LOGNAME|SHELL|LANG|LANGUAGE|LC_[A-Z_]+|TZ|TMPDIR|TERM|(?:HTTPS?|NO|ALL)_PROXY|(?:https?|no|all)_proxy|SSL_CERT_FILE|SSL_CERT_DIR|NODE_EXTRA_CA_CERTS|CODEX_CA_CERTIFICATE|RUST_LOG)$/;
export const CODEX_AUTH_FAILURE_RE =
  /\b401\b|unauthorized|not logged in|refresh token|log in again|sign in again/i;
// The server's own Codex login, kept only for runs that use it.
const CODEX_SERVER_LOGIN_ENV = ["OPENAI_API_KEY", "CODEX_API_KEY"];

export const CODEX_TOOL_BLOCKED_MESSAGE =
  "The AI model tried to run a command, so the request was stopped.";

// Concurrent Codex runs for one user would race on its rotating refresh token.
// Kept on globalThis because route handlers and server actions can load
// separate module copies. This only serializes runs within one server process.
const globalForCodexRuns = globalThis as unknown as {
  inboxZeroCodexRunQueues?: Map<string, Promise<void>>;
};
globalForCodexRuns.inboxZeroCodexRunQueues ??= new Map();
const codexRunQueues = globalForCodexRuns.inboxZeroCodexRunQueues;

// A call still running after this long is stopped. A stopped CLI that still
// hasn't exited this long after that has its run slot and folder freed anyway.
export const MAX_CLI_CALL_MS = 20 * 60 * 1000;
// How long a stopped CLI gets to exit before that is logged as an error, and
// how long a CLI tool server gets to close.
export const CLI_STOP_WAIT_MS = 10 * 1000;

// Codex reads its login from auth.json in CODEX_HOME. config.toml keeps it in
// that file instead of the system keyring.
export async function writeCodexHome(home: string, authJson?: string) {
  await writeFile(path.join(home, "config.toml"), CODEX_CONFIG_TOML, {
    mode: 0o600,
  });
  if (authJson !== undefined) {
    await writeFile(path.join(home, "auth.json"), authJson, { mode: 0o600 });
  }
}

// The Claude Code child env for a user's own login. ai-sdk-provider-claude-code
// copies every ANTHROPIC_* and CLAUDE_* host variable into the child env
// before applying these overrides, so those are blanked first.
export function buildClaudeUserEnv({
  credential,
  configDir,
}: {
  credential: string;
  configDir: string;
}): Record<string, string> {
  const blanked = Object.fromEntries(
    Object.keys(process.env)
      .filter(
        (key) => key.startsWith("ANTHROPIC_") || key.startsWith("CLAUDE_CODE_"),
      )
      .map((key) => [key, ""]),
  );

  return {
    ...blanked,
    ANTHROPIC_API_KEY: "",
    CLAUDE_CODE_OAUTH_TOKEN: credential,
    CLAUDE_CONFIG_DIR: configDir,
  };
}

// The Codex child env for a run's own Codex home. Only a server-login run
// keeps the server's API key variables.
export function buildCodexEnv({
  codexHome,
  home,
  serverLogin,
}: {
  codexHome: string;
  home: string;
  serverLogin: boolean;
}): Record<string, string> {
  const childEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    const keep =
      CODEX_SAFE_ENV_RE.test(key) ||
      (serverLogin && CODEX_SERVER_LOGIN_ENV.includes(key));
    childEnv[key] = keep ? (value ?? "") : "";
  }

  return { ...childEnv, HOME: home, CODEX_HOME: codexHome };
}

export function selectSubscriptionCliModel({
  aiProvider,
  aiModel,
  cliLogin,
  reasoningEffort,
}: {
  aiProvider: string;
  aiModel: string | null;
  cliLogin?: CliLoginScope;
  reasoningEffort?: ReasoningEffort | null;
}): ResolvedModel {
  if (!isSubscriptionProvider(aiProvider)) {
    throw new SafeError(`Unsupported CLI LLM provider: ${aiProvider}`);
  }
  const modelName = aiModel || SUBSCRIPTION_MODELS[aiProvider].defaultModel;
  return {
    provider: aiProvider,
    modelName,
    model: createSubscriptionCliModel({
      provider: aiProvider,
      modelName,
      cliLogin,
      reasoningEffort,
    }),
    cliLogin,
    reasoningEffort: reasoningEffort ?? null,
  };
}

export function createSubscriptionCliModel({
  provider,
  modelName,
  cliLogin,
  reasoningEffort,
}: {
  provider: string;
  modelName: string;
  cliLogin?: CliLoginScope;
  // Checked against the model's supported levels when it was saved.
  reasoningEffort?: ReasoningEffort | null;
}): LanguageModelV4 {
  assertCliLlmEnabled(provider);

  switch (provider) {
    case Provider.CODEX_CLI:
      return createCliRunModel({
        provider,
        modelName,
        cliLogin,
        buildModel: (module, run) => ({
          model: getFactory(
            module,
            "codexExec",
            provider,
          )(modelName, {
            ...codexRunSettings(run),
            ...(reasoningEffort ? { reasoningEffort } : {}),
          }),
        }),
      });
    case Provider.CLAUDE_CODE:
      return createCliRunModel({
        provider,
        modelName,
        cliLogin,
        buildModel: (module, run) => ({
          model: getFactory(
            module,
            "claudeCode",
            provider,
          )(modelName, {
            ...claudeCodeRunSettings(run),
            ...(reasoningEffort ? { effort: reasoningEffort } : {}),
            allowedTools: [],
          }),
        }),
      });
    default:
      throw new SafeError(`Unsupported CLI LLM provider: ${provider}`);
  }
}

// AI SDK tools cannot be auto-bridged at the LanguageModelV4 layer: by the
// time the wrapper sees them they have been reduced to JSON schemas with no
// `execute`. Callers that pass tools must therefore use this helper, which
// serves the original tool record to the CLI as one MCP server in this
// process, so the CLI calls the tools and Inbox Zero runs them.
export async function createSubscriptionCliModelWithTools({
  provider,
  modelName,
  tools,
  cliLogin,
  reasoningEffort,
}: {
  provider: string;
  modelName: string;
  tools: Record<string, McpBridgedTool>;
  cliLogin?: CliLoginScope;
  reasoningEffort?: ReasoningEffort | null;
}): Promise<LanguageModelV4> {
  assertCliLlmEnabled(provider);

  const toolNames = Object.keys(tools);
  if (toolNames.length === 0) {
    return createSubscriptionCliModel({
      provider,
      modelName,
      cliLogin,
      reasoningEffort,
    });
  }

  switch (provider) {
    case Provider.CODEX_CLI:
      return createCliRunModel({
        provider,
        modelName,
        cliLogin,
        bridgedToolNames: toolNames,
        buildModel: (module, run) =>
          buildCodexBridgedModel({
            module,
            modelName,
            tools,
            run,
            runSettings: codexRunSettings(run),
            reasoningEffort,
            maxCallMs: MAX_CLI_CALL_MS,
            stopWaitMs: CLI_STOP_WAIT_MS,
          }),
      });
    case Provider.CLAUDE_CODE: {
      const allowedTools = toolNames.map((name) => prefixToolName(name));
      return createCliRunModel({
        provider,
        modelName,
        cliLogin,
        buildModel: (module, run) => {
          const claudeCode = getFactory(module, "claudeCode", provider);
          const createBridge = getFactory(
            module,
            "createAiSdkMcpServer",
            provider,
          ) as McpBridgeFactory;
          const mcpServer = createBridge(CLI_TOOLS_MCP_SERVER_NAME, tools);

          return {
            model: claudeCode(modelName, {
              ...claudeCodeRunSettings(run),
              ...(reasoningEffort ? { effort: reasoningEffort } : {}),
              allowedTools,
              mcpServers: { [CLI_TOOLS_MCP_SERVER_NAME]: mcpServer },
            }),
            mapPart: unprefixPart,
          };
        },
      });
    }
    default:
      throw new SafeError(`Unsupported CLI LLM provider: ${provider}`);
  }
}

function codexRunSettings(run: CliRunSettings) {
  return {
    allowNpx: env.CODEX_CLI_ALLOW_NPX,
    skipGitRepoCheck: true,
    approvalMode: "never",
    sandboxMode: "read-only",
    ...(env.CODEX_CLI_PATH ? { codexPath: env.CODEX_CLI_PATH } : {}),
    cwd: run.cwd,
    env: run.env,
    logger: false,
  };
}

// No built-in tools (Read/Grep/Bash/...) and no saved transcripts: the model
// only gets the bridged Inbox Zero tools, and runs in an empty folder.
function claudeCodeRunSettings(run: CliRunSettings) {
  return {
    settingSources: [],
    tools: [],
    persistSession: false,
    cwd: run.cwd,
    permissionMode: "default",
    sandbox: { enabled: true },
    ...(run.env ? { env: run.env } : {}),
  };
}

const TOOL_NAME_PREFIX = `mcp__${CLI_TOOLS_MCP_SERVER_NAME}__`;

function prefixToolName(name: string): string {
  return `${TOOL_NAME_PREFIX}${name}`;
}

function unprefixToolName(name: string): string {
  return name.startsWith(TOOL_NAME_PREFIX)
    ? name.slice(TOOL_NAME_PREFIX.length)
    : name;
}

// The MCP bridge causes the Claude Code CLI to surface tool calls as
// `mcp__inboxzero__<name>`. Inbox Zero callers (stop conditions, UI part
// renderers, validators) match on the original tool names, so the prefix is
// stripped from every `toolName` field before it reaches the AI SDK consumer.
function unprefixPart(part: unknown): unknown {
  if (!part || typeof part !== "object") return part;
  const record = part as Record<string, unknown>;
  if (typeof record.toolName !== "string") return part;
  return { ...record, toolName: unprefixToolName(record.toolName) };
}

// Every call gets its own throwaway folder and login lookup, so a refreshed
// Codex login is read fresh and nothing is left on disk between calls. For a
// user's own login, Codex calls are serialized per user and a rejected login
// becomes a reconnect prompt.
function createCliRunModel({
  provider,
  modelName,
  cliLogin,
  bridgedToolNames = [],
  buildModel,
}: {
  provider: string;
  modelName: string;
  cliLogin?: CliLoginScope;
  // Inbox Zero tools served to this run; Codex may call only these.
  bridgedToolNames?: readonly string[];
  buildModel: BuildCliModel;
}): LanguageModelV4 {
  let modulePromise: Promise<CliProviderModule> | undefined;
  const getModule = () => {
    modulePromise ??= importOptionalProviderPackage(
      provider === Provider.CODEX_CLI ? CODEX_CLI_PACKAGE : CLAUDE_CODE_PACKAGE,
      provider,
    );
    return modulePromise;
  };

  const startCall = async (options: unknown) => {
    const module = await getModule();
    const callerSignal = (options as { abortSignal?: AbortSignal } | undefined)
      ?.abortSignal;
    const release =
      provider === Provider.CODEX_CLI && cliLogin
        ? await acquireCodexRun(cliLogin.userId, callerSignal)
        : () => {};

    let run: CliRun | undefined;
    try {
      const login = await resolveUserCliLogin(provider, cliLogin);
      if (!login) release();
      run = await startCliRun(provider, login);

      // Both providers stop their CLI process when this signal aborts.
      const stopController = new AbortController();
      const abortSignal = callerSignal
        ? AbortSignal.any([callerSignal, stopController.signal])
        : stopController.signal;

      const {
        model,
        mapPart = (part: unknown) => part,
        close,
      } = await buildModel(module, { ...run, abortSignal });

      let launched = false;
      let markExited = () => {};
      const exited = new Promise<void>((resolve) => {
        markExited = resolve;
      });

      // Runs once the CLI has exited, or once a stopped CLI has outlived the
      // hard cap in `waitForStoppedExit`.
      let ending: Promise<void> | undefined;
      const end = () => {
        ending ??= (async () => {
          clearTimeout(maxCallTimer);
          callerSignal?.removeEventListener("abort", onCallerAbort);
          if (close) {
            await close().catch(() => {
              logger.warn("Could not stop the CLI tool server", { provider });
            });
          }
          await run?.finish();
          release();
        })();
        return ending;
      };

      let stopping: Promise<void> | undefined;
      const call = {
        model,
        options: { ...(options as object), abortSignal },
        // Settles once the CLI process has exited.
        exited,
        markExited,
        // Call right before starting the CLI; a call stopped before this
        // never starts one.
        launch: () => {
          abortSignal.throwIfAborted();
          launched = true;
        },
        mapPart,
        // Codex's own tools are turned off in its config; if it runs one
        // anyway, or any tool that isn't a bridged Inbox Zero tool, the run
        // is stopped.
        findBlockedTool:
          provider === Provider.CODEX_CLI
            ? (part: unknown) => findBlockedCodexTool(part, bridgedToolNames)
            : () => null,
        end,
        // The login folder and run slot are only freed once the CLI has
        // exited. The provider can only ask it to exit (SIGTERM) and exposes
        // no way to force it, so a CLI that ignores that holds its slot up to
        // a hard cap, and is logged as an error.
        stop: (reason: unknown) => {
          stopping ??= (async () => {
            stopController.abort(reason);
            if (!launched) markExited();
            await waitForStoppedExit(exited, provider);
            await end();
          })();
          return stopping;
        },
        // Returns the reconnect error when the user's login was rejected.
        checkLoginRejected: async (
          error: unknown,
        ): Promise<SafeError | null> => {
          if (!login || !isCliAuthenticationError(module, provider, error)) {
            return null;
          }
          await markNeedsReconnect(login);
          return new SafeError(RECONNECT_SUBSCRIPTION_MESSAGE);
        },
        handleError: async (error: unknown): Promise<never> => {
          throw (await call.checkLoginRejected(error)) ?? error;
        },
      };

      const maxCallTimer = setTimeout(() => {
        logger.warn("CLI call ran too long; stopping it", { provider });
        call.stop(new Error("CLI call ran too long")).catch(() => undefined);
      }, MAX_CLI_CALL_MS);
      maxCallTimer.unref?.();

      // A caller that aborts and then drops the stream still frees the run
      // once the CLI exits.
      const onCallerAbort = () => {
        call.stop(callerSignal?.reason).catch(() => undefined);
      };
      callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
      if (callerSignal?.aborted) onCallerAbort();

      return call;
    } catch (error) {
      await run?.finish();
      release();
      throw error;
    }
  };

  return {
    specificationVersion: "v4",
    provider,
    modelId: modelName,
    supportedUrls: {},
    async doGenerate(...args: unknown[]) {
      const call = await startCall(args[0]);
      try {
        const doGenerate = getModelMethod(call.model, "doGenerate", provider);
        call.launch();
        const pending = Promise.resolve(
          doGenerate(call.options, ...args.slice(1)),
        );
        pending.then(call.markExited, call.markExited);
        const result = (await pending) as { content?: unknown } & Record<
          string,
          unknown
        >;
        if (!Array.isArray(result.content)) return result;
        // The run has already finished here, so its output is dropped.
        const blockedTool = result.content
          .map(call.findBlockedTool)
          .find(Boolean);
        if (blockedTool) throw blockedToolError(provider, blockedTool);
        return { ...result, content: result.content.map(call.mapPart) };
      } catch (error) {
        return await call.handleError(error);
      } finally {
        await call.end();
      }
    },
    async doStream(...args: unknown[]) {
      const call = await startCall(args[0]);
      let result: { stream: ReadableStream<unknown> } & Record<string, unknown>;
      try {
        const doStream = getModelMethod(call.model, "doStream", provider);
        call.launch();
        result = (await doStream(
          call.options,
          ...args.slice(1),
        )) as typeof result;
      } catch (error) {
        // Neither provider has a CLI running when doStream itself fails.
        call.markExited();
        await call.end();
        return call.handleError(error);
      }
      // The CLI keeps running while the stream is read, so its folder and the
      // Codex run slot are kept until it exits. The source stream ends when
      // the CLI exits, so it is read through here as parts arrive, whether
      // or not anyone reads this stream, and the run is freed as soon as it
      // ends. Both providers report a rejected login inside the stream (an
      // error part, or by erroring the stream), not from doStream itself.
      const reader = result.stream.getReader();
      let downstreamOpen = true;
      let downstream: ReadableStreamDefaultController<unknown> | undefined;
      const stream = new ReadableStream({
        start(controller) {
          downstream = controller;
        },
        async cancel(reason: unknown) {
          downstreamOpen = false;
          await call.stop(reason);
          await reader.cancel(reason).catch(() => undefined);
        },
      });

      const forward = async () => {
        let failure: unknown;
        let failed = false;
        try {
          while (true) {
            const next = await reader.read();
            if (next.done) break;
            // After a stop, the rest is read only to see the CLI exit.
            if (failed || !downstreamOpen) continue;
            const blockedTool = call.findBlockedTool(next.value);
            if (blockedTool) {
              failed = true;
              failure = blockedToolError(provider, blockedTool);
              call.stop(failure).catch(() => undefined);
              continue;
            }
            const part = next.value as { type?: string; error?: unknown };
            const rejected =
              part?.type === "error"
                ? await call.checkLoginRejected(part.error)
                : null;
            if (downstreamOpen) {
              downstream?.enqueue(
                rejected ? { ...part, error: rejected } : call.mapPart(part),
              );
            }
          }
        } catch (error) {
          if (!failed) {
            failed = true;
            failure = (await call.checkLoginRejected(error)) ?? error;
          }
        }
        call.markExited();
        await call.end();
        if (!downstreamOpen) return;
        if (failed) downstream?.error(failure);
        else downstream?.close();
      };
      forward().catch(() => {
        logger.error("Could not finish reading the CLI stream", { provider });
      });
      return { ...result, stream };
    },
  } as unknown as LanguageModelV4;
}

// A fresh 0700 folder per call: an empty working directory, plus the user's
// Claude config dir or Codex home. Codex rotates its refresh token, so a
// changed auth.json is saved back before the folder is deleted.
export async function startCliRun(
  provider: string,
  login: UserCliLogin | null,
): Promise<CliRun> {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "inbox-zero-cli-run-"));
  const removeRunDir = () =>
    rm(runDir, { recursive: true, force: true }).catch(() => {
      logger.warn("Could not remove CLI run folder", { provider });
    });

  try {
    const cwd = path.join(runDir, "work");
    await mkdir(cwd, { mode: 0o700 });

    if (provider === Provider.CODEX_CLI) {
      const codexHome = path.join(runDir, "codex");
      await mkdir(codexHome, { mode: 0o700 });
      if (!login) {
        // The server's login is linked, not copied: Codex rewrites auth.json
        // in place when it refreshes, so the refresh lands in the host file.
        await writeCodexHome(codexHome);
        await symlink(
          path.join(getHostCodexHome(), "auth.json"),
          path.join(codexHome, "auth.json"),
        );
        return {
          cwd,
          env: buildCodexEnv({ codexHome, home: runDir, serverLogin: true }),
          finish: removeRunDir,
        };
      }
      await writeCodexHome(codexHome, login.credential);
      return {
        cwd,
        env: buildCodexEnv({ codexHome, home: runDir, serverLogin: false }),
        finish: async () => {
          await saveRefreshedCodexLogin(codexHome, login).catch(() => {
            logger.error("Could not save refreshed Codex login");
          });
          await removeRunDir();
        },
      };
    }

    if (!login) return { cwd, finish: removeRunDir };
    const configDir = path.join(runDir, "claude");
    await mkdir(configDir, { mode: 0o700 });
    return {
      cwd,
      env: buildClaudeUserEnv({ credential: login.credential, configDir }),
      finish: removeRunDir,
    };
  } catch (error) {
    await removeRunDir();
    throw error;
  }
}

async function saveRefreshedCodexLogin(codexHome: string, login: UserCliLogin) {
  const authJson = await readFile(
    path.join(codexHome, "auth.json"),
    "utf8",
  ).catch(() => null);
  if (!authJson || authJson === login.credential) return;

  // Only the sign-in this run started from: a disconnect or a newer sign-in
  // in the meantime wins.
  await prisma.aiSubscriptionLogin.updateMany({
    where: {
      userId: login.userId,
      provider: login.provider,
      status: "connected",
      connectedAt: login.connectedAt,
    },
    data: { credential: authJson },
  });
}

// Codex reports each tool it runs itself (shell, file patch, web search, MCP)
// as a provider-executed tool call. Only calls to this run's bridged Inbox
// Zero tools pass; returns the name of any other tool.
function findBlockedCodexTool(
  part: unknown,
  bridgedToolNames: readonly string[],
): string | null {
  if (!part || typeof part !== "object") return null;
  const { type, providerExecuted, toolName, input } = part as {
    type?: unknown;
    providerExecuted?: unknown;
    toolName?: unknown;
    input?: unknown;
  };
  if (type !== "tool-call" || providerExecuted !== true) return null;
  const call = parseCodexMcpPayload(input);
  if (
    call?.server === CLI_TOOLS_MCP_SERVER_NAME &&
    typeof call.tool === "string" &&
    bridgedToolNames.includes(call.tool)
  ) {
    return null;
  }
  return typeof toolName === "string" && toolName ? toolName : "unknown";
}

// Only the tool name is logged: its input and output may hold email content.
function blockedToolError(provider: string, toolName: string) {
  logger.warn("Stopped a CLI run that used one of its own tools", {
    provider,
    toolName,
  });
  return new SafeError(CODEX_TOOL_BLOCKED_MESSAGE);
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });
}

function getHostCodexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

function isCliAuthenticationError(
  module: CliProviderModule,
  provider: string,
  error: unknown,
): boolean {
  const isAuthenticationError = module.isAuthenticationError;
  if (
    typeof isAuthenticationError === "function" &&
    isAuthenticationError(error)
  ) {
    return true;
  }
  if (provider !== Provider.CODEX_CLI) return false;

  // When Codex's own login is rejected it just exits non-zero; the provider
  // only tags the error as auth when the CLI can't start, so read stderr.
  const stderr = (error as { data?: { stderr?: unknown } } | null)?.data
    ?.stderr;
  return typeof stderr === "string" && CODEX_AUTH_FAILURE_RE.test(stderr);
}

export async function acquireCodexRun(
  userId: string,
  abortSignal: AbortSignal | undefined,
): Promise<() => void> {
  const previous = codexRunQueues.get(userId) ?? Promise.resolve();
  let release = () => {};
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  // The tail settles only once every run ahead has finished too, so the
  // queue entry is removed then, not when this run releases.
  const tail = previous.then(() => current);
  codexRunQueues.set(userId, tail);
  tail.then(() => {
    if (codexRunQueues.get(userId) === tail) codexRunQueues.delete(userId);
  });

  // A request cancelled while waiting leaves the queue at once; the runs
  // behind it still wait for the ones ahead.
  try {
    await waitUnlessAborted(previous, abortSignal);
  } catch (error) {
    release();
    throw error;
  }
  return release;
}

// Waits for a stopped CLI to exit. Past the grace period it is logged; past
// the hard cap its run is freed anyway so the user's queue is not stuck.
async function waitForStoppedExit(exited: Promise<void>, provider: string) {
  const exitedWithin = (ms: number) =>
    Promise.race([exited.then(() => true), sleep(ms).then(() => false)]);

  if (await exitedWithin(CLI_STOP_WAIT_MS)) return;
  logger.error("Stopped CLI has not exited; keeping its run until it does", {
    provider,
  });
  if (await exitedWithin(MAX_CLI_CALL_MS)) return;
  logger.error("Stopped CLI never exited; freeing its run anyway", {
    provider,
  });
}

function waitUnlessAborted(
  promise: Promise<void>,
  abortSignal: AbortSignal | undefined,
): Promise<void> {
  if (!abortSignal) return promise;
  if (abortSignal.aborted) return Promise.reject(abortSignal.reason);

  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortSignal.reason);
    abortSignal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      () => {
        abortSignal.removeEventListener("abort", onAbort);
        resolve();
      },
      (error) => {
        abortSignal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}
