import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/__mocks__/prisma";
import { IntegrationError } from "@/utils/integrations/types";

const {
  mockCallTool,
  mockClientClose,
  mockClientConnect,
  mockGetAuthToken,
  mockTransportClose,
} = vi.hoisted(() => ({
  mockCallTool: vi.fn(),
  mockClientClose: vi.fn(),
  mockClientConnect: vi.fn(),
  mockGetAuthToken: vi.fn(),
  mockTransportClose: vi.fn(),
}));

vi.mock("@/utils/prisma");

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    connect = mockClientConnect;
    callTool = mockCallTool;
    close = mockClientClose;
  },
}));

vi.mock("@/utils/mcp/oauth", () => ({
  getAuthToken: mockGetAuthToken,
}));

vi.mock("@/utils/mcp/transport", () => ({
  createMcpTransport: () => ({ close: mockTransportClose }),
}));

import { callMcpTool } from "@/utils/mcp/call-tool";

const GENERIC_MESSAGE = "Failed to call todoist tool add-tasks";

describe("callMcpTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthToken.mockResolvedValue("token");
    mockClientConnect.mockResolvedValue(undefined);
    mockCallTool.mockResolvedValue({ content: [{ type: "text", text: "ok" }] });
  });

  it("passes the abort signal to connect and the tool call", async () => {
    const { signal } = new AbortController();

    await expect(callTodoist({ signal })).resolves.toEqual([
      { type: "text", text: "ok" },
    ]);

    expect(mockClientConnect).toHaveBeenCalledWith(expect.anything(), {
      signal,
    });
    expect(mockCallTool).toHaveBeenCalledWith(
      { name: "add-tasks", arguments: { content: "private task" } },
      undefined,
      { signal },
    );
  });

  it("keeps remote tool error content out of the message", async () => {
    mockCallTool.mockResolvedValue({
      isError: true,
      content: [
        {
          type: "text",
          text: `Task title copied from a private email ${"x".repeat(600)}`,
        },
      ],
    });

    const error = await getError(callTodoist());

    expect(error.kind).toBe("permanent");
    expect(error.message).toBe(GENERIC_MESSAGE);
    expect(error.message).not.toContain("private email");
    expect(error.providerMessage).toContain(
      "Task title copied from a private email",
    );
    expect(error.providerMessage).toHaveLength(500);
    expect(mockClientClose).toHaveBeenCalledOnce();
    expect(mockTransportClose).toHaveBeenCalledOnce();
  });

  it("rejects tools outside the allowlist as permanent without connecting", async () => {
    const error = await getError(
      callMcpTool({
        emailAccountId: "email-account-1",
        integration: "todoist",
        toolName: "delete-everything",
        args: {},
      }),
    );

    expect(error.kind).toBe("permanent");
    expect(error.message).toBe("Failed to call todoist tool delete-everything");
    expect(mockClientConnect).not.toHaveBeenCalled();
  });

  it("classifies a setup failure on a healthy connection as not sent", async () => {
    mockGetAuthToken.mockRejectedValue(new Error("database unavailable"));
    prisma.mcpConnection.findFirst.mockResolvedValue({
      isActive: true,
      accessToken: "token",
      apiKey: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    } as never);

    const error = await getError(callTodoist());

    expect(error.kind).toBe("not_sent");
    expect(error.message).toBe(GENERIC_MESSAGE);
    expect(error.cause).toEqual(new Error("database unavailable"));
    expect(mockClientConnect).not.toHaveBeenCalled();
  });

  it("classifies a failed refresh of an expired token on a still-active connection as not sent", async () => {
    mockGetAuthToken.mockRejectedValue(
      new Error("Token endpoint returned 503"),
    );
    prisma.mcpConnection.findFirst.mockResolvedValue({
      isActive: true,
      accessToken: "token",
      apiKey: null,
      expiresAt: new Date(Date.now() - 1000),
    } as never);

    const error = await getError(callTodoist());

    expect(error.kind).toBe("not_sent");
    expect(mockClientConnect).not.toHaveBeenCalled();
  });

  it("classifies a setup failure as not sent when the connection lookup also fails", async () => {
    mockGetAuthToken.mockRejectedValue(new Error("database unavailable"));
    prisma.mcpConnection.findFirst.mockRejectedValue(
      new Error("database unavailable"),
    );

    const error = await getError(callTodoist());

    expect(error.kind).toBe("not_sent");
  });

  it.each([
    {
      name: "the refresh deactivated the connection",
      connection: {
        isActive: false,
        accessToken: "token",
        apiKey: null,
        expiresAt: new Date(Date.now() - 1000),
      },
    },
    {
      name: "the connection has no token",
      connection: {
        isActive: true,
        accessToken: null,
        apiKey: null,
        expiresAt: null,
      },
    },
    { name: "the connection is missing", connection: null },
  ])("classifies a setup failure as auth when $name", async ({
    connection,
  }) => {
    mockGetAuthToken.mockRejectedValue(new Error("Please reconnect."));
    prisma.mcpConnection.findFirst.mockResolvedValue(connection as never);

    const error = await getError(callTodoist());

    expect(error.kind).toBe("auth");
    expect(error.message).toBe(GENERIC_MESSAGE);
    expect(mockClientConnect).not.toHaveBeenCalled();
  });

  it("classifies a 401 during connect as auth", async () => {
    mockClientConnect.mockRejectedValue(
      new Error("Error POSTing to endpoint", {
        cause: new StreamableHTTPError(401, "Unauthorized"),
      }),
    );

    const error = await getError(callTodoist());

    expect(error.kind).toBe("auth");
    expect(mockCallTool).not.toHaveBeenCalled();
  });

  it("classifies a connect failure as not sent", async () => {
    mockClientConnect.mockRejectedValue(new Error("fetch failed"));

    const error = await getError(callTodoist());

    expect(error.kind).toBe("not_sent");
    expect(mockCallTool).not.toHaveBeenCalled();
    expect(mockClientClose).toHaveBeenCalledOnce();
    expect(mockTransportClose).toHaveBeenCalledOnce();
  });

  it("classifies a 429 from the tool call as rate limited", async () => {
    mockCallTool.mockRejectedValue(
      new StreamableHTTPError(429, "Too Many Requests"),
    );

    const error = await getError(callTodoist());

    expect(error.kind).toBe("rate_limit");
  });

  it("classifies a failure after the tool call was sent as maybe sent", async () => {
    const controller = new AbortController();
    controller.abort();
    mockCallTool.mockRejectedValue(controller.signal.reason);

    const error = await getError(callTodoist({ signal: controller.signal }));

    expect(error.kind).toBe("maybe_sent");
    expect(error.message).toBe(GENERIC_MESSAGE);
  });
});

function callTodoist({ signal }: { signal?: AbortSignal } = {}) {
  return callMcpTool({
    emailAccountId: "email-account-1",
    integration: "todoist",
    toolName: "add-tasks",
    args: { content: "private task" },
    signal,
  });
}

async function getError(promise: Promise<unknown>): Promise<IntegrationError> {
  const error = await promise.then(
    () => {
      throw new Error("Expected callMcpTool to reject");
    },
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(IntegrationError);
  return error as IntegrationError;
}
