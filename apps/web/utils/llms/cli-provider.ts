import { mkdir } from "node:fs/promises";
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
  env: Record<string, string>;
};

type LoadedCliModel = {
  model: LanguageModelV4;
  module: CliProviderModule;
  login: UserCliLogin | null;
};

const runtimeImport = (specifier: string): Promise<CliProviderModule> =>
  import(/* webpackIgnore: true */ specifier);

const logger = createScopedLogger("llms/cli-provider");

const CLAUDE_CODE_PACKAGE = "ai-sdk-provider-claude-code";
const CODEX_CLI_PACKAGE = "ai-sdk-provider-codex-cli";
const CLAUDE_CODE_MCP_SERVER_NAME = "inboxzero";

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

// With CLI_LLM_OWNER_EMAILS unset every user may use the server's own CLI
// login, so single-user installs keep working.
export function isCliLlmOwner(email: string | null | undefined): boolean {
  const owners = env.CLI_LLM_OWNER_EMAILS?.split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (!owners?.length) return true;
  return !!email && owners.includes(email.trim().toLowerCase());
}

export function getCliUserHome(userId: string, provider: CliProvider): string {
  if (!/^[A-Za-z0-9_-]+$/.test(userId)) {
    throw new Error("Invalid user id for CLI login home");
  }
  return path.join(
    path.resolve(env.CLI_LLM_USER_HOMES_DIR),
    userId,
    provider === Provider.CODEX_CLI ? "codex" : "claude",
  );
}

// The CLI child env for a user's own login. Inherited host credentials are
// blanked so the CLI cannot silently fall back to the server's login.
export function buildUserCliEnv({
  provider,
  userId,
  credential,
}: {
  provider: CliProvider;
  userId: string;
  credential: string | null;
}): Record<string, string> {
  const home = getCliUserHome(userId, provider);

  if (provider === Provider.CODEX_CLI) {
    return { CODEX_HOME: home, OPENAI_API_KEY: "", CODEX_API_KEY: "" };
  }

  if (!credential) throw new SafeError(RECONNECT_SUBSCRIPTION_MESSAGE);

  // ai-sdk-provider-claude-code copies every ANTHROPIC_* and CLAUDE_* host
  // variable into the child env before applying these overrides.
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
    CLAUDE_CONFIG_DIR: home,
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

  let modelPromise: Promise<LanguageModelV4> | undefined;

  const getModel = () => {
    modelPromise ??= loadCliLanguageModel({
      provider,
      modelName,
      cliLogin,
    }).then(wrapWithUserLogin);
    return modelPromise;
  };

  return {
    specificationVersion: "v4",
    provider,
    modelId: modelName,
    supportedUrls: {},
    async doGenerate(...args: unknown[]) {
      const model = await getModel();
      const doGenerate = getModelMethod(model, "doGenerate", provider);
      return doGenerate(...args);
    },
    async doStream(...args: unknown[]) {
      const model = await getModel();
      const doStream = getModelMethod(model, "doStream", provider);
      return doStream(...args);
    },
  } as unknown as LanguageModelV4;
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
    return wrapWithUserLogin(
      await createClaudeCodeLanguageModel(modelName, cliLogin),
    );
  }

  const login = await resolveUserCliLogin(Provider.CLAUDE_CODE, cliLogin);
  const module = await importOptionalProviderPackage(
    CLAUDE_CODE_PACKAGE,
    Provider.CLAUDE_CODE,
  );
  const claudeCode = getFactory(module, "claudeCode", Provider.CLAUDE_CODE);
  const createBridge = getFactory(
    module,
    "createAiSdkMcpServer",
    Provider.CLAUDE_CODE,
  ) as McpBridgeFactory;

  const mcpServer = createBridge(CLAUDE_CODE_MCP_SERVER_NAME, tools);
  const allowedTools = toolNames.map((name) => prefixToolName(name));

  const inner = claudeCode(modelName, {
    settingSources: [],
    allowedTools,
    mcpServers: { [CLAUDE_CODE_MCP_SERVER_NAME]: mcpServer },
    permissionMode: "default",
    sandbox: { enabled: true },
    ...(login ? { env: login.env } : {}),
  });

  return wrapWithUserLogin({
    model: wrapWithUnprefixedToolNames(inner),
    module,
    login,
  });
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

async function loadCliLanguageModel({
  provider,
  modelName,
  cliLogin,
}: {
  provider: CliProvider;
  modelName: string;
  cliLogin?: CliLoginScope;
}): Promise<LoadedCliModel> {
  switch (provider) {
    case Provider.CODEX_CLI:
      return createCodexCliLanguageModel(modelName, cliLogin);
    case Provider.CLAUDE_CODE:
      return createClaudeCodeLanguageModel(modelName, cliLogin);
    default:
      throw new SafeError(`Unsupported CLI LLM provider: ${provider}`);
  }
}

