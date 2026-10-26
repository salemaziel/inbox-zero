import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import { env } from "@/env";
import { SafeError } from "@/utils/error";
import { Provider } from "@/utils/llms/config";
import { createScopedLogger } from "@/utils/logger";
import prisma from "@/utils/prisma";

type CliProvider = string;

type CliProviderModule = Record<string, unknown>;

type CliModelFactory = (
  modelName: string,
  settings?: Record<string, unknown>,
) => LanguageModelV4;

type McpBridgedTool = {
  description?: string;
  inputSchema: unknown;
  execute?: (input: never, options?: unknown) => unknown;
};

type McpBridgeFactory = (
  name: string,
  tools: Record<string, McpBridgedTool>,
) => unknown;

// Which login a CLI model runs with. Without a scope the CLI uses the
// server's own login. With one, it uses the user's connected subscription and
// falls back to the server's login only when `allowServerLogin` is set.
export type CliLoginScope = { userId: string; allowServerLogin: boolean };

type UserCliLogin = {
  userId: string;
  provider: CliProvider;
  credential: string;
  connectedAt: Date;
};

// The working folder and env one CLI call runs with.
type CliRunSettings = { cwd: string; env?: Record<string, string> };

type CliRun = CliRunSettings & { finish: () => Promise<void> };

type BuildCliModel = (
  module: CliProviderModule,
  run: CliRunSettings,
) => LanguageModelV4;

const runtimeImport = (specifier: string): Promise<CliProviderModule> =>
  import(/* webpackIgnore: true */ specifier);

const logger = createScopedLogger("llms/cli-provider");

const CLAUDE_CODE_PACKAGE = "ai-sdk-provider-claude-code";
const CODEX_CLI_PACKAGE = "ai-sdk-provider-codex-cli";
const CLAUDE_CODE_MCP_SERVER_NAME = "inboxzero";
const CODEX_CONFIG_TOML = 'cli_auth_credentials_store = "file"\n';

// Host variables a Codex run may inherit. ai-sdk-provider-codex-cli spreads
// the whole server env into the child, so every other key is blanked.
const CODEX_SAFE_ENV_RE =
  /^(?:PATH|HOME|USER|LOGNAME|SHELL|LANG|LANGUAGE|LC_[A-Z_]+|TZ|TMPDIR|TERM|(?:HTTPS?|NO|ALL)_PROXY|(?:https?|no|all)_proxy|SSL_CERT_FILE|SSL_CERT_DIR|NODE_EXTRA_CA_CERTS|CODEX_CA_CERTIFICATE|RUST_LOG)$/;
// The server's own Codex login, kept only for runs that use it.
const CODEX_SERVER_LOGIN_ENV = [
  "CODEX_HOME",
  "OPENAI_API_KEY",
  "CODEX_API_KEY",
];

export const CLI_SUBSCRIPTION_PROVIDERS = [
  Provider.CLAUDE_CODE,
  Provider.CODEX_CLI,
] as const;

export const CONNECT_SUBSCRIPTION_MESSAGE =
  "Connect your ChatGPT or Claude account in Settings to use the AI assistant.";
export const RECONNECT_SUBSCRIPTION_MESSAGE =
  "Your connected ChatGPT or Claude account was signed out. Reconnect it in Settings to use the AI assistant.";

// Concurrent Codex runs for one user would race on its rotating refresh token.
const codexRunQueues = new Map<string, Promise<void>>();

export function assertCliLlmEnabled(provider: CliProvider) {
  if (env.CLI_LLM_ENABLED) return;

  throw new SafeError(
    `CLI LLM provider "${provider}" is disabled. Set CLI_LLM_ENABLED=true and install the matching community provider package to use it.`,
  );
}

export function isCliSubscriptionProvider(
  provider: string | null | undefined,
): boolean {
  return CLI_SUBSCRIPTION_PROVIDERS.some((value) => value === provider);
}

