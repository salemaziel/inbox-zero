import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/__mocks__/prisma";
import { runIntegrationAction } from "@/utils/integrations/run-integration-action.server";
import {
  IntegrationError,
  type IntegrationErrorKind,
} from "@/utils/integrations/types";
import { createScopedLogger } from "@/utils/logger";
import {
  FIXTURE_MCP,
  FIXTURE_NATIVE,
  createFixtureExecutor,
  fixtureMcpResultParser,
} from "@/__tests__/fixtures/integrations/fixture-integration";

vi.mock("server-only", () => ({}));
vi.mock("@/utils/prisma");

const mocks = vi.hoisted(() => ({
  callMcpTool: vi.fn(),
  getNativeExecutor: vi.fn(),
  getMcpResultParser: vi.fn(),
  findPriorIntegrationResult: vi.fn(),
}));

vi.mock("@/utils/mcp/call-tool", () => ({ callMcpTool: mocks.callMcpTool }));
vi.mock("@/utils/integrations/executors.server", () => ({
  getNativeExecutor: mocks.getNativeExecutor,
  getMcpResultParser: mocks.getMcpResultParser,
}));
vi.mock("@/utils/integrations/idempotency.server", () => ({
  findPriorIntegrationResult: mocks.findPriorIntegrationResult,
}));

const PROVIDER_TEXT = "Board 42 is archived for workspace acme";

const FIXTURE_HOSTED: typeof FIXTURE_MCP = {
  ...FIXTURE_MCP,
  name: "fixture-hosted",
  displayName: "Fixture Hosted",
  serverUrl: undefined,
  provider: { id: "composio", app: "fixture" },
};

const logger = createScopedLogger("run-integration-action-test");
const payload = { title: "Follow up", listId: "list-1" };

