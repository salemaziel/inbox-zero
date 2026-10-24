import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/__mocks__/prisma";

const { mockIsEnabled } = vi.hoisted(() => ({ mockIsEnabled: vi.fn() }));

vi.mock("@/utils/prisma");
vi.mock("@/utils/middleware", () => ({
  withEmailAccount:
    (
      _scope: string,
      handler: (
        request: NextRequest & Record<string, unknown>,
      ) => Promise<Response>,
    ) =>
    (request: NextRequest) =>
      handler(
        Object.assign(request, { auth: { emailAccountId: "account-1" } }),
      ),
}));
vi.mock("@/utils/integration-action.server", () => ({
  isIntegrationActionEnabledForEmailAccountId: mockIsEnabled,
}));
vi.mock("@/utils/mcp/integrations", async () => {
  const { FIXTURE_MCP, FIXTURE_NATIVE } = await import(
    "@/__tests__/fixtures/integrations/fixture-integration"
  );
  return {
    MCP_INTEGRATIONS: { fixture: FIXTURE_NATIVE, "fixture-mcp": FIXTURE_MCP },
  };
});

import { GET } from "./route";

describe("GET /api/mcp/integrations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.mcpConnection.findMany.mockResolvedValue([]);
    prisma.mcpIntegration.findMany.mockResolvedValue([]);
  });

  it("hides native apps when integration actions are off for the account", async () => {
    mockIsEnabled.mockResolvedValue(false);

    const { integrations } = await getIntegrations();

    expect(mockIsEnabled).toHaveBeenCalledWith("account-1");
    expect(integrations.map((integration) => integration.name)).toEqual([
      "fixture-mcp",
    ]);
  });

  it("lists native apps with their execution kind and connect kind when actions are on", async () => {
    mockIsEnabled.mockResolvedValue(true);

    const { integrations } = await getIntegrations();

    expect(integrations).toEqual([
      expect.objectContaining({
        name: "fixture",
        execution: "native",
        connectKind: "api-token-paste",
      }),
      expect.objectContaining({
        name: "fixture-mcp",
        execution: "mcp",
      }),
    ]);
    expect(integrations[1]).not.toHaveProperty("connectKind");
  });

  it("lists MCP integrations the same way whether or not actions are on", async () => {
    mockIsEnabled.mockResolvedValue(false);
    const off = await getIntegrations();
    mockIsEnabled.mockResolvedValue(true);
    const on = await getIntegrations();

    const mcpOff = off.integrations.find((i) => i.name === "fixture-mcp");
    const mcpOn = on.integrations.find((i) => i.name === "fixture-mcp");
    expect(mcpOff).toBeDefined();
    expect(mcpOff).toEqual(mcpOn);
  });

  it("marks custom servers as MCP", async () => {
    mockIsEnabled.mockResolvedValue(false);
    prisma.mcpIntegration.findMany.mockResolvedValue([
      {
        name: "custom-abc",
        displayName: "Docs",
        serverUrl: "https://mcp.example.com/mcp",
        authType: null,
      },
    ] as never);

    const { integrations } = await getIntegrations();

    expect(integrations).toContainEqual(
      expect.objectContaining({ name: "custom-abc", execution: "mcp" }),
    );
  });
});

async function getIntegrations() {
  const response = await GET(
    new NextRequest("http://localhost/api/mcp/integrations"),
    {} as never,
  );
  return (await response.json()) as {
    integrations: { name: string; execution: string; connectKind?: string }[];
  };
}
