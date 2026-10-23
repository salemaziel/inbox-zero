import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/__mocks__/prisma";
import {
  createFixtureExecutor,
  FIXTURE_NATIVE,
  FIXTURE_REDIRECT,
} from "@/__tests__/fixtures/integrations/fixture-integration";
import {
  completeTokenRedirect,
  connectWithToken,
  createTokenRedirect,
} from "@/utils/integrations/connection.server";
import { IntegrationError } from "@/utils/integrations/types";
import { createScopedLogger } from "@/utils/logger";
import { generateSignedOAuthState } from "@/utils/oauth/state";

const { mockGetNativeExecutor } = vi.hoisted(() => ({
  mockGetNativeExecutor: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/utils/prisma");
vi.mock("@/utils/integrations/executors.server", () => ({
  getNativeExecutor: mockGetNativeExecutor,
}));
vi.mock("@/utils/mcp/integrations", async () => {
  const { FIXTURE_NATIVE, FIXTURE_REDIRECT, FIXTURE_MCP } =
    await vi.importActual<
      typeof import("@/__tests__/fixtures/integrations/fixture-integration")
    >("@/__tests__/fixtures/integrations/fixture-integration");
  const registry = {
    [FIXTURE_NATIVE.name]: FIXTURE_NATIVE,
    [FIXTURE_REDIRECT.name]: FIXTURE_REDIRECT,
    [FIXTURE_MCP.name]: FIXTURE_MCP,
  };
  return {
    findIntegration: (name: string) =>
      Object.hasOwn(registry, name) ? registry[name] : undefined,
  };
});

const logger = createScopedLogger("connection-server-test");
const TOKEN_ERROR = "That token didn't work. Check it and try again.";
const KIND_ERROR = "This integration can't be connected with a token.";
const STATE_ERROR =
  "This connection link expired or doesn't match. Start again from the Integrations page.";

let fixture: ReturnType<typeof createFixtureExecutor>;

describe("connectWithToken", () => {
  beforeEach(() => {
    setUp();
  });

  it("tests the trimmed token and stores it on the connection", async () => {
    await connectWithToken({
      ...pasteOptions(),
      token: "  \n secret-token\t ",
    });

    expect(fixture.calls).toHaveLength(1);
    expect(fixture.calls[0]).toMatchObject({
      method: "testConnection",
      conn: { accessToken: "secret-token" },
    });
    expect(prisma.mcpIntegration.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { name: FIXTURE_NATIVE.name },
        create: { name: FIXTURE_NATIVE.name },
      }),
    );
    expect(prisma.mcpConnection.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          emailAccountId_integrationId: {
            emailAccountId: "account-1",
            integrationId: "integration-1",
          },
        },
        update: { accessToken: "secret-token", isActive: true },
        create: {
          name: FIXTURE_NATIVE.displayName,
          emailAccountId: "account-1",
          integrationId: "integration-1",
          accessToken: "secret-token",
          isActive: true,
        },
      }),
    );
  });

  it("refuses a user below the required tier and writes nothing", async () => {
    prisma.user.findUnique.mockResolvedValue({ premium: null } as never);

    await expect(connectWithToken(pasteOptions())).rejects.toThrow(
      "Integrations require a Plus plan",
    );
    expect(fixture.calls).toHaveLength(0);
    expectNothingWritten();
  });

  it("refuses a token the app rejects and writes nothing", async () => {
    fixture.enqueue(
      "testConnection",
      new IntegrationError({ kind: "auth", providerMessage: "bad token" }),
    );

    await expect(connectWithToken(pasteOptions())).rejects.toThrow(TOKEN_ERROR);
    expectNothingWritten();
  });

  it("does not blame the token when the app can't be reached", async () => {
    fixture.enqueue(
      "testConnection",
      new IntegrationError({ kind: "not_sent" }),
    );

    const error = await connectWithToken(pasteOptions()).catch((e) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error.message).not.toBe(TOKEN_ERROR);
    expect(error.message).toContain(FIXTURE_NATIVE.displayName);
    expectNothingWritten();
  });

  it.each([
    ["only whitespace", "   \n\t "],
    ["longer than 4096 characters", "x".repeat(4097)],
  ])("refuses a token that is %s without testing it", async (_, token) => {
    await expect(
      connectWithToken({ ...pasteOptions(), token }),
    ).rejects.toThrow(TOKEN_ERROR);
    expect(fixture.calls).toHaveLength(0);
    expectNothingWritten();
  });

  it("accepts a 4096-character token after trimming", async () => {
    const token = "x".repeat(4096);

    await connectWithToken({ ...pasteOptions(), token: ` ${token} ` });

    expect(prisma.mcpConnection.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { accessToken: token, isActive: true },
      }),
    );
  });

  it.each([
    ["a redirect-connect app", FIXTURE_REDIRECT.name],
    ["an MCP app", "fixture-mcp"],
    ["an unknown app", "not-registered"],
  ])("refuses %s", async (_, integrationName) => {
    await expect(
      connectWithToken({ ...pasteOptions(), integrationName }),
    ).rejects.toThrow(KIND_ERROR);
    expect(fixture.calls).toHaveLength(0);
    expectNothingWritten();
  });

  it("refuses a native app with no executor", async () => {
    mockGetNativeExecutor.mockReturnValue(undefined);

    await expect(connectWithToken(pasteOptions())).rejects.toThrow(KIND_ERROR);
    expectNothingWritten();
  });
});

