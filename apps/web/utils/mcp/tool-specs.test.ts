import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MCP_INTEGRATIONS } from "@/utils/mcp/integrations";
import {
  buildIntegrationArgsFromFields,
  getIntegrationActionDisplayValue,
  getIntegrationActionLabel,
  getIntegrationRemoteSelectTools,
  getIntegrationToolSpec,
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

  it("does not guess a tool when the action names none", () => {
    expect(getIntegrationActionLabel({})).toBe("Add to integration");
    expect(getIntegrationActionLabel()).toBe("Add to integration");
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

describe("option sources", () => {
  it.each(
    INTEGRATION_TOOL_SPECS,
  )("match how $integration/$tool is executed", (spec) => {
    const entry = MCP_INTEGRATIONS[spec.integration];
    const sources = spec.args.flatMap((arg) =>
      arg.control.type === "remote-select" ? [arg.control.source ?? "mcp"] : [],
    );
    const expected = entry.execution === "native" ? "native" : "mcp";

    expect(sources.filter((source) => source !== expected)).toEqual([]);
  });

  it.each(
    INTEGRATION_TOOL_SPECS,
  )("$integration/$tool is a declared write tool of its app", (spec) => {
    expect(MCP_INTEGRATIONS[spec.integration].ruleActionWriteTools).toContain(
      spec.tool,
    );
  });
});

const UTC = { timeZone: "UTC" };

describe("Trello specs", () => {
  const createCard = getIntegrationToolSpec("trello", "create-card")!;
  const addComment = getIntegrationToolSpec("trello", "add-comment")!;
  const moveCard = getIntegrationToolSpec("trello", "move-card")!;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-24T18:30:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("create-card", () => {
    const base = {
      boardId: "board-1",
      listId: "list-1",
      name: "  Pay invoice  ",
      description: "",
      labelId: "none",
      due: "none",
      attachLink: "no",
    };

    it("sends the list and trimmed title, and nothing for empty choices", () => {
      expect(createCard.buildPayload(base, UTC)).toEqual({
        idList: "list-1",
        name: "Pay invoice",
      });
    });

    it("sends the description and a chosen label", () => {
      expect(
        createCard.buildPayload(
          {
            ...base,
            description: "From Acme",
            labelId: "label-1",
          },
          UTC,
        ),
      ).toMatchObject({ desc: "From Acme", idLabels: ["label-1"] });
    });

    it.each([
      ["today", "2026-10-24T12:00:00.000Z"],
      ["tomorrow", "2026-10-25T12:00:00.000Z"],
      ["in-7-days", "2026-10-31T12:00:00.000Z"],
    ])("turns the %s due option into a date", (due, expected) => {
      expect(createCard.buildPayload({ ...base, due }, UTC).due).toBe(expected);
    });

    it("uses a valid AI-written date and drops an invalid one", () => {
      expect(
        createCard.buildPayload({ ...base, due: "2026-11-03" }, UTC).due,
      ).toBe("2026-11-03T12:00:00.000Z");
      expect(
        createCard.buildPayload({ ...base, due: "2026-11-03T09:15:00Z" }, UTC)
          .due,
      ).toBe("2026-11-03T09:15:00.000Z");
      expect(
        createCard.buildPayload({ ...base, due: "next Friday" }, UTC),
      ).not.toHaveProperty("due");
      expect(
        createCard.buildPayload({ ...base, due: "2026-02-31" }, UTC),
      ).not.toHaveProperty("due");
      expect(
        createCard.buildPayload({ ...base, due: "2026-13-01" }, UTC),
      ).not.toHaveProperty("due");
      expect(
        createCard.buildPayload({ ...base, due: "ai" }, UTC),
      ).not.toHaveProperty("due");
    });

    describe("in the user's time zone", () => {
      const losAngeles = { timeZone: "America/Los_Angeles" };

      beforeEach(() => {
        // 20:00 on Oct 24 in Los Angeles, already Oct 25 in UTC.
        vi.setSystemTime(new Date("2026-10-25T03:00:00.000Z"));
      });

      it.each([
        ["today", "2026-10-24T19:00:00.000Z"],
        ["tomorrow", "2026-10-25T19:00:00.000Z"],
        ["in-7-days", "2026-10-31T19:00:00.000Z"],
      ])("counts the %s due option from the user's day", (due, expected) => {
        expect(createCard.buildPayload({ ...base, due }, losAngeles).due).toBe(
          expected,
        );
      });

      it("reads an AI date or time without a zone as the user's local time", () => {
        expect(
          createCard.buildPayload({ ...base, due: "2026-11-03" }, losAngeles)
            .due,
        ).toBe("2026-11-03T20:00:00.000Z");
        expect(
          createCard.buildPayload(
            { ...base, due: "2026-11-03T17:00" },
            losAngeles,
          ).due,
        ).toBe("2026-11-04T01:00:00.000Z");
        expect(
          createCard.buildPayload(
            { ...base, due: "2026-11-03T17:00:00" },
            losAngeles,
          ).due,
        ).toBe("2026-11-04T01:00:00.000Z");
      });

      it("keeps an AI time that names its own zone", () => {
        expect(
          createCard.buildPayload(
            { ...base, due: "2026-11-03T17:00:00+02:00" },
            losAngeles,
          ).due,
        ).toBe("2026-11-03T15:00:00.000Z");
      });

      it("drops an AI time without a zone that rolls over", () => {
        expect(
          createCard.buildPayload(
            { ...base, due: "2026-02-31T10:00" },
            losAngeles,
          ),
        ).not.toHaveProperty("due");
        expect(
          createCard.buildPayload(
            { ...base, due: "2026-11-03T24:30" },
            losAngeles,
          ),
        ).not.toHaveProperty("due");
      });
    });

    it("attaches the email link only when it resolved to an https URL", () => {
      const link = "https://mail.google.com/mail/u/0/#all/abc";

      expect(
        createCard.buildPayload({ ...base, attachLink: link }, UTC).urlSource,
      ).toBe(link);
      expect(createCard.buildPayload(base, UTC)).not.toHaveProperty(
        "urlSource",
      );
      expect(
        createCard.buildPayload({ ...base, attachLink: "yes" }, UTC),
      ).not.toHaveProperty("urlSource");
      expect(
        createCard.buildPayload(
          { ...base, attachLink: "javascript:alert(1)" },
          UTC,
        ),
      ).not.toHaveProperty("urlSource");
    });

    it("defaults to attaching the email link through the link field", () => {
      const arg = createCard.args.find((item) => item.key === "attachLink")!;
      const yes =
        arg.control.type === "select"
          ? arg.control.options.find((option) => option.value === "yes")
          : undefined;

      expect(arg.defaultValue).toBe("yes");
      expect(yes?.payloadValue).toBe("[[link]]");
    });
  });

  it("add-comment sends the card and trimmed text", () => {
    expect(
      addComment.buildPayload(
        {
          boardId: "board-1",
          cardId: "card-1",
          text: " Customer replied ",
        },
        UTC,
      ),
    ).toEqual({ cardId: "card-1", text: "Customer replied" });
  });

  describe("move-card", () => {
    it("moves the card to the chosen list", () => {
      expect(
        moveCard.buildPayload(
          {
            boardId: "board-1",
            cardId: "card-1",
            destination: "list-2",
          },
          UTC,
        ),
      ).toEqual({ cardId: "card-1", idList: "list-2" });
    });

    it("archives the card when Archive is chosen", () => {
      expect(
        moveCard.buildPayload(
          {
            boardId: "board-1",
            cardId: "card-1",
            destination: "archive",
          },
          UTC,
        ),
      ).toEqual({ cardId: "card-1", closed: true });
    });

    it("always offers Archive, even before the lists load", () => {
      const arg = moveCard.args.find((item) => item.key === "destination")!;

      expect(
        arg.control.type === "remote-select"
          ? arg.control.fallbackOptions
          : undefined,
      ).toContainEqual({ value: "archive", label: "Archive the card" });
    });
  });
});

describe("TickTick create_task spec", () => {
  const createTask = getIntegrationToolSpec("ticktick", "create_task")!;
  const losAngeles = { timeZone: "America/Los_Angeles" };
  const base = {
    content: "  Pay invoice  ",
    description: "",
    projectId: "inbox",
    dueString: "none",
    priority: "none",
  };

  beforeEach(() => {
    vi.useFakeTimers();
    // 20:00 on Oct 30 in Los Angeles, already Oct 31 in UTC.
    vi.setSystemTime(new Date("2026-10-31T03:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends the trimmed title and the time zone, and nothing for empty choices", () => {
    expect(createTask.buildPayload(base, losAngeles)).toEqual({
      task: { title: "Pay invoice" },
      client_timezone: "America/Los_Angeles",
    });
  });

  it("sends the title from content and the context line from description", () => {
    expect(
      createTask.buildPayload(
        { ...base, description: " Due Friday " },
        losAngeles,
      ).task,
    ).toEqual({ title: "Pay invoice", content: "Due Friday" });
  });

  it("omits the project for the inbox and passes a real project id through", () => {
    expect(createTask.buildPayload(base, losAngeles).task).not.toHaveProperty(
      "projectId",
    );
    expect(
      createTask.buildPayload({ ...base, projectId: "" }, losAngeles).task,
    ).not.toHaveProperty("projectId");
    expect(
      createTask.buildPayload({ ...base, projectId: "proj-1" }, losAngeles)
        .task,
    ).toMatchObject({ projectId: "proj-1" });
  });

  it.each([
    ["today", "2026-10-30T07:00:00.000Z"],
    ["tomorrow", "2026-10-31T07:00:00.000Z"],
    // Daylight saving ends on Nov 1, so the offset changes within the week.
    ["in-7-days", "2026-11-06T08:00:00.000Z"],
    ["2026-11-03", "2026-11-03T08:00:00.000Z"],
    ["Today", "2026-10-30T07:00:00.000Z"],
    ["in 7 days", "2026-11-06T08:00:00.000Z"],
    ["In a week", "2026-11-06T08:00:00.000Z"],
  ])("sends %s as midnight in the user's time zone", (dueString, expected) => {
    expect(
      createTask.buildPayload({ ...base, dueString }, losAngeles).task,
    ).toMatchObject({
      dueDate: expected,
      isAllDay: true,
      timeZone: "America/Los_Angeles",
    });
  });

  it.each([
    "none",
    "ai",
    "",
    "next Friday",
    "2026-02-31",
    "2026-11-03T17:00:00Z",
  ])("drops the due date for %j", (dueString) => {
    const { task } = createTask.buildPayload(
      { ...base, dueString },
      losAngeles,
    ) as { task: Record<string, unknown> };

    expect(task).not.toHaveProperty("dueDate");
    expect(task).not.toHaveProperty("isAllDay");
    expect(task).not.toHaveProperty("timeZone");
  });

  it.each([
    ["none", undefined],
    ["low", 1],
    ["medium", 3],
    ["high", 5],
    ["High", 5],
    ["5", 5],
    ["", undefined],
    ["urgent", undefined],
  ])("maps priority %j to %s", (priority, expected) => {
    const { task } = createTask.buildPayload(
      { ...base, priority },
      losAngeles,
    ) as { task: Record<string, unknown> };

    expect(task.priority).toBe(expected);
  });

  it("counts a due date from the user's own midnight on a day with a DST change", () => {
    // Santiago springs forward at midnight on Sep 6 2026: 00:00 does not
    // exist, so the day starts at 01:00 local (04:00 UTC).
    vi.setSystemTime(new Date("2026-09-05T20:00:00.000Z"));
    const santiago = { timeZone: "America/Santiago" };

    expect(
      createTask.buildPayload({ ...base, dueString: "tomorrow" }, santiago)
        .task,
    ).toMatchObject({ dueDate: "2026-09-06T04:00:00.000Z" });
  });

  it("builds args from rule-writer fields and sends the TickTick wire fields", () => {
    const integrationArgs = buildIntegrationArgsFromFields({
      integrationName: "ticktick",
      integrationToolName: "create_task",
      fields: { priority: "High", dueString: "in 7 days" },
    });

    expect(integrationArgs).toMatchObject({
      projectId: "inbox",
      dueString: "in-7-days",
    });
    expect(
      createTask.buildPayload(
        { ...integrationArgs, content: "Reply", description: "Context" },
        losAngeles,
      ),
    ).toEqual({
      task: {
        title: "Reply",
        content: "Context",
        dueDate: "2026-11-06T08:00:00.000Z",
        isAllDay: true,
        timeZone: "America/Los_Angeles",
        priority: 5,
      },
      client_timezone: "America/Los_Angeles",
    });
  });

  it("reads list_projects as its remote-select option source", () => {
    expect(getIntegrationRemoteSelectTools("ticktick")).toEqual([
      "list_projects",
    ]);
  });

  describe("project options", () => {
    const control = createTask.args.find(
      (arg) => arg.key === "projectId",
    )?.control;
    const parse = (content: unknown) =>
      control?.type === "remote-select" && control.source !== "native"
        ? control.parseOptions(content)
        : [];

    const projects = [
      { id: "inbox121", name: "Inbox" },
      { id: "p1", name: "Work" },
      { id: "p2", name: "Home" },
    ];
    const expected = [
      { value: "p1", label: "Work" },
      { value: "p2", label: "Home" },
    ];

    it("reads a JSON array in an MCP text block and skips the virtual inbox", () => {
      expect(parse([{ type: "text", text: JSON.stringify(projects) }])).toEqual(
        expected,
      );
    });

    it("reads a { projects } object in an MCP text block", () => {
      expect(
        parse([{ type: "text", text: JSON.stringify({ projects }) }]),
      ).toEqual(expected);
    });

    it("reads a bare array, { projects } or { data } object", () => {
      expect(parse(projects)).toEqual(expected);
      expect(parse({ projects })).toEqual(expected);
      expect(parse({ data: projects })).toEqual(expected);
      expect(
        parse([{ type: "text", text: JSON.stringify({ data: projects }) }]),
      ).toEqual(expected);
    });

    it("skips entries without a string id and name, and ignores junk", () => {
      expect(
        parse([
          {
            type: "text",
            text: JSON.stringify([
              { id: "p1", name: "Work" },
              { id: 7, name: "Numeric id" },
              { id: "p3" },
              { name: "No id" },
              null,
              "text",
            ]),
          },
        ]),
      ).toEqual([{ value: "p1", label: "Work" }]);
      expect(parse([{ type: "text", text: "not json" }])).toEqual([]);
      expect(parse([{ type: "image", data: "abc" }])).toEqual([]);
      expect(parse({ projects: "nope" })).toEqual([]);
      expect(parse(null)).toEqual([]);
      expect(parse("junk")).toEqual([]);
    });
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