// Who may use the server's own CLI login. Unset: everyone, so single-user
// installs keep working. Set but empty: nobody. "*": everyone. Otherwise only
// the listed addresses, and only once the address is verified, since some
// sign-in providers let a user claim any email.
export function isCliLlmOwner(user: {
  email: string | null | undefined;
  emailVerified: boolean | null | undefined;
}): boolean {
  const raw = env.CLI_LLM_OWNER_EMAILS;
  if (raw === undefined) return true;

  const owners = raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (owners.includes("*")) return true;
  if (!user.email || user.emailVerified !== true) return false;
  return owners.includes(user.email.trim().toLowerCase());
}

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

// The Codex child env. Without `codexHome` the run uses the server's own
// login; with it, the user's login in that folder and no host credentials.
export function buildCodexEnv(
  user: { codexHome: string; home: string } | null,
): Record<string, string> {
  const childEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    const keep =
      CODEX_SAFE_ENV_RE.test(key) ||
      (!user && CODEX_SERVER_LOGIN_ENV.includes(key));
    childEnv[key] = keep ? (value ?? "") : "";
  }
  if (!user) return childEnv;

  return {
    ...childEnv,
    HOME: user.home,
    CODEX_HOME: user.codexHome,
    OPENAI_API_KEY: "",
    CODEX_API_KEY: "",
  };
}

export function createCliLanguageModel({
  provider,
  modelName,
  cliLogin,
}: {
  provider: CliProvider;
  modelName: string;
  cliLogin?: CliLoginScope;
}): LanguageModelV4 {
  assertCliLlmEnabled(provider);

  switch (provider) {
    case Provider.CODEX_CLI:
      return createCliRunModel({
        provider,
        modelName,
        cliLogin,
        buildModel: (module, run) =>
          getFactory(
            module,
            "codexExec",
            provider,
          )(modelName, {
            allowNpx: env.CODEX_CLI_ALLOW_NPX,
            skipGitRepoCheck: true,
            approvalMode: "never",
            sandboxMode: "read-only",
            ...(env.CODEX_CLI_PATH ? { codexPath: env.CODEX_CLI_PATH } : {}),
            cwd: run.cwd,
            env: run.env,
            logger: false,
          }),
      });
    case Provider.CLAUDE_CODE:
      return createCliRunModel({
        provider,
        modelName,
        cliLogin,
        buildModel: (module, run) =>
          getFactory(
            module,
            "claudeCode",
            provider,
          )(modelName, {
            ...claudeCodeRunSettings(run),
            allowedTools: [],
          }),
      });
    default:
      throw new SafeError(`Unsupported CLI LLM provider: ${provider}`);
  }
}

