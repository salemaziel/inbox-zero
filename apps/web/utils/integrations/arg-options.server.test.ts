import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/__mocks__/prisma";
import { SafeError } from "@/utils/error";
import { getIntegrationArgOptions } from "@/utils/integrations/arg-options.server";
import { IntegrationError } from "@/utils/integrations/types";
import { createScopedLogger } from "@/utils/logger";
import type {
  IntegrationArgOption,
  IntegrationToolSpec,
} from "@/utils/mcp/tool-specs";
import {
  FIXTURE_MCP,
  FIXTURE_NATIVE,
  createFixtureExecutor,
  fixtureCreateItemSpec,
} from "@/__tests__/fixtures/integrations/fixture-integration";

vi.mock("server-only", () => ({}));
vi.mock("@/utils/prisma");

const mocks = vi.hoisted(() => ({
  callMcpTool: vi.fn(),
  getActiveNativeConnection: vi.fn(),
  getNativeExecutor: vi.fn(),
  specs: [] as IntegrationToolSpec[],
}));

vi.mock("@/utils/mcp/call-tool", () => ({ callMcpTool: mocks.callMcpTool }));
vi.mock("@/utils/integrations/connection.server", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/utils/integrations/connection.server")
  >()),
  getActiveNativeConnection: mocks.getActiveNativeConnection,
}));
vi.mock("@/utils/integrations/executors.server", () => ({
  getNativeExecutor: mocks.getNativeExecutor,
}));
vi.mock("@/utils/mcp/integrations", () => ({
  findIntegration: (name: string) =>
    [FIXTURE_NATIVE, FIXTURE_MCP].find((entry) => entry.name === name),
}));
// The real specs only declare Todoist, so the lookup runs over the fixture specs.
vi.mock("@/utils/mcp/tool-specs", () => ({
  getRemoteSelectArg: ({
    integration,
    tool,
    argKey,
  }: {
    integration: string;
    tool: string;
    argKey: string;
  }) => {
    const spec = mocks.specs.find(
      (candidate) =>
        candidate.integration === integration && candidate.tool === tool,
    );
    const arg = spec?.args.find((candidate) => candidate.key === argKey);
    if (!spec || arg?.control.type !== "remote-select") return;
    return { spec, control: arg.control };
  },
}));

const logger = createScopedLogger("arg-options-test");
const connection = {
  id: "conn-1",
  emailAccountId: "account-1",
  accessToken: "token",
};
const lists: IntegrationArgOption[] = [{ value: "list-1", label: "To do" }];

const mcpSpec: IntegrationToolSpec = {
  integration: "fixture-mcp",
  tool: "create-item",
  actionLabel: "Create",
  llmDescription: "Create",
  buildPayload: () => ({}),
  args: [
    {
      key: "boardId",
      label: "Board",
      control: {
        type: "remote-select",
        optionsTool: "list-boards",
        parseOptions: () => [],
      },
    },
    {
      key: "listId",
      label: "List",
      control: {
        type: "remote-select",
        optionsTool: "list-lists",
        dependsOn: ["boardId"],
        buildOptionsArgs: (parents) => ({ board: parents.boardId }),
        parseOptions: (content) =>
          (content as { id: string }[]).map((item) => ({
            value: item.id,
            label: item.id,
          })),
      },
    },
  ],
};

const baseOptions = {
  emailAccountId: "account-1",
  tool: "create-item",
  logger,
};

