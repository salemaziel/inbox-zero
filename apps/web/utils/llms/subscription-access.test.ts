import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/__mocks__/prisma";
import type { SelectModel } from "@/utils/llms/model";
import {
  countOwnSubscriptionAsOwnKey,
  getCliLoginScope,
  isCliLlmSharedUser,
  SHARED_DAILY_LIMIT_MESSAGE,
} from "./subscription-access";

const { mockEnv, redisMock } = vi.hoisted(() => ({
  mockEnv: {
    CLI_LLM_OWNER_EMAILS: "owner@example.com" as string | undefined,
    CLI_LLM_SHARED_EMAILS: "friend@example.com" as string | undefined,
    CLI_LLM_SHARED_DAILY_LIMIT: 2,
  },
  redisMock: { incr: vi.fn(), expire: vi.fn(), get: vi.fn() },
}));

vi.mock("@/utils/prisma");
vi.mock("@/env", () => ({ env: mockEnv }));
vi.mock("@/utils/redis", () => ({ redis: redisMock }));

const friend = {
  id: "user-friend",
  email: "Friend@example.com",
  emailVerified: true,
};

describe("isCliLlmSharedUser", () => {
  it("accepts a verified address on the shared list", () => {
    expect(isCliLlmSharedUser(friend)).toBe(true);
  });

  it("rejects an unverified address", () => {
    expect(isCliLlmSharedUser({ ...friend, emailVerified: false })).toBe(false);
  });

  it("doesn't count owners as shared users", () => {
    expect(
      isCliLlmSharedUser({ email: "owner@example.com", emailVerified: true }),
    ).toBe(false);
  });
});

describe("getCliLoginScope", () => {
  it("gives shared users the server's login only once they pick a subscription", () => {
    expect(getCliLoginScope({ ...friend, aiProvider: "DEFAULT" })).toEqual({
      userId: friend.id,
      allowServerLogin: false,
    });
    expect(getCliLoginScope({ ...friend, aiProvider: "claude-code" })).toEqual({
      userId: friend.id,
      allowServerLogin: true,
      sharedDailyLimit: 2,
    });
  });

  it("gives owners the server's login without a limit", () => {
    expect(
      getCliLoginScope({
        id: "owner",
        email: "owner@example.com",
        emailVerified: true,
        aiProvider: null,
      }),
    ).toEqual({ userId: "owner", allowServerLogin: true });
  });
});

describe("countOwnSubscriptionAsOwnKey with a shared daily limit", () => {
  const modelOptions = {
    provider: "claude-code",
    cliLogin: {
      userId: friend.id,
      allowServerLogin: true,
      sharedDailyLimit: 2,
    },
    hasUserApiKey: false,
  } as unknown as SelectModel;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.aiSubscriptionLogin.findUnique.mockResolvedValue(null);
  });

  it("lets calls on the server's login through up to the limit", async () => {
    redisMock.incr.mockResolvedValue(2);
    await expect(countOwnSubscriptionAsOwnKey(modelOptions)).resolves.toBe(
      modelOptions,
    );
  });

  it("stops calls past the limit", async () => {
    redisMock.incr.mockResolvedValue(3);
    await expect(countOwnSubscriptionAsOwnKey(modelOptions)).rejects.toThrow(
      SHARED_DAILY_LIMIT_MESSAGE,
    );
  });

  it("doesn't count calls on the user's own login", async () => {
    prisma.aiSubscriptionLogin.findUnique.mockResolvedValue({
      status: "connected",
      credential: "encrypted",
    } as never);
    await countOwnSubscriptionAsOwnKey(modelOptions);
    expect(redisMock.incr).not.toHaveBeenCalled();
  });
});