describe("createTokenRedirect", () => {
  beforeEach(() => {
    setUp();
  });

  it("returns an authorize URL whose return address carries the state", async () => {
    const result = await createTokenRedirect(redirectStartOptions());

    expect(result.cookieName).toBe(
      `native-integration-state-${FIXTURE_REDIRECT.name}`,
    );

    const returnUrl = new URL(
      new URL(result.url).searchParams.get("return") ?? "",
    );
    expect(returnUrl.origin).toBe("https://app.example.com");
    expect(returnUrl.pathname).toBe(
      `/account-1/integrations/connect/${FIXTURE_REDIRECT.name}`,
    );
    expect(returnUrl.searchParams.get("state")).toBe(result.state);
    expectNothingWritten();
  });

  it("issues a state that completion accepts for the same user and mailbox", async () => {
    const { state } = await createTokenRedirect(redirectStartOptions());

    await completeTokenRedirect({
      ...redirectCompleteOptions(),
      state,
      cookieState: state,
    });

    expect(prisma.mcpConnection.upsert).toHaveBeenCalledTimes(1);
  });

  it("refuses a user below the required tier", async () => {
    prisma.user.findUnique.mockResolvedValue({ premium: null } as never);

    await expect(createTokenRedirect(redirectStartOptions())).rejects.toThrow(
      "Integrations require a Plus plan",
    );
  });

  it("refuses a paste-connect app", async () => {
    await expect(
      createTokenRedirect({
        ...redirectStartOptions(),
        integrationName: FIXTURE_NATIVE.name,
      }),
    ).rejects.toThrow(KIND_ERROR);
  });
});