describe("getIntegrationArgOptions", () => {
  let fixture: ReturnType<typeof createFixtureExecutor>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.specs = [fixtureCreateItemSpec, mcpSpec];
    fixture = createFixtureExecutor();
    mocks.getNativeExecutor.mockReturnValue(fixture.executor);
    mocks.getActiveNativeConnection.mockResolvedValue(connection);
    prisma.mcpConnection.updateMany.mockResolvedValue({ count: 1 });
  });

  describe("native integrations", () => {
    it("requests child options with the parent value", async () => {
      fixture.enqueue("listOptions", lists);

      await expect(
        getIntegrationArgOptions({
          ...baseOptions,
          integration: "fixture",
          argKey: "listId",
          parents: { boardId: "board-1" },
        }),
      ).resolves.toEqual({ options: lists });

      expect(fixture.calls).toHaveLength(1);
      expect(fixture.calls[0]).toMatchObject({
        method: "listOptions",
        conn: connection,
        argKey: "listId",
        parents: { boardId: "board-1" },
      });
    });

    it("loads a parent-less arg without parents", async () => {
      await getIntegrationArgOptions({
        ...baseOptions,
        integration: "fixture",
        argKey: "boardId",
      });

      expect(fixture.calls[0]).toMatchObject({ parents: {} });
    });

    it.each([
      ["an undeclared parent", { boardId: "b", other: "x" }],
      ["a missing parent", {}],
      ["an empty parent", { boardId: "  " }],
      ["an oversized parent", { boardId: "x".repeat(501) }],
    ])("refuses %s without calling the app", async (_name, parents) => {
      await expect(
        getIntegrationArgOptions({
          ...baseOptions,
          integration: "fixture",
          argKey: "listId",
          parents,
        }),
      ).rejects.toBeInstanceOf(SafeError);

      expect(fixture.calls).toHaveLength(0);
    });

    it("refuses parents on an arg that declares none", async () => {
      await expect(
        getIntegrationArgOptions({
          ...baseOptions,
          integration: "fixture",
          argKey: "boardId",
          parents: { boardId: "board-1" },
        }),
      ).rejects.toBeInstanceOf(SafeError);
    });

    it("refuses an unknown integration or argument", async () => {
      await expect(
        getIntegrationArgOptions({
          ...baseOptions,
          integration: "nope",
          argKey: "boardId",
        }),
      ).rejects.toBeInstanceOf(SafeError);

      await expect(
        getIntegrationArgOptions({
          ...baseOptions,
          integration: "fixture",
          argKey: "title",
        }),
      ).rejects.toBeInstanceOf(SafeError);
    });

    it("refuses when there is no active connection", async () => {
      mocks.getActiveNativeConnection.mockResolvedValue(null);

      await expect(
        getIntegrationArgOptions({
          ...baseOptions,
          integration: "fixture",
          argKey: "boardId",
        }),
      ).rejects.toBeInstanceOf(SafeError);

      expect(fixture.calls).toHaveLength(0);
    });

    it("deactivates the connection on an auth failure", async () => {
      fixture.enqueue("listOptions", new IntegrationError({ kind: "auth" }));

      await expect(
        getIntegrationArgOptions({
          ...baseOptions,
          integration: "fixture",
          argKey: "boardId",
        }),
      ).rejects.toMatchObject({ kind: "auth" });

      expect(prisma.mcpConnection.updateMany).toHaveBeenCalledWith({
        where: {
          emailAccountId: "account-1",
          integration: { name: "fixture" },
        },
        data: { isActive: false },
      });
    });

    it("keeps the connection on a non-auth failure and makes one attempt", async () => {
      fixture.enqueue(
        "listOptions",
        new IntegrationError({ kind: "not_sent" }),
        lists,
      );

      await expect(
        getIntegrationArgOptions({
          ...baseOptions,
          integration: "fixture",
          argKey: "boardId",
        }),
      ).rejects.toMatchObject({ kind: "not_sent" });

      expect(fixture.calls).toHaveLength(1);
      expect(prisma.mcpConnection.updateMany).not.toHaveBeenCalled();
    });

    it("still surfaces the auth error when deactivation fails", async () => {
      fixture.enqueue("listOptions", new IntegrationError({ kind: "auth" }));
      prisma.mcpConnection.updateMany.mockRejectedValue(new Error("db down"));

      await expect(
        getIntegrationArgOptions({
          ...baseOptions,
          integration: "fixture",
          argKey: "boardId",
        }),
      ).rejects.toMatchObject({ kind: "auth" });
    });
  });

  describe("MCP integrations", () => {
    it("builds the tool args from the parents and parses the response", async () => {
      mocks.callMcpTool.mockResolvedValue([{ id: "list-9" }]);

      await expect(
        getIntegrationArgOptions({
          ...baseOptions,
          integration: "fixture-mcp",
          argKey: "listId",
          parents: { boardId: "board-1" },
        }),
      ).resolves.toEqual({ options: [{ value: "list-9", label: "list-9" }] });

      expect(mocks.callMcpTool).toHaveBeenCalledWith(
        expect.objectContaining({
          emailAccountId: "account-1",
          integration: "fixture-mcp",
          toolName: "list-lists",
          args: { board: "board-1" },
        }),
      );
    });

    it("calls with empty args when the field has no dependsOn", async () => {
      mocks.callMcpTool.mockResolvedValue([]);

      await getIntegrationArgOptions({
        ...baseOptions,
        integration: "fixture-mcp",
        argKey: "boardId",
      });

      expect(mocks.callMcpTool).toHaveBeenCalledWith(
        expect.objectContaining({ toolName: "list-boards", args: {} }),
      );
    });

    it("refuses a missing parent without calling the tool", async () => {
      await expect(
        getIntegrationArgOptions({
          ...baseOptions,
          integration: "fixture-mcp",
          argKey: "listId",
        }),
      ).rejects.toBeInstanceOf(SafeError);

      expect(mocks.callMcpTool).not.toHaveBeenCalled();
    });

    it("deactivates the direct connection on an auth failure", async () => {
      mocks.callMcpTool.mockRejectedValue(
        new IntegrationError({ kind: "auth" }),
      );

      await expect(
        getIntegrationArgOptions({
          ...baseOptions,
          integration: "fixture-mcp",
          argKey: "boardId",
        }),
      ).rejects.toMatchObject({ kind: "auth" });

      expect(prisma.mcpConnection.updateMany).toHaveBeenCalledWith({
        where: {
          emailAccountId: "account-1",
          integration: { name: "fixture-mcp" },
        },
        data: { isActive: false },
      });
    });
  });
});
