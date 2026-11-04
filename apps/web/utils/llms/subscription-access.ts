import { env } from "@/env";
import { SafeError } from "@/utils/error";
import { CLI_SUBSCRIPTION_PROVIDERS } from "@/utils/llms/subscription-config";
import { createScopedLogger } from "@/utils/logger";
import prisma from "@/utils/prisma";

// Which login a CLI model runs with. Without a scope the CLI uses the
// server's own login. With one, it uses the user's connected subscription and
// falls back to the server's login only when `allowServerLogin` is set.
export type CliLoginScope = { userId: string; allowServerLogin: boolean };

export type UserCliLogin = {
  userId: string;
  provider: string;
  credential: string;
  connectedAt: Date;
};

const logger = createScopedLogger("llms/cli-provider");

export const CONNECT_SUBSCRIPTION_MESSAGE =
  "Connect your ChatGPT or Claude account in Settings to use the AI assistant.";
export const RECONNECT_SUBSCRIPTION_MESSAGE =
  "Your connected ChatGPT or Claude account was signed out. Reconnect it in Settings to use the AI assistant.";

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