describe("runIntegrationAction", () => {
  let fixture: ReturnType<typeof createFixtureExecutor>;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    fixture = createFixtureExecutor();
    mocks.getNativeExecutor.mockReturnValue(fixture.executor);
    mocks.getMcpResultParser.mockReturnValue(undefined);
    mocks.findPriorIntegrationResult.mockResolvedValue(null);
    prisma.mcpConnection.findFirst.mockResolvedValue({
      id: "conn-1",
      emailAccountId: "account-1",
      accessToken: "token-1",
    } as never);
    prisma.mcpConnection.updateMany.mockResolvedValue({ count: 1 });
  });

  describe("native", () => {
    it("runs the executor with the connection and payload and returns its result", async () => {
      fixture.enqueue("run", {
        externalId: "item-9",
        url: "https://fixture.invalid/items/9",
      });

      const result = await runIntegrationAction(nativeOptions());

      expect(result).toEqual({
        success: true,
        integrationResult: {
          externalId: "item-9",
          url: "https://fixture.invalid/items/9",
        },
      });
      expect(fixture.calls).toHaveLength(1);
      expect(fixture.calls[0]).toMatchObject({
        method: "run",
        conn: { id: "conn-1", accessToken: "token-1" },
        payload,
      });
      expect(fixture.calls[0].signal).toBeInstanceOf(AbortSignal);
    });

    it("fails without calling the app when there is no active connection", async () => {
      prisma.mcpConnection.findFirst.mockResolvedValue(null);

      const result = await runIntegrationAction(nativeOptions());

      expect(result).toMatchObject({
        success: false,
        errorCode: "INTEGRATION_NOT_CONNECTED",
      });
      expect(fixture.calls).toHaveLength(0);
    });

    it("fails when no executor is registered for the integration", async () => {
      mocks.getNativeExecutor.mockReturnValue(undefined);

      const result = await runIntegrationAction(nativeOptions());

      expect(result).toMatchObject({
        success: false,
        errorCode: "UNSUPPORTED_INTEGRATION_TOOL",
      });
    });

    it("records success with no result when parseResult throws after a successful call", async () => {
      vi.spyOn(fixture.executor, "parseResult").mockImplementation(() => {
        throw new Error("unexpected shape");
      });

      const result = await runIntegrationAction(nativeOptions());

      expect(result).toEqual({ success: true, integrationResult: null });
      expect(fixture.calls).toHaveLength(1);
    });

    it("drops an executor result that is not a valid call result", async () => {
      vi.spyOn(fixture.executor, "parseResult").mockReturnValue({
        externalId: "x".repeat(501),
      });

      const result = await runIntegrationAction(nativeOptions());

      expect(result).toEqual({ success: true, integrationResult: null });
    });

    it("returns a failed result instead of throwing when the connection lookup throws", async () => {
      prisma.mcpConnection.findFirst.mockRejectedValue(
        new Error("database unavailable"),
      );

      const result = await runIntegrationAction(nativeOptions());

      expect(result).toMatchObject({
        success: false,
        errorCode: "INTEGRATION_CALL_FAILED",
      });
      expect(fixture.calls).toHaveLength(0);
    });
  });

  describe("mcp", () => {
    it("parses the tool content with the registered parser", async () => {
      mocks.getMcpResultParser.mockReturnValue(fixtureMcpResultParser);
      mocks.callMcpTool.mockResolvedValue(mcpContent({ externalId: "mcp-1" }));

      const result = await runIntegrationAction(mcpOptions());

      expect(result).toEqual({
        success: true,
        integrationResult: { externalId: "mcp-1" },
      });
      expect(mocks.getMcpResultParser).toHaveBeenCalledWith(
        "fixture-mcp",
        "create-item",
      );
      expect(mocks.callMcpTool).toHaveBeenCalledWith({
        emailAccountId: "account-1",
        integration: "fixture-mcp",
        toolName: "create-item",
        args: payload,
        signal: expect.any(AbortSignal),
      });
    });

    it("succeeds with no result when the tool has no parser", async () => {
      mocks.callMcpTool.mockResolvedValue(mcpContent({ externalId: "mcp-1" }));

      const result = await runIntegrationAction(mcpOptions());

      expect(result).toEqual({ success: true, integrationResult: null });
    });

    it("records success with no result when the parser throws", async () => {
      mocks.getMcpResultParser.mockReturnValue(() => {
        throw new Error("unexpected shape");
      });
      mocks.callMcpTool.mockResolvedValue(mcpContent({ externalId: "mcp-1" }));

      const result = await runIntegrationAction(mcpOptions());

      expect(result).toEqual({ success: true, integrationResult: null });
    });

    it("does not look up a native connection", async () => {
      mocks.callMcpTool.mockResolvedValue([]);

      await runIntegrationAction(mcpOptions());

      expect(prisma.mcpConnection.findFirst).not.toHaveBeenCalled();
      expect(mocks.getNativeExecutor).not.toHaveBeenCalled();
    });
  });

  describe("rerun idempotency", () => {
    const prior = {
      externalId: "item-prior",
      url: "https://fixture.invalid/items/prior",
    };

    it("skips without calling the app when this rule already created the item", async () => {
      mocks.findPriorIntegrationResult.mockResolvedValue(prior);

      const result = await runIntegrationAction(nativeOptions());

      expect(result).toEqual({
        skipped: true,
        reason: "INTEGRATION_ALREADY_CREATED",
        integrationResult: prior,
      });
      expect(fixture.calls).toHaveLength(0);
      expect(prisma.mcpConnection.findFirst).not.toHaveBeenCalled();
      expect(mocks.findPriorIntegrationResult).toHaveBeenCalledWith({
        emailAccountId: "account-1",
        messageId: "message-1",
        ruleId: "rule-1",
        integrationName: "fixture",
        integrationToolName: "create-item",
        currentExecutedRuleId: "executed-rule-1",
      });
    });

    it("skips an MCP tool call when this rule already created the item", async () => {
      mocks.findPriorIntegrationResult.mockResolvedValue(prior);

      const result = await runIntegrationAction(mcpOptions());

      expect(result).toMatchObject({ skipped: true, integrationResult: prior });
      expect(mocks.callMcpTool).not.toHaveBeenCalled();
    });

    it("runs the app normally when there is no prior result", async () => {
      const result = await runIntegrationAction(nativeOptions());

      expect(mocks.findPriorIntegrationResult).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        success: true,
        integrationResult: {
          externalId: "fixture-item-1",
          url: "https://fixture.invalid/items/1",
        },
      });
      expect(fixture.calls).toHaveLength(1);
    });

    it("runs two identical actions in the same executed rule", async () => {
      // A prior row exists only inside the current ExecutedRule, which the lookup excludes.
      mocks.findPriorIntegrationResult.mockImplementation(
        async ({ currentExecutedRuleId }: { currentExecutedRuleId: string }) =>
          currentExecutedRuleId === "executed-rule-1" ? null : prior,
      );

      const first = await runIntegrationAction(nativeOptions());
      const second = await runIntegrationAction(nativeOptions());

      expect(first).toMatchObject({ success: true });
      expect(second).toMatchObject({ success: true });
      expect(fixture.calls).toHaveLength(2);
      expect(mocks.findPriorIntegrationResult).toHaveBeenCalledTimes(2);
      for (const [options] of mocks.findPriorIntegrationResult.mock.calls) {
        expect(options).toMatchObject({
          currentExecutedRuleId: "executed-rule-1",
        });
      }
    });

    it("fails without calling the app or throwing when the lookup throws", async () => {
      const errorSpy = vi.spyOn(logger, "error");
      mocks.findPriorIntegrationResult.mockRejectedValue(
        new Error("database unavailable for message-1"),
      );

      const result = await runIntegrationAction(nativeOptions());

      expect(result).toMatchObject({
        success: false,
        errorCode: "INTEGRATION_CALL_FAILED",
      });
      expect(getErrorMessage(result)).not.toContain("database unavailable");
      expect(fixture.calls).toHaveLength(0);
      expect(prisma.mcpConnection.findFirst).not.toHaveBeenCalled();
      expect(prisma.mcpConnection.updateMany).not.toHaveBeenCalled();
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(
        "database unavailable",
      );
    });
  });

  describe("error mapping", () => {
    it.each<{
      kind: IntegrationErrorKind;
      errorCode: string;
      errors: number;
      calls: number;
    }>([
      {
        kind: "auth",
        errorCode: "INTEGRATION_AUTH_FAILED",
        errors: 1,
        calls: 1,
      },
      {
        kind: "rate_limit",
        errorCode: "INTEGRATION_RATE_LIMITED",
        errors: 1,
        calls: 1,
      },
      {
        kind: "not_sent",
        errorCode: "INTEGRATION_NOT_SENT",
        errors: 3,
        calls: 3,
      },
      {
        kind: "maybe_sent",
        errorCode: "INTEGRATION_MAYBE_SENT",
        errors: 1,
        calls: 1,
      },
      {
        kind: "permanent",
        errorCode: "INTEGRATION_CALL_FAILED",
        errors: 1,
        calls: 1,
      },
    ])("maps $kind to $errorCode after $calls call(s)", async ({
      kind,
      errorCode,
      errors,
      calls,
    }) => {
      fixture.enqueue(
        "run",
        ...Array.from({ length: errors }, () =>
          // A wait over the 10 s cap stops the rate-limit retry immediately.
          integrationError(kind, { retryAfterMs: 60_000 }),
        ),
      );

      const result = await runIntegrationAction(nativeOptions());

      expect(result).toMatchObject({ success: false, errorCode });
      expect(fixture.calls).toHaveLength(calls);
    });

    it("never retries a maybe_sent write and says the item may have been created", async () => {
      fixture.enqueue("run", integrationError("maybe_sent"));

      const result = await runIntegrationAction(nativeOptions());

      expect(fixture.calls).toHaveLength(1);
      expect(getErrorMessage(result)).toContain("may have been created");
    });

    it("does not describe an auth failure as possibly created", async () => {
      fixture.enqueue("run", integrationError("auth"));

      const result = await runIntegrationAction(nativeOptions());

      expect(getErrorMessage(result)).not.toContain("may have been created");
    });

    it("appends the app's message, trimmed, after the owner copy", async () => {
      fixture.enqueue(
        "run",
        integrationError("permanent", {
          providerMessage: `  ${"y".repeat(600)}  `,
        }),
      );

      const message = getErrorMessage(
        await runIntegrationAction(nativeOptions()),
      );

      expect(message).toContain("Fixture");
      expect(message).toContain("y".repeat(500));
      expect(message).not.toContain("y".repeat(501));
      expect(message).not.toMatch(/\s$/);
    });

    it("keeps the app's message out of logs above trace", async () => {
      const spies = [
        vi.spyOn(logger, "error"),
        vi.spyOn(logger, "warn"),
        vi.spyOn(logger, "info"),
      ];
      fixture.enqueue("run", integrationError("permanent"));

      const result = await runIntegrationAction(nativeOptions());

      expect(getErrorMessage(result)).toContain(PROVIDER_TEXT);
      expect(logger.error).toHaveBeenCalledWith(expect.any(String), {
        integration: "fixture",
        toolName: "create-item",
        kind: "permanent",
      });
      for (const spy of spies) {
        expect(JSON.stringify(spy.mock.calls)).not.toContain(PROVIDER_TEXT);
      }
    });
  });

  describe("auth deactivation", () => {
    it("deactivates a native connection on auth failure", async () => {
      fixture.enqueue("run", integrationError("auth"));

      await runIntegrationAction(nativeOptions());

      expect(prisma.mcpConnection.updateMany).toHaveBeenCalledWith({
        where: {
          emailAccountId: "account-1",
          integration: { name: "fixture" },
        },
        data: { isActive: false },
      });
    });

    it("deactivates a direct MCP connection on auth failure", async () => {
      mocks.callMcpTool.mockRejectedValue(integrationError("auth"));

      const result = await runIntegrationAction(mcpOptions());

      expect(result).toMatchObject({ errorCode: "INTEGRATION_AUTH_FAILED" });
      expect(prisma.mcpConnection.updateMany).toHaveBeenCalledWith({
        where: {
          emailAccountId: "account-1",
          integration: { name: "fixture-mcp" },
        },
        data: { isActive: false },
      });
    });

    it("leaves a hosted-provider connection active on auth failure", async () => {
      mocks.callMcpTool.mockRejectedValue(integrationError("auth"));

      const result = await runIntegrationAction({
        ...mcpOptions(),
        integrationName: FIXTURE_HOSTED.name,
        integrationConfig: FIXTURE_HOSTED,
      });

      expect(result).toMatchObject({ errorCode: "INTEGRATION_AUTH_FAILED" });
      expect(prisma.mcpConnection.updateMany).not.toHaveBeenCalled();
    });

    it("still reports the auth failure when deactivation fails", async () => {
      prisma.mcpConnection.updateMany.mockRejectedValue(
        new Error("database unavailable"),
      );
      fixture.enqueue("run", integrationError("auth"));

      const result = await runIntegrationAction(nativeOptions());

      expect(result).toMatchObject({
        success: false,
        errorCode: "INTEGRATION_AUTH_FAILED",
      });
    });

    it("does not deactivate on other failures", async () => {
      fixture.enqueue("run", integrationError("maybe_sent"));

      await runIntegrationAction(nativeOptions());

      expect(prisma.mcpConnection.updateMany).not.toHaveBeenCalled();
    });
  });
});

function nativeOptions() {
  return {
    integrationName: FIXTURE_NATIVE.name,
    toolName: "create-item",
    integrationConfig: FIXTURE_NATIVE,
    payload,
    emailAccountId: "account-1",
    messageId: "message-1",
    ruleId: "rule-1",
    executedRuleId: "executed-rule-1",
    logger,
  };
}

function mcpOptions() {
  return {
    ...nativeOptions(),
    integrationName: FIXTURE_MCP.name,
    integrationConfig: FIXTURE_MCP,
  };
}

function integrationError(
  kind: IntegrationErrorKind,
  extra: { providerMessage?: string; retryAfterMs?: number } = {},
) {
  return new IntegrationError({
    kind,
    providerMessage: PROVIDER_TEXT,
    ...extra,
  });
}

function mcpContent(value: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function getErrorMessage(result: unknown) {
  return (result as { errorMessage?: string }).errorMessage ?? "";
}
