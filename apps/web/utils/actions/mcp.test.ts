import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/__mocks__/prisma";
import {
  createCustomMcpServerAction,
  disconnectMcpConnectionAction,
  testMcpConnectionAction,
} from "@/utils/actions/mcp";
import { createCustomMcpServerBody } from "@/utils/actions/mcp.validation";
import {
  createFixtureExecutor,
  FIXTURE_NATIVE,
} from "@/__tests__/fixtures/integrations/fixture-integration";
import { IntegrationError } from "@/utils/integrations/types";

const { mockSyncMcpTools, mockGetNativeExecutor } = vi.hoisted(() => ({
  mockSyncMcpTools: vi.fn(),
  mockGetNativeExecutor: vi.fn(),
}));

vi.mock("@/utils/prisma");
vi.mock("@/utils/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "user-1", email: "owner@example.com" },
    session: {},
  })),
}));
vi.mock("@/utils/mcp/sync-tools", () => ({
  syncMcpTools: mockSyncMcpTools,
}));

vi.mock("@/utils/integrations/executors.server", () => ({
  getNativeExecutor: mockGetNativeExecutor,
}));
vi.mock("@/utils/mcp/integrations", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/utils/mcp/integrations")>();
  const { FIXTURE_NATIVE } = await import(
    "@/__tests__/fixtures/integrations/fixture-integration"
  );
  return {
    ...original,
    findIntegration: (name: string) =>
      name === FIXTURE_NATIVE.name
        ? FIXTURE_NATIVE
        : original.findIntegration(name),
  };
});

describe("createCustomMcpServerBody", () => {
  it("requires an API key when the server uses one", () => {
    const result = createCustomMcpServerBody.safeParse({
      displayName: "Docs",
      serverUrl: "https://mcp.example.com/mcp",
      authType: "api-token",
    });

    expect(result.success).toBe(false);
  });

  it("does not require an API key for OAuth servers", () => {
    const result = createCustomMcpServerBody.safeParse({
      displayName: "Docs",
      serverUrl: "https://mcp.example.com/mcp",
      authType: "oauth",
    });

    expect(result.success).toBe(true);
  });
});

describe("custom MCP server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.emailAccount.findUnique.mockResolvedValue({
      email: "owner@example.com",
      account: { userId: "user-1", provider: "google" },
    } as never);
    prisma.user.findUnique.mockResolvedValue({
      premium: {
        tier: "PROFESSIONAL_MONTHLY",
        stripeSubscriptionStatus: "active",
      },
    } as never);
    prisma.mcpIntegration.count.mockResolvedValue(0);
    prisma.mcpIntegration.create.mockResolvedValue({
      id: "integration-1",
    } as never);
  });

  it("rejects a server URL that is not https", async () => {
    const result = await createCustomMcpServerAction("account-1", {
      displayName: "Docs",
      serverUrl: "http://mcp.example.com/mcp",
      authType: "oauth",
    });

    expect(result?.serverError).toBe("The server URL must use https");
    expect(prisma.mcpIntegration.create).not.toHaveBeenCalled();
  });

  it("rejects a server URL that resolves to a private address", async () => {
    const result = await createCustomMcpServerAction("account-1", {
      displayName: "Docs",
      serverUrl: "https://10.0.0.1/mcp",
      authType: "oauth",
    });

    expect(result?.serverError).toBe("That server URL is not a public address");
    expect(prisma.mcpIntegration.create).not.toHaveBeenCalled();
  });

  it("removes the server again when the first tool sync fails", async () => {
    mockSyncMcpTools.mockRejectedValue(new Error("connection refused"));

    const result = await createCustomMcpServerAction("account-1", {
      displayName: "Docs",
      serverUrl: "https://mcp.example.com/mcp",
      authType: "api-token",
      apiKey: "secret",
    });

    expect(result?.serverError).toBe(
      "Could not connect to the server. Check the URL and API key.",
    );
    expect(prisma.mcpIntegration.delete).toHaveBeenCalledWith({
      where: { id: "integration-1" },
    });
  });
});

