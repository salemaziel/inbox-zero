import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedMcpIntegration } from "@/utils/mcp/resolve-integration";

const { mockGetAuthToken, mockGetMcpServer } = vi.hoisted(() => ({
  mockGetAuthToken: vi.fn(),
  mockGetMcpServer: vi.fn(),
}));

vi.mock("@/utils/mcp/oauth", () => ({
  getAuthToken: mockGetAuthToken,
}));

vi.mock("@/utils/mcp/providers/registry", () => ({
  getIntegrationProvider: () => ({ getMcpServer: mockGetMcpServer }),
}));

import { getMcpServerConnection } from "@/utils/mcp/server-connection";

const baseIntegration: ResolvedMcpIntegration = {
  name: "example",
  displayName: "Example",
  authType: "oauth",
  scopes: [],
  isCustom: false,
};

describe("getMcpServerConnection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMcpServer.mockResolvedValue({
      url: "https://provider.example.com/mcp",
      headers: { "x-api-key": "key" },
    });
    mockGetAuthToken.mockResolvedValue("token");
  });

  it("gives the hosted provider both the read and the rule write tools", async () => {
    await getMcpServerConnection(
      {
        ...baseIntegration,
        provider: { id: "composio", app: "app" },
        allowedTools: ["APP_SEARCH"],
        ruleActionWriteTools: ["APP_CREATE_ITEM"],
      },
      "email-account-1",
    );

    expect(mockGetMcpServer).toHaveBeenCalledWith({
      app: "app",
      emailAccountId: "email-account-1",
      allowedTools: ["APP_SEARCH", "APP_CREATE_ITEM"],
    });
  });

  it("passes an empty list when the provider integration defines no tools", async () => {
    await getMcpServerConnection(
      { ...baseIntegration, provider: { id: "composio", app: "app" } },
      "email-account-1",
    );

    expect(mockGetMcpServer).toHaveBeenCalledWith(
      expect.objectContaining({ allowedTools: [] }),
    );
  });

  it("keeps the direct path on the server URL with a bearer token", async () => {
    const connection = await getMcpServerConnection(
      {
        ...baseIntegration,
        serverUrl: "https://mcp.example.com/mcp",
        allowedTools: ["search"],
        ruleActionWriteTools: ["create"],
      },
      "email-account-1",
    );

    expect(mockGetMcpServer).not.toHaveBeenCalled();
    expect(connection.url).toBe("https://mcp.example.com/mcp");
    expect(connection.headers).toEqual({ Authorization: "Bearer token" });
  });
});