// AI SDK tools cannot be auto-bridged at the LanguageModelV4 layer: by the
// time the wrapper sees them they have been reduced to JSON schemas with no
// `execute`. Callers that pass tools must therefore use this helper, which
// wires the original tool record through `createAiSdkMcpServer` so the
// Claude Code CLI can invoke them locally over MCP.
export async function createClaudeCodeLanguageModelWithBridgedTools({
  modelName,
  tools,
  cliLogin,
}: {
  modelName: string;
  tools: Record<string, McpBridgedTool>;
  cliLogin?: CliLoginScope;
}): Promise<LanguageModelV4> {
  assertCliLlmEnabled(Provider.CLAUDE_CODE);

  const toolNames = Object.keys(tools);
  if (toolNames.length === 0) {
    return createCliLanguageModel({
      provider: Provider.CLAUDE_CODE,
      modelName,
      cliLogin,
    });
  }

  const allowedTools = toolNames.map((name) => prefixToolName(name));

  return createCliRunModel({
    provider: Provider.CLAUDE_CODE,
    modelName,
    cliLogin,
    buildModel: (module, run) => {
      const claudeCode = getFactory(module, "claudeCode", Provider.CLAUDE_CODE);
      const createBridge = getFactory(
        module,
        "createAiSdkMcpServer",
        Provider.CLAUDE_CODE,
      ) as McpBridgeFactory;
      const mcpServer = createBridge(CLAUDE_CODE_MCP_SERVER_NAME, tools);

      return wrapWithUnprefixedToolNames(
        claudeCode(modelName, {
          ...claudeCodeRunSettings(run),
          allowedTools,
          mcpServers: { [CLAUDE_CODE_MCP_SERVER_NAME]: mcpServer },
        }),
      );
    },
  });
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

const TOOL_NAME_PREFIX = `mcp__${CLAUDE_CODE_MCP_SERVER_NAME}__`;

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
// stripped from every `toolName` field in both the non-streaming and
// streaming response paths before it reaches the AI SDK consumer.
function wrapWithUnprefixedToolNames(model: LanguageModelV4): LanguageModelV4 {
  const wrapped = {
    specificationVersion: model.specificationVersion,
    provider: model.provider,
    modelId: model.modelId,
    supportedUrls: model.supportedUrls,
    async doGenerate(...args: unknown[]) {
      const doGenerate = getModelMethod(
        model,
        "doGenerate",
        Provider.CLAUDE_CODE,
      );
      const result = (await doGenerate(...args)) as {
        content?: unknown[];
      } & Record<string, unknown>;
      return {
        ...result,
        ...(Array.isArray(result.content)
          ? { content: result.content.map(unprefixPart) }
          : {}),
      };
    },
    async doStream(...args: unknown[]) {
      const doStream = getModelMethod(model, "doStream", Provider.CLAUDE_CODE);
      const result = (await doStream(...args)) as {
        stream: ReadableStream<unknown>;
      } & Record<string, unknown>;
      const stream = result.stream.pipeThrough(
        new TransformStream({
          transform(chunk, controller) {
            controller.enqueue(unprefixPart(chunk));
          },
        }),
      );
      return { ...result, stream };
    },
  };
  return wrapped as unknown as LanguageModelV4;
}

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
  buildModel,
}: {
  provider: CliProvider;
  modelName: string;
  cliLogin?: CliLoginScope;
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

  const startCall = async () => {
    const module = await getModule();
    const release =
      provider === Provider.CODEX_CLI && cliLogin
        ? await acquireCodexRun(cliLogin.userId)
        : () => {};

    let run: CliRun | undefined;
    try {
      const login = await resolveUserCliLogin(provider, cliLogin);
      if (!login) release();
      run = await startCliRun(provider, login);
      const model = buildModel(module, run);

      let ended = false;
      const end = async () => {
        if (ended) return;
        ended = true;
        await run?.finish();
        release();
      };

      const handleError = async (error: unknown): Promise<never> => {
        if (login && isCliAuthenticationError(module, error)) {
          await markNeedsReconnect(login);
          throw new SafeError(RECONNECT_SUBSCRIPTION_MESSAGE);
        }
        throw error;
      };

      return { model, end, handleError };
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
      const call = await startCall();
      try {
        const doGenerate = getModelMethod(call.model, "doGenerate", provider);
        return await doGenerate(...args);
      } catch (error) {
        return await call.handleError(error);
      } finally {
        await call.end();
      }
    },
    async doStream(...args: unknown[]) {
      const call = await startCall();
      let result: { stream: ReadableStream<unknown> } & Record<string, unknown>;
      try {
        const doStream = getModelMethod(call.model, "doStream", provider);
        result = (await doStream(...args)) as typeof result;
      } catch (error) {
        await call.end();
        return call.handleError(error);
      }
      // The CLI keeps running while the stream is read, so its folder and the
      // Codex run slot are kept until the stream ends.
      const stream = result.stream.pipeThrough(
        new TransformStream({
          flush: call.end,
          cancel: call.end,
        } as Transformer<unknown, unknown>),
      );
      return { ...result, stream };
    },
  } as unknown as LanguageModelV4;
}