describe("testMcpConnectionAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.emailAccount.findUnique.mockResolvedValue({
      email: "owner@example.com",
      account: { userId: "user-1", provider: "google" },
    } as never);
    prisma.mcpConnection.findUnique.mockResolvedValue({
      isActive: true,
      integration: { name: "notion" },
    } as never);
  });

  it("only tests connections owned by the current email account", async () => {
    prisma.mcpConnection.findUnique.mockResolvedValue(null);

    const result = await testMcpConnectionAction("account-1", {
      connectionId: "other-accounts-connection",
    });

    expect(prisma.mcpConnection.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "other-accounts-connection", emailAccountId: "account-1" },
      }),
    );
    expect(result?.serverError).toBe("Connection not found");
    expect(mockSyncMcpTools).not.toHaveBeenCalled();
  });

  it("returns the tool count when the server responds", async () => {
    mockSyncMcpTools.mockResolvedValue({ toolsCount: 5 });

    const result = await testMcpConnectionAction("account-1", {
      connectionId: "connection-1",
    });

    expect(result?.data).toEqual({ toolsCount: 5 });
  });

  it("reports an auth failure when the server rejects the credentials", async () => {
    mockSyncMcpTools.mockRejectedValue(
      new Error("Failed to sync tools", {
        cause: new Error("Failed to list tools", {
          cause: new StreamableHTTPError(401, "Unauthorized"),
        }),
      }),
    );

    const result = await testMcpConnectionAction("account-1", {
      connectionId: "connection-1",
    });

    expect(result?.serverError).toBe(
      "Authorization expired or was revoked. Reconnect and try again.",
    );
    expect(prisma.mcpConnection.updateMany).toHaveBeenCalledWith({
      where: { emailAccountId: "account-1", integration: { name: "notion" } },
      data: { isActive: false },
    });
  });

  it("keeps a hosted-provider connection active when the server rejects the credentials", async () => {
    prisma.mcpConnection.findUnique.mockResolvedValue({
      isActive: true,
      integration: { name: "hubspot" },
    } as never);
    mockSyncMcpTools.mockRejectedValue(
      new Error("Failed to sync tools", {
        cause: new StreamableHTTPError(401, "Unauthorized"),
      }),
    );

    const result = await testMcpConnectionAction("account-1", {
      connectionId: "connection-1",
    });

    expect(result?.serverError).toBe(
      "Authorization expired or was revoked. Reconnect and try again.",
    );
    expect(prisma.mcpConnection.updateMany).not.toHaveBeenCalled();
  });

  it("reports an auth failure when the token refresh deactivated the connection", async () => {
    prisma.mcpConnection.findUnique
      .mockResolvedValueOnce({
        isActive: true,
        integration: { name: "notion" },
      } as never)
      .mockResolvedValueOnce({ isActive: false } as never);
    mockSyncMcpTools.mockRejectedValue(new Error("no longer authorized"));

    const result = await testMcpConnectionAction("account-1", {
      connectionId: "connection-1",
    });

    expect(result?.serverError).toBe(
      "Authorization expired or was revoked. Reconnect and try again.",
    );
  });

  it("reports an unreachable server for other failures", async () => {
    mockSyncMcpTools.mockRejectedValue(
      new Error("Failed to sync tools", { cause: new Error("ECONNREFUSED") }),
    );

    const result = await testMcpConnectionAction("account-1", {
      connectionId: "connection-1",
    });

    expect(result?.serverError).toBe(
      "Could not reach the server. Check that it is online and try again.",
    );
  });
});