describe("completeTokenRedirect", () => {
  beforeEach(() => {
    setUp();
  });

  it("stores the trimmed token after a valid completion", async () => {
    const state = signState();

    await completeTokenRedirect({
      ...redirectCompleteOptions(),
      state,
      cookieState: state,
      token: " redirect-token ",
    });

    expect(fixture.calls[0]).toMatchObject({
      method: "testConnection",
      conn: { accessToken: "redirect-token" },
    });
    expect(prisma.mcpIntegration.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { name: FIXTURE_REDIRECT.name } }),
    );
    expect(prisma.mcpConnection.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { accessToken: "redirect-token", isActive: true },
      }),
    );
  });

  it.each([
    [
      "the cookie is missing",
      () => ({ state: signState(), cookieState: undefined }),
    ],
    [
      "the state differs from the cookie",
      () => ({ state: signState(), cookieState: signState() }),
    ],
    [
      "the state was tampered with",
      () => {
        const [payload, signature] = signState().split(".");
        const forged = Buffer.from(
          JSON.stringify({
            ...JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
            emailAccountId: "account-2",
          }),
        ).toString("base64url");
        const state = `${forged}.${signature}`;
        return { state, cookieState: state };
      },
    ],
    [
      "the state is older than 10 minutes",
      () => {
        const state = signState({ issuedAt: Date.now() - 11 * 60 * 1000 });
        return { state, cookieState: state };
      },
    ],
    [
      "the state belongs to another mailbox",
      () => {
        const state = signState({ emailAccountId: "account-2" });
        return { state, cookieState: state };
      },
    ],
    [
      "the state belongs to another user",
      () => {
        const state = signState({ userId: "user-2" });
        return { state, cookieState: state };
      },
    ],
    [
      "the state was issued for another app",
      () => {
        const state = signState({
          type: `native-integration:${FIXTURE_NATIVE.name}`,
        });
        return { state, cookieState: state };
      },
    ],
  ])("refuses when %s", async (_, buildStates) => {
    await expect(
      completeTokenRedirect({ ...redirectCompleteOptions(), ...buildStates() }),
    ).rejects.toThrow(STATE_ERROR);
    expect(fixture.calls).toHaveLength(0);
    expectNothingWritten();
  });

  it("refuses a token the app rejects and writes nothing", async () => {
    const state = signState();
    fixture.enqueue("testConnection", new IntegrationError({ kind: "auth" }));

    await expect(
      completeTokenRedirect({
        ...redirectCompleteOptions(),
        state,
        cookieState: state,
      }),
    ).rejects.toThrow(TOKEN_ERROR);
    expectNothingWritten();
  });
});

function setUp() {
  vi.clearAllMocks();
  fixture = createFixtureExecutor();
  mockGetNativeExecutor.mockReturnValue(fixture.executor);
  prisma.user.findUnique.mockResolvedValue({
    premium: { tier: "PLUS_MONTHLY", stripeSubscriptionStatus: "active" },
  } as never);
  prisma.mcpIntegration.upsert.mockResolvedValue({
    id: "integration-1",
  } as never);
}

function pasteOptions() {
  return {
    userId: "user-1",
    emailAccountId: "account-1",
    integrationName: FIXTURE_NATIVE.name,
    token: "secret-token",
    logger,
  };
}

function redirectStartOptions() {
  return {
    userId: "user-1",
    emailAccountId: "account-1",
    integrationName: FIXTURE_REDIRECT.name,
    baseUrl: "https://app.example.com",
    logger,
  };
}

function redirectCompleteOptions() {
  return {
    userId: "user-1",
    emailAccountId: "account-1",
    integrationName: FIXTURE_REDIRECT.name,
    token: "redirect-token",
    logger,
  };
}

function signState(
  overrides: Partial<{
    userId: string;
    emailAccountId: string;
    type: string;
    issuedAt: number;
  }> = {},
) {
  return generateSignedOAuthState({
    userId: "user-1",
    emailAccountId: "account-1",
    type: `native-integration:${FIXTURE_REDIRECT.name}`,
    ...overrides,
  });
}

function expectNothingWritten() {
  expect(prisma.mcpIntegration.upsert).not.toHaveBeenCalled();
  expect(prisma.mcpConnection.upsert).not.toHaveBeenCalled();
  expect(prisma.mcpTool.create).not.toHaveBeenCalled();
  expect(prisma.mcpTool.createMany).not.toHaveBeenCalled();
  expect(prisma.mcpTool.upsert).not.toHaveBeenCalled();
}
