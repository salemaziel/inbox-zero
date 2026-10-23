import { describe, expect, it } from "vitest";
import {
  getIntegrationActionDisplayValue,
  getIntegrationActionLabel,
  getIntegrationRemoteSelectTools,
  INTEGRATION_TOOL_SPECS,
  type IntegrationToolSpec,
} from "./tool-specs";

describe("getIntegrationActionLabel", () => {
  it("names the action after the tool it calls", () => {
    expect(
      getIntegrationActionLabel({
        integrationName: "todoist",
        integrationToolName: "add-tasks",
      }),
    ).toBe("Add Todoist task");
  });

  it("does not borrow another integration's label for an unknown tool", () => {
    const label = getIntegrationActionLabel({
      integrationName: "todoist",
      integrationToolName: "not-a-real-tool",
    });

    expect(label).not.toBe("Add Todoist task");
  });

  it("does not borrow a label for an unknown integration", () => {
    const label = getIntegrationActionLabel({
      integrationName: "some-future-crm",
      integrationToolName: "create-record",
    });

    expect(label).not.toBe("Add Todoist task");
  });
});

describe("getIntegrationActionDisplayValue", () => {
  it("uses the display argument declared by the tool spec", () => {
    expect(
      getIntegrationActionDisplayValue({
        integrationName: "todoist",
        integrationToolName: "add-tasks",
        integrationArgs: { content: "Review the contract" },
      }),
    ).toBe("Review the contract");
  });

  it("does not borrow display metadata for an unknown tool", () => {
    expect(
      getIntegrationActionDisplayValue({
        integrationName: "todoist",
        integrationToolName: "unknown-tool",
        integrationArgs: { content: "Review the contract" },
      }),
    ).toBeNull();
  });

  it("trims the display value and hides whitespace-only content", () => {
    expect(
      getIntegrationActionDisplayValue({
        integrationName: "todoist",
        integrationToolName: "add-tasks",
        integrationArgs: { content: "  Review the contract  " },
      }),
    ).toBe("Review the contract");
    expect(
      getIntegrationActionDisplayValue({
        integrationName: "todoist",
        integrationToolName: "add-tasks",
        integrationArgs: { content: "   " },
      }),
    ).toBeNull();
  });
});

describe("getIntegrationRemoteSelectTools", () => {
  it("lists the MCP read tool behind an MCP remote-select", () => {
    expect(getIntegrationRemoteSelectTools("todoist")).toEqual([
      "find-projects",
    ]);
  });

  it("contributes no MCP-callable tool for a native remote-select", () => {
    expect(
      getIntegrationRemoteSelectTools("todoist", [nativeFixtureSpec]),
    ).toEqual([]);
  });
});

describe("remote-select dependsOn", () => {
  it.each([
    ...INTEGRATION_TOOL_SPECS,
    nativeFixtureSpec,
  ])("names only other args of the same spec in $integration/$tool", (spec) => {
    expect(getInvalidDependsOnKeys(spec)).toEqual([]);
  });

  it("flags a dependsOn key that is not another arg of the spec", () => {
    const spec: IntegrationToolSpec = {
      ...nativeFixtureSpec,
      args: [
        {
          key: "listId",
          label: "List",
          control: {
            type: "remote-select",
            source: "native",
            dependsOn: ["listId", "bordId"],
          },
        },
      ],
    };

    expect(getInvalidDependsOnKeys(spec)).toEqual(["listId", "bordId"]);
  });
});

const nativeFixtureSpec: IntegrationToolSpec = {
  integration: "todoist",
  tool: "native-fixture",
  actionLabel: "Native fixture",
  llmDescription: "Fixture spec with dependent native remote-selects.",
  args: [
    {
      key: "boardId",
      label: "Board",
      control: { type: "remote-select", source: "native" },
    },
    {
      key: "listId",
      label: "List",
      control: {
        type: "remote-select",
        source: "native",
        dependsOn: ["boardId"],
      },
    },
  ],
  buildPayload: (resolved) => resolved,
};

function getInvalidDependsOnKeys(spec: IntegrationToolSpec): string[] {
  return spec.args.flatMap((arg) => {
    if (arg.control.type !== "remote-select") return [];
    return (arg.control.dependsOn ?? []).filter(
      (key) => key === arg.key || !spec.args.some((other) => other.key === key),
    );
  });
}