async function createCodexCliLanguageModel(
  modelName: string,
  cliLogin: CliLoginScope | undefined,
): Promise<LoadedCliModel> {
  const login = await resolveUserCliLogin(Provider.CODEX_CLI, cliLogin);
  const module = await importOptionalProviderPackage(
    CODEX_CLI_PACKAGE,
    Provider.CODEX_CLI,
  );
  const codexExec = getFactory(module, "codexExec", Provider.CODEX_CLI);

  const model = codexExec(modelName, {
    allowNpx: env.CODEX_CLI_ALLOW_NPX,
    skipGitRepoCheck: true,
    approvalMode: "never",
    sandboxMode: "read-only",
    ...(env.CODEX_CLI_PATH ? { codexPath: env.CODEX_CLI_PATH } : {}),
    ...(login ? { env: login.env } : {}),
    logger: false,
  });

  return { model, module, login };
}

async function createClaudeCodeLanguageModel(
  modelName: string,
  cliLogin: CliLoginScope | undefined,
): Promise<LoadedCliModel> {
  const login = await resolveUserCliLogin(Provider.CLAUDE_CODE, cliLogin);
  const module = await importOptionalProviderPackage(
    CLAUDE_CODE_PACKAGE,
    Provider.CLAUDE_CODE,
  );
  const claudeCode = getFactory(module, "claudeCode", Provider.CLAUDE_CODE);

  const model = claudeCode(modelName, {
    settingSources: [],
    allowedTools: [],
    permissionMode: "default",
    sandbox: { enabled: true },
    ...(login ? { env: login.env } : {}),
  });

  return { model, module, login };
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
    select: { status: true, credential: true },
  });

  if (login?.status === "connected") {
    const home = getCliUserHome(userId, provider);
    await mkdir(home, { recursive: true, mode: 0o700 });
    logger.info("Using user CLI subscription login", {
      provider,
      userLogin: true,
    });
    return {
      userId,
      provider,
      env: buildUserCliEnv({ provider, userId, credential: login.credential }),
    };
  }

  if (allowServerLogin) return null;

  throw new SafeError(
    login ? RECONNECT_SUBSCRIPTION_MESSAGE : CONNECT_SUBSCRIPTION_MESSAGE,
  );
}

// For a user's own login: serializes Codex runs per user and turns a rejected
// login into a reconnect prompt. Server-login models pass through unchanged.
function wrapWithUserLogin({
  model,
  module,
  login,
}: LoadedCliModel): LanguageModelV4 {
  if (!login) return model;

  const { provider } = login;
  const isAuthenticationError = module.isAuthenticationError;

  const handleError = async (error: unknown): Promise<never> => {
    if (
      typeof isAuthenticationError === "function" &&
      isAuthenticationError(error)
    ) {
      await prisma.aiSubscriptionLogin.updateMany({
        where: { userId: login.userId, provider },
        data: {
          status: "needs-reconnect",
          lastError: "The sign-in was rejected or has expired.",
        },
      });
      throw new SafeError(RECONNECT_SUBSCRIPTION_MESSAGE);
    }
    throw error;
  };

  const acquire = (): Promise<() => void> =>
    provider === Provider.CODEX_CLI
      ? acquireCodexRun(login.userId)
      : Promise.resolve(() => {});

  return {
    specificationVersion: model.specificationVersion,
    provider: model.provider,
    modelId: model.modelId,
    supportedUrls: model.supportedUrls,
    async doGenerate(...args: unknown[]) {
      const doGenerate = getModelMethod(model, "doGenerate", provider);
      const release = await acquire();
      try {
        return await doGenerate(...args);
      } catch (error) {
        return handleError(error);
      } finally {
        release();
      }
    },
    async doStream(...args: unknown[]) {
      const doStream = getModelMethod(model, "doStream", provider);
      const release = await acquire();
      let result: { stream: ReadableStream<unknown> } & Record<string, unknown>;
      try {
        result = (await doStream(...args)) as typeof result;
      } catch (error) {
        release();
        return handleError(error);
      }
      // The CLI keeps running while the stream is read, so the Codex run slot
      // is held until the stream ends.
      const stream = result.stream.pipeThrough(
        new TransformStream({
          flush: release,
          cancel: release,
        } as Transformer<unknown, unknown>),
      );
      return { ...result, stream };
    },
  } as unknown as LanguageModelV4;
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
