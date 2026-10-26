import { randomUUID } from "node:crypto";
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
import { asSchema } from "ai";
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

type BuiltCliModel = {
  model: LanguageModelV4;
  // Rewrites each response part before the caller sees it.
  mapPart?: (part: unknown) => unknown;
  // Runs once the CLI has exited.
  close?: () => Promise<void>;
};

type BuildCliModel = (
  module: CliProviderModule,
  run: CliRunSettings,
) => BuiltCliModel | Promise<BuiltCliModel>;

// The tools served to Codex over the bridge, as the local MCP server in
// ai-sdk-provider-codex-cli expects them.
type CodexMcpTool = {
  name: string;
  description?: string;
  inputSchema: unknown;
  execute: (input: unknown) => Promise<unknown>;
};

type CodexMcpServerFactory = (options: {
  name: string;
  tools: CodexMcpTool[];
}) => Promise<{
  config: { transport: "http"; url: string; bearerToken: string };
  stop: () => Promise<void>;
}>;

const runtimeImport = (specifier: string): Promise<CliProviderModule> =>
  import(/* webpackIgnore: true */ specifier);

const logger = createScopedLogger("llms/cli-provider");

const CLAUDE_CODE_PACKAGE = "ai-sdk-provider-claude-code";
const CODEX_CLI_PACKAGE = "ai-sdk-provider-codex-cli";
// The MCP server that serves Inbox Zero's own tools to a CLI run.
const CLI_TOOLS_MCP_SERVER_NAME = "inboxzero";
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
const CODEX_AUTH_FAILURE_RE =
  /\b401\b|unauthorized|not logged in|refresh token|log in again|sign in again/i;
// The server's own Codex login, kept only for runs that use it.
const CODEX_SERVER_LOGIN_ENV = ["OPENAI_API_KEY", "CODEX_API_KEY"];

export const CLI_SUBSCRIPTION_PROVIDERS = [
  Provider.CLAUDE_CODE,
  Provider.CODEX_CLI,
] as const;

export const CONNECT_SUBSCRIPTION_MESSAGE =
  "Connect your ChatGPT or Claude account in Settings to use the AI assistant.";
export const RECONNECT_SUBSCRIPTION_MESSAGE =
  "Your connected ChatGPT or Claude account was signed out. Reconnect it in Settings to use the AI assistant.";
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

// A call still running after this long (for example a stream nobody reads or
// cancels) is stopped, and its run slot and folder are freed.
export const MAX_CLI_CALL_MS = 20 * 60 * 1000;
// How long a stopped CLI gets to exit before its folder is removed anyway.
export const CLI_STOP_WAIT_MS = 10 * 1000;

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

