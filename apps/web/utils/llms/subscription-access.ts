import { env } from "@/env";
import { SafeError } from "@/utils/error";
import type { SelectModel } from "@/utils/llms/model";
import { createScopedLogger } from "@/utils/logger";
import prisma from "@/utils/prisma";
import { redis } from "@/utils/redis";
import { isSubscriptionProvider } from "@/utils/llms/subscription-config";

// Which login a CLI model runs with. Without a scope the CLI uses the
// server's own login. With one, it uses the user's connected subscription and
// falls back to the server's login only when `allowServerLogin` is set.
// `sharedDailyLimit` caps how many calls a day may use the server's login.
export type CliLoginScope = {
  userId: string;
  allowServerLogin: boolean;
  sharedDailyLimit?: number;
};

export type UserCliLogin = {
  userId: string;
  provider: string;
  credential: string;
  connectedAt: Date;
};

const logger = createScopedLogger("llms/cli-provider");
const SHARED_USAGE_TTL_SECONDS = 2 * 24 * 60 * 60;

export const CONNECT_SUBSCRIPTION_MESSAGE =
  "Connect your ChatGPT or Claude account in Settings to use the AI assistant.";
export const SHARED_DAILY_LIMIT_MESSAGE =
  "You've used today's shared AI requests. Connect your own Claude or ChatGPT account in Settings, or try again tomorrow.";
export const RECONNECT_SUBSCRIPTION_MESSAGE =
  "Your connected ChatGPT or Claude account was signed out. Reconnect it in Settings to use the AI assistant.";

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

  const owners = parseEmailList(raw);
  if (owners.includes("*")) return true;
  return owners.includes(user.email.trim().toLowerCase());
}

// Users approved to share the server's CLI login, up to a daily limit, when
// they have no subscription of their own. Owners aren't limited, so they're
// never counted here.
export function isCliLlmSharedUser(user: {
  email: string | null | undefined;
  emailVerified: boolean | null | undefined;
}): boolean {
  if (!user.email || user.emailVerified !== true) return false;
  if (isCliLlmOwner(user)) return false;
  return parseEmailList(env.CLI_LLM_SHARED_EMAILS ?? "").includes(
    user.email.trim().toLowerCase(),
  );
}

// Owners always fall back to the server's login. Shared users do only once
// they've picked a subscription provider, and then within their daily limit.
export function getCliLoginScope(user: {
  id: string;
  email: string | null | undefined;
  emailVerified: boolean | null | undefined;
  aiProvider: string | null | undefined;
}): CliLoginScope {
  if (isCliLlmOwner(user)) return { userId: user.id, allowServerLogin: true };
  if (isSubscriptionProvider(user.aiProvider) && isCliLlmSharedUser(user)) {
    return {
      userId: user.id,
      allowServerLogin: true,
      sharedDailyLimit: env.CLI_LLM_SHARED_DAILY_LIMIT,
    };
  }
  return { userId: user.id, allowServerLogin: false };
}

export async function getSharedRequestsUsedToday(userId: string) {
  return Number((await redis.get(getSharedUsageKey(userId))) ?? 0);
}

// Run before a call starts: throws the connect or reconnect prompt when the
// user's own login is required but not usable, and otherwise says whether
// the call will run on the user's own login rather than the server's.
export async function checkUserCliLogin(
  provider: string,
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

// Checked before the call starts, so a missing login fails up front with
// the connect prompt, and so spend guards know whether an owner's
// subscription runs on their own login (getModel can't tell).
export async function countOwnSubscriptionAsOwnKey(
  modelOptions: SelectModel,
): Promise<SelectModel> {
  const usesOwnCliLogin = modelOptions.cliLogin
    ? await checkUserCliLogin(modelOptions.provider, modelOptions.cliLogin)
    : false;
  if (modelOptions.cliLogin && !usesOwnCliLogin) {
    await countSharedServerRequest(modelOptions.cliLogin);
  }
  return usesOwnCliLogin && !modelOptions.hasUserApiKey
    ? { ...modelOptions, hasUserApiKey: true }
    : modelOptions;
}

// Returns null when the CLI should run with the server's own login.
export async function resolveUserCliLogin(
  provider: string,
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

// Only the sign-in this run used: a newer sign-in in the meantime is kept.
export async function markNeedsReconnect(login: UserCliLogin) {
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

export function isUsableLogin<
  T extends { status: string; credential: string | null },
>(login: T | null): login is T & { credential: string } {
  return login?.status === "connected" && !!login.credential;
}

function missingLoginError(login: unknown) {
  return new SafeError(
    login ? RECONNECT_SUBSCRIPTION_MESSAGE : CONNECT_SUBSCRIPTION_MESSAGE,
  );
}

// Counted before the call starts, so a call that fails still counts: the
// limit is about how often the server's login is used, not how often it works.
async function countSharedServerRequest(cliLogin: CliLoginScope) {
  if (!cliLogin.sharedDailyLimit) return;
  const key = getSharedUsageKey(cliLogin.userId);
  const used = Number(await redis.incr(key));
  if (used === 1) await redis.expire(key, SHARED_USAGE_TTL_SECONDS);
  if (used > cliLogin.sharedDailyLimit) {
    throw new SafeError(SHARED_DAILY_LIMIT_MESSAGE);
  }
}

function getSharedUsageKey(userId: string) {
  return `cli-shared-usage:${userId}:${new Date().toISOString().slice(0, 10)}`;
}

function parseEmailList(raw: string) {
  return raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}
