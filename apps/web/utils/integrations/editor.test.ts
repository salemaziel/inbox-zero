import { describe, expect, it } from "vitest";
import {
  getArgsToClear,
  getIntegrationToolChoices,
  getParentValues,
} from "@/utils/integrations/editor";
import {
  getIntegrationToolSpec,
  type IntegrationArgSpec,
  type IntegrationToolSpec,
} from "@/utils/mcp/tool-specs";
import {
  fixtureCreateItemSpec,
  fixtureMcpCreateItemSpec,
} from "@/__tests__/fixtures/integrations/fixture-integration";

const todoistSpec = getIntegrationToolSpec("todoist", "add-tasks")!;

function findArg(spec: IntegrationToolSpec, key: string): IntegrationArgSpec {
  return spec.args.find((arg) => arg.key === key)!;
}

describe("getIntegrationToolChoices", () => {
  it("returns one choice for one spec", () => {
    expect(getIntegrationToolChoices([fixtureCreateItemSpec])).toEqual([
      {
        integration: "fixture",
        tool: "create-item",
        label: "Create fixture item",
      },
    ]);
  });

  it("returns one choice per spec", () => {
    const choices = getIntegrationToolChoices([
      fixtureCreateItemSpec,
      fixtureMcpCreateItemSpec,
    ]);

    expect(choices).toEqual([
      {
        integration: "fixture",
        tool: "create-item",
        label: "Create fixture item",
      },
      {
        integration: "fixture-mcp",
        tool: "create-item",
        label: "Create fixture MCP item",
      },
    ]);
  });

  it("defaults to the production specs", () => {
    expect(getIntegrationToolChoices()).toContainEqual({
      integration: "todoist",
      tool: "add-tasks",
      label: todoistSpec.actionLabel,
    });
  });
});

describe("getArgsToClear", () => {
  it("clears a dependent arg and its display key when the parent changes", () => {
    expect(getArgsToClear(fixtureCreateItemSpec, "boardId")).toEqual([
      "listId",
      "listName",
    ]);
  });

  it("clears nothing for an arg nobody depends on", () => {
    expect(getArgsToClear(fixtureCreateItemSpec, "listId")).toEqual([]);
    expect(getArgsToClear(todoistSpec, "projectId")).toEqual([]);
  });

  it("clears nothing for an unknown key", () => {
    expect(getArgsToClear(fixtureCreateItemSpec, "nope")).toEqual([]);
  });

  it("follows dependents transitively", () => {
    const spec: IntegrationToolSpec = {
      ...fixtureCreateItemSpec,
      args: [
        {
          key: "a",
          label: "A",
          control: { type: "remote-select", source: "native" },
          displayValueKey: "aName",
        },
        {
          key: "b",
          label: "B",
          control: {
            type: "remote-select",
            source: "native",
            dependsOn: ["a"],
          },
          displayValueKey: "bName",
        },
        {
          key: "c",
          label: "C",
          control: {
            type: "remote-select",
            source: "native",
            dependsOn: ["b"],
          },
        },
      ],
    };

    expect(getArgsToClear(spec, "a")).toEqual(["b", "bName", "c"]);
    expect(getArgsToClear(spec, "b")).toEqual(["c"]);
  });

  it("clears dependents of a plain select parent", () => {
    const spec: IntegrationToolSpec = {
      ...fixtureCreateItemSpec,
      args: [
        {
          key: "kind",
          label: "Kind",
          control: {
            type: "select",
            options: [{ value: "a", label: "A" }],
          },
        },
        {
          key: "target",
          label: "Target",
          control: {
            type: "remote-select",
            source: "native",
            dependsOn: ["kind"],
          },
          displayValueKey: "targetName",
        },
      ],
    };

    expect(getArgsToClear(spec, "kind")).toEqual(["target", "targetName"]);
  });

  it("terminates when dependencies form a cycle", () => {
    const spec: IntegrationToolSpec = {
      ...fixtureCreateItemSpec,
      args: [
        {
          key: "a",
          label: "A",
          control: {
            type: "remote-select",
            source: "native",
            dependsOn: ["b"],
          },
        },
        {
          key: "b",
          label: "B",
          control: {
            type: "remote-select",
            source: "native",
            dependsOn: ["a"],
          },
        },
      ],
    };

    expect(getArgsToClear(spec, "a")).toEqual(["b"]);
  });
});

describe("getParentValues", () => {
  const listArg = findArg(fixtureCreateItemSpec, "listId");

  it("returns the stored value of each parent", () => {
    expect(
      getParentValues(fixtureCreateItemSpec, listArg, { boardId: "board-1" }),
    ).toEqual({
      boardId: "board-1",
    });
  });

  it("returns null when a parent is missing", () => {
    expect(getParentValues(fixtureCreateItemSpec, listArg, {})).toBeNull();
    expect(getParentValues(fixtureCreateItemSpec, listArg, null)).toBeNull();
    expect(
      getParentValues(fixtureCreateItemSpec, listArg, undefined),
    ).toBeNull();
  });

  it("returns null when a parent is empty or not a string", () => {
    expect(
      getParentValues(fixtureCreateItemSpec, listArg, { boardId: "  " }),
    ).toBeNull();
    expect(
      getParentValues(fixtureCreateItemSpec, listArg, { boardId: 3 }),
    ).toBeNull();
  });

  it("falls back to the parent's default value when none is stored", () => {
    const spec: IntegrationToolSpec = {
      ...fixtureCreateItemSpec,
      args: [
        {
          key: "boardId",
          label: "Board",
          control: { type: "remote-select", source: "native" },
          defaultValue: "board-default",
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
    };
    const listArg = findArg(spec, "listId");

    expect(getParentValues(spec, listArg, {})).toEqual({
      boardId: "board-default",
    });
    expect(getParentValues(spec, listArg, { boardId: " " })).toEqual({
      boardId: "board-default",
    });
    expect(getParentValues(spec, listArg, { boardId: "board-1" })).toEqual({
      boardId: "board-1",
    });
  });

  it("returns an empty object for an arg with no parents", () => {
    expect(
      getParentValues(todoistSpec, findArg(todoistSpec, "projectId"), null),
    ).toEqual({});
    expect(
      getParentValues(todoistSpec, findArg(todoistSpec, "content"), null),
    ).toEqual({});
  });
});