// Who may use the server's own CLI login. Only users with a verified address,
// since some sign-in providers let a user claim any email. Among those, unset:
// everyone, so single-user installs keep working. Set but empty: nobody.
// "*": everyone. Otherwise only the listed addresses.
export function isCliLlmOwner(user: {
  email: string | null | undefined;
  emailVerified: boolean | null | undefined;
}): boolean {
  if (!user.email || user.emailVerified !== true) return false;

  const raw = env.CLI_LLM_OWNER_EMAILS;
  if (raw === undefined) return true;

  const owners = raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (owners.includes("*")) return true;
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
        buildModel: (module, run) => ({
          model: getFactory(
            module,
            "codexExec",
            provider,
          )(modelName, codexRunSettings(run)),
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
export async function createCliLanguageModelWithBridgedTools({
  provider,
  modelName,
  tools,
  cliLogin,
}: {
  provider: CliProvider;
  modelName: string;
  tools: Record<string, McpBridgedTool>;
  cliLogin?: CliLoginScope;
}): Promise<LanguageModelV4> {
  assertCliLlmEnabled(provider);

  const toolNames = Object.keys(tools);
  if (toolNames.length === 0) {
    return createCliLanguageModel({ provider, modelName, cliLogin });
  }

  switch (provider) {
    case Provider.CODEX_CLI:
      return createCliRunModel({
        provider,
        modelName,
        cliLogin,
        bridgedToolNames: toolNames,
        buildModel: async (module, run) => {
          const createServer = getFactory(
            module,
            "createLocalMcpServer",
            provider,
          ) as unknown as CodexMcpServerFactory;
          const server = await createServer({
            name: CLI_TOOLS_MCP_SERVER_NAME,
            tools: await toCodexMcpTools(tools),
          });
          try {
            const model = getFactory(
              module,
              "codexExec",
              provider,
            )(modelName, {
              ...codexRunSettings(run),
              mcpServers: {
                [CLI_TOOLS_MCP_SERVER_NAME]: {
                  ...server.config,
                  enabledTools: toolNames,
                },
              },
              // Codex asks before calling an MCP tool that isn't marked
              // read-only, and with approvals off that ask is declined. Only
              // this server's tools are approved up front.
              configOverrides: {
                [`mcp_servers.${CLI_TOOLS_MCP_SERVER_NAME}.default_tools_approval_mode`]:
                  "approve",
              },
            });
            return {
              model,
              mapPart: toBridgedCodexPart,
              close: () => server.stop(),
            };
          } catch (error) {
            await server.stop();
            throw error;
          }
        },
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

// Inputs are checked against each tool's own schema before it runs, as the
// AI SDK would; the local MCP server passes arguments through unchecked.
async function toCodexMcpTools(
  tools: Record<string, McpBridgedTool>,
): Promise<CodexMcpTool[]> {
  return Promise.all(
    Object.entries(tools).map(async ([name, tool]) => {
      const execute = tool.execute;
      if (typeof execute !== "function") {
        throw new SafeError(
          `Tool "${name}" has no execute function, so it cannot be bridged to the CLI.`,
        );
      }
      const schema = asSchema(
        tool.inputSchema as Parameters<typeof asSchema>[0],
      );
      return {
        name,
        description:
          typeof tool.description === "string" ? tool.description : undefined,
        inputSchema: await schema.jsonSchema,
        execute: async (input: unknown) => {
          const parsed = schema.validate
            ? await schema.validate(input ?? {})
            : { success: true as const, value: input };
          if (!parsed.success) {
            throw new Error(
              `Invalid input for tool "${name}": ${parsed.error.message}`,
            );
          }
          return execute.call(tool, parsed.value as never, {
            toolCallId: randomUUID(),
            messages: [],
          });
        },
      };
    }),
  );
}

// Codex reports each MCP call as a provider-executed tool call whose input is
// `{server, tool, status, arguments}` and whose result wraps the MCP reply.
// For calls to the Inbox Zero server, callers get the tool's own input and
// output instead, the same shape the Claude Code bridge produces.
function toBridgedCodexPart(part: unknown): unknown {
  if (!part || typeof part !== "object") return part;
  const record = part as Record<string, unknown>;

  switch (record.type) {
    case "tool-call": {
      const call = parseCodexMcpPayload(record.input);
      if (call?.server !== CLI_TOOLS_MCP_SERVER_NAME) return part;
      return { ...record, input: JSON.stringify(call.arguments ?? {}) };
    }
    case "tool-input-delta": {
      const call = parseCodexMcpPayload(record.delta);
      if (call?.server !== CLI_TOOLS_MCP_SERVER_NAME) return part;
      return { ...record, delta: JSON.stringify(call.arguments ?? {}) };
    }
    case "tool-result": {
      const outcome = record.result as {
        server?: unknown;
        result?: { content?: unknown; isError?: unknown };
        error?: unknown;
      } | null;
      if (outcome?.server !== CLI_TOOLS_MCP_SERVER_NAME) return part;
      if (outcome.error !== undefined && outcome.error !== null) {
        return {
          ...record,
          result: describeMcpError(outcome.error),
          isError: true,
        };
      }
      return {
        ...record,
        result: parseMcpContent(outcome.result?.content) ?? "",
        ...(outcome.result?.isError === true ? { isError: true } : {}),
      };
    }
    default:
      return part;
  }
}

function parseCodexMcpPayload(
  value: unknown,
): { server?: unknown; tool?: unknown; arguments?: unknown } | null {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  return parsed && typeof parsed === "object"
    ? (parsed as { server?: unknown; tool?: unknown; arguments?: unknown })
    : null;
}

// The tool's output was sent as one JSON text block; read it back.
function parseMcpContent(content: unknown): unknown {
  if (!Array.isArray(content)) return content;
  const texts = content
    .filter(
      (block): block is { type: "text"; text: string } =>
        block?.type === "text" && typeof block.text === "string",
    )
    .map((block) => block.text);
  if (texts.length !== content.length) return content;
  const text = texts.join("\n");
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function describeMcpError(error: unknown): string {
  if (typeof error === "string") return error;
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" ? message : JSON.stringify(error);
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
  provider: CliProvider;
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
      const {
        model,
        mapPart = (part: unknown) => part,
        close,
      } = await buildModel(module, run);

      // Both providers stop their CLI process when this signal aborts.
      const stopController = new AbortController();
      const abortSignal = callerSignal
        ? AbortSignal.any([callerSignal, stopController.signal])
        : stopController.signal;

      let ending: Promise<void> | undefined;
      const end = () => {
        ending ??= (async () => {
          clearTimeout(maxCallTimer);
          if (close) {
            await Promise.race([
              close().catch(() => {
                logger.warn("Could not stop the CLI tool server", { provider });
              }),
              sleep(CLI_STOP_WAIT_MS),
            ]);
          }
          await run?.finish();
          release();
        })();
        return ending;
      };

      const call = {
        model,
        options: { ...(options as object), abortSignal },
        // Settles once the CLI process has exited.
        exited: Promise.resolve() as Promise<unknown>,
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
        // exited, or after a bounded wait if it ignores the abort.
        stop: async (reason: unknown) => {
          stopController.abort(reason);
          await Promise.race([call.exited, sleep(CLI_STOP_WAIT_MS)]);
          await end();
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
        const pending = Promise.resolve(
          doGenerate(call.options, ...args.slice(1)),
        );
        call.exited = pending.catch(() => undefined);
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
        result = (await doStream(
          call.options,
          ...args.slice(1),
        )) as typeof result;
      } catch (error) {
        await call.end();
        return call.handleError(error);
      }
      // The CLI keeps running while the stream is read, so its folder and the
      // Codex run slot are kept until the stream ends. The source stream ends
      // when the CLI exits, whether or not anyone is reading it. Both
      // providers report a rejected login inside the stream (an error part,
      // or by erroring the stream), not from doStream itself.
      const reader = result.stream.getReader();
      call.exited = reader.closed.catch(() => undefined);
      const stream = new ReadableStream({
        async pull(controller) {
          let next: ReadableStreamReadResult<unknown>;
          try {
            next = await reader.read();
          } catch (error) {
            const rejected = await call.checkLoginRejected(error);
            await call.end();
            controller.error(rejected ?? error);
            return;
          }
          if (next.done) {
            await call.end();
            controller.close();
            return;
          }
          const blockedTool = call.findBlockedTool(next.value);
          if (blockedTool) {
            const error = blockedToolError(provider, blockedTool);
            await call.stop(error);
            await reader.cancel(error).catch(() => undefined);
            controller.error(error);
            return;
          }
          const part = next.value as { type?: string; error?: unknown };
          const rejected =
            part?.type === "error"
              ? await call.checkLoginRejected(part.error)
              : null;
          controller.enqueue(
            rejected ? { ...part, error: rejected } : call.mapPart(part),
          );
        },
        async cancel(reason: unknown) {
          await call.stop(reason);
          await reader.cancel(reason).catch(() => undefined);
        },
      });
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

// Run before a call starts: throws the connect or reconnect prompt when the
// user's own login is required but not usable, and otherwise says whether
// the call will run on the user's own login rather than the server's.
export async function checkUserCliLogin(
  provider: CliProvider,
  { userId, allowServerLogin }: CliLoginScope,
): Promise<boolean> {
  const login = await prisma.aiSubscriptionLogin.findUnique({
    where: { userId_provider: { userId, provider } },
    select: { status: true, credential: true },
  });
  if (isUsableLogin(login)) return true;
  if (allowServerLogin) return false;
  throw missingLoginError(login);
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

  if (isUsableLogin(login)) {
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
  throw missingLoginError(login);
}

function missingLoginError(login: unknown) {
  return new SafeError(
    login ? RECONNECT_SUBSCRIPTION_MESSAGE : CONNECT_SUBSCRIPTION_MESSAGE,
  );
}

// Only the sign-in this run used: a newer sign-in in the meantime is kept.
async function markNeedsReconnect(login: UserCliLogin) {
  await prisma.aiSubscriptionLogin.updateMany({
    where: {
      userId: login.userId,
      provider: login.provider,
      status: "connected",
      connectedAt: login.connectedAt,
    },
    data: {
      status: "needs-reconnect",
      lastError: "The sign-in was rejected or has expired.",
    },
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
function blockedToolError(provider: CliProvider, toolName: string) {
  logger.warn("Stopped a CLI run that used one of its own tools", {
    provider,
    toolName,
  });
  return new SafeError(CODEX_TOOL_BLOCKED_MESSAGE);
}

function isUsableLogin<T extends { status: string; credential: string | null }>(
  login: T | null,
): login is T & { credential: string } {
  return login?.status === "connected" && !!login.credential;
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
  provider: CliProvider,
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

async function acquireCodexRun(
  userId: string,
  abortSignal: AbortSignal | undefined,
): Promise<() => void> {
  const previous = codexRunQueues.get(userId) ?? Promise.resolve();
  let releaseCurrent = () => {};
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  const tail = previous.then(() => current);
  codexRunQueues.set(userId, tail);

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    releaseCurrent();
    if (codexRunQueues.get(userId) === tail) codexRunQueues.delete(userId);
  };

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