describe("native integrations", () => {
  let fixture: ReturnType<typeof createFixtureExecutor>;

  beforeEach(() => {
    vi.clearAllMocks();
    fixture = createFixtureExecutor();
    mockGetNativeExecutor.mockImplementation((name: string) =>
      name === FIXTURE_NATIVE.name ? fixture.executor : undefined,
    );
    prisma.emailAccount.findUnique.mockResolvedValue({
      email: "owner@example.com",
      account: { userId: "user-1", provider: "google" },
    } as never);
    prisma.mcpConnection.findUnique.mockResolvedValue({
      isActive: true,
      accessToken: "token-1",
      integration: { name: FIXTURE_NATIVE.name },
    } as never);
  });

  describe("testMcpConnectionAction", () => {
    it("tests the token with the app's executor and never syncs MCP tools", async () => {
      const result = await testMcpConnectionAction("account-1", {
        connectionId: "connection-1",
      });

      expect(result?.data).toEqual({ toolsCount: 0 });
      expect(fixture.calls).toHaveLength(1);
      expect(fixture.calls[0]).toMatchObject({
        method: "testConnection",
        conn: { accessToken: "token-1" },
      });
      expect(mockSyncMcpTools).not.toHaveBeenCalled();
    });

    it("fails when no executor is registered for the app", async () => {
      mockGetNativeExecutor.mockReturnValue(undefined);

      const result = await testMcpConnectionAction("account-1", {
        connectionId: "connection-1",
      });

      expect(result?.serverError).toBe("This integration is not available.");
      expect(mockSyncMcpTools).not.toHaveBeenCalled();
    });

    it("deactivates the connection when the app rejects the token", async () => {
      fixture.enqueue("testConnection", new IntegrationError({ kind: "auth" }));

      const result = await testMcpConnectionAction("account-1", {
        connectionId: "connection-1",
      });

      expect(result?.serverError).toBe(
        "Authorization expired or was revoked. Reconnect and try again.",
      );
      expect(prisma.mcpConnection.updateMany).toHaveBeenCalledWith({
        where: {
          emailAccountId: "account-1",
          integration: { name: FIXTURE_NATIVE.name },
        },
        data: { isActive: false },
      });
    });

    it("keeps the connection active when the app is unreachable", async () => {
      fixture.enqueue(
        "testConnection",
        new IntegrationError({ kind: "permanent" }),
      );

      const result = await testMcpConnectionAction("account-1", {
        connectionId: "connection-1",
      });

      expect(result?.serverError).toBe(
        "Could not reach the server. Check that it is online and try again.",
      );
      expect(prisma.mcpConnection.updateMany).not.toHaveBeenCalled();
    });

    it("says the app is limiting requests on a rate limit", async () => {
      fixture.enqueue(
        "testConnection",
        new IntegrationError({ kind: "rate_limit" }),
      );

      const result = await testMcpConnectionAction("account-1", {
        connectionId: "connection-1",
      });

      expect(result?.serverError).toBe(
        "The app is limiting requests right now. Try again in a minute.",
      );
      expect(prisma.mcpConnection.updateMany).not.toHaveBeenCalled();
    });

    it("gives up on an app that never answers", async () => {
      vi.useFakeTimers();
      try {
        fixture.setNeverSettle(true);

        const pending = testMcpConnectionAction("account-1", {
          connectionId: "connection-1",
        });
        await vi.advanceTimersByTimeAsync(15_000);
        const result = await pending;

        expect(result?.serverError).toBe(
          "Could not reach the server. Check that it is online and try again.",
        );
        expect(fixture.calls[0].signal.aborted).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("disconnectMcpConnectionAction", () => {
    it("revokes at the app, then deletes the connection", async () => {
      const order: string[] = [];
      fixture.enqueue("revoke", undefined);
      prisma.mcpConnection.delete.mockImplementation((async () => {
        order.push(`delete after ${fixture.calls.length} revoke call(s)`);
      }) as never);

      await disconnectMcpConnectionAction("account-1", {
        connectionId: "connection-1",
      });

      expect(fixture.calls[0]).toMatchObject({
        method: "revoke",
        conn: {
          id: "connection-1",
          emailAccountId: "account-1",
          accessToken: "token-1",
        },
      });
      expect(order).toEqual(["delete after 1 revoke call(s)"]);
      expect(prisma.mcpConnection.delete).toHaveBeenCalledWith({
        where: { id: "connection-1", emailAccountId: "account-1" },
      });
    });

    it("still deletes the connection when the revoke fails", async () => {
      fixture.enqueue("revoke", new IntegrationError({ kind: "permanent" }));

      const result = await disconnectMcpConnectionAction("account-1", {
        connectionId: "connection-1",
      });

      expect(result?.serverError).toBeUndefined();
      expect(prisma.mcpConnection.delete).toHaveBeenCalledTimes(1);
    });

    it("still deletes the connection when the revoke hangs", async () => {
      vi.useFakeTimers();
      try {
        fixture.setNeverSettle(true);

        const pending = disconnectMcpConnectionAction("account-1", {
          connectionId: "connection-1",
        });
        await vi.advanceTimersByTimeAsync(15_000);
        const result = await pending;

        expect(result?.serverError).toBeUndefined();
        expect(prisma.mcpConnection.delete).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