// A fresh 0700 folder per call: an empty working directory, plus the user's
// Claude config dir or Codex home. Codex rotates its refresh token, so a
// changed auth.json is saved back before the folder is deleted.
async function startCliRun(
  provider: CliProvider,
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
      if (!login) {
        return { cwd, env: buildCodexEnv(null), finish: removeRunDir };
      }
      const codexHome = path.join(runDir, "codex");
      await mkdir(codexHome, { mode: 0o700 });
      await writeCodexHome(codexHome, login.credential);
      return {
        cwd,
        env: buildCodexEnv({ codexHome, home: runDir }),
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

// Returns null when the CLI should run with the server's own login.
async function resolveUserCliLogin(
  provider: CliProvider,
  cliLogin: CliLoginScope | undefined,
): Promise<UserCliLogin | null> {
  if (!cliLogin) return null;
  const { userId, allowServerLogin } = cliLogin;

  const login = await prisma.aiSubscriptionLogin.findUnique({
    where: { userId_provider: { userId, provider } },
    select: { status: true, credential: true, connectedAt: true },
  });

  if (login?.status === "connected" && login.credential) {
    logger.info("Using user CLI subscription login", {
      provider,
      userLogin: true,
    });
    return {
      userId,
      provider,
      credential: login.credential,
      connectedAt: login.connectedAt,
    };
  }

  if (allowServerLogin) return null;

  throw new SafeError(
    login ? RECONNECT_SUBSCRIPTION_MESSAGE : CONNECT_SUBSCRIPTION_MESSAGE,
  );
}

async function markNeedsReconnect(login: UserCliLogin) {
  await prisma.aiSubscriptionLogin.updateMany({
    where: { userId: login.userId, provider: login.provider },
    data: {
      status: "needs-reconnect",
      lastError: "The sign-in was rejected or has expired.",
    },
  });
}

function isCliAuthenticationError(
  module: CliProviderModule,
  error: unknown,
): boolean {
  const isAuthenticationError = module.isAuthenticationError;
  return (
    typeof isAuthenticationError === "function" &&
    !!isAuthenticationError(error)
  );
}

async function acquireCodexRun(userId: string): Promise<() => void> {
  const previous = codexRunQueues.get(userId) ?? Promise.resolve();
  let releaseCurrent = () => {};
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  const tail = previous.then(() => current);
  codexRunQueues.set(userId, tail);
  await previous;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    releaseCurrent();
    if (codexRunQueues.get(userId) === tail) codexRunQueues.delete(userId);
  };
}

async function importOptionalProviderPackage(
  packageName: string,
  provider: CliProvider,
) {
  try {
    return await runtimeImport(packageName);
  } catch (error) {
    const message = isMissingOptionalPackageError(error, packageName)
      ? `CLI LLM provider "${provider}" requires optional package "${packageName}". Install it in apps/web and pin an exact version before enabling this provider.`
      : `CLI LLM provider "${provider}" failed to load optional package "${packageName}". Check the installed package version and peer dependencies.`;
    const safeError = new SafeError(message);
    (safeError as Error & { cause?: unknown }).cause = error;
    throw safeError;
  }
}

function getFactory(
  module: CliProviderModule,
  exportName: string,
  provider: CliProvider,
): CliModelFactory {
  const factory = module[exportName];

  if (typeof factory !== "function") {
    throw new SafeError(
      `CLI LLM provider "${provider}" package does not export "${exportName}". Check the installed package version.`,
    );
  }

  return factory as CliModelFactory;
}

function getModelMethod(
  model: LanguageModelV4,
  methodName: "doGenerate" | "doStream",
  provider: CliProvider,
) {
  const method = model[methodName];

  if (typeof method !== "function") {
    throw new SafeError(
      `CLI LLM provider "${provider}" returned a model without ${methodName}. Check the installed package version.`,
    );
  }

  return method.bind(model) as (...args: unknown[]) => unknown;
}

function isMissingOptionalPackageError(error: unknown, packageName: string) {
  if (!(error instanceof Error)) return false;

  const code = (error as Error & { code?: string }).code;
  return code === "ERR_MODULE_NOT_FOUND" && error.message.includes(packageName);
}
