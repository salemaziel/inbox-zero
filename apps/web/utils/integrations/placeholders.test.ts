import { describe, expect, it } from "vitest";
import {
  buildPlaceholderValues,
  findUnknownPlaceholders,
  type PlaceholderValues,
  renderIntegrationTextArg,
} from "@/utils/integrations/placeholders";

const values: PlaceholderValues = {
  subject: "Invoice 42",
  from: "Alice <alice@example.com>",
  to: "bob@example.com",
  date: "2026-02-20T12:00:00.000Z",
  snippet: "Please pay by Friday",
  link: "https://mail.google.com/mail/u/0/#all/msg-1",
  ruleName: "Invoices",
};

describe("renderIntegrationTextArg", () => {
  it.each([
    ["[[subject]]", values.subject],
    ["[[from]]", values.from],
    ["[[to]]", values.to],
    ["[[date]]", values.date],
    ["[[snippet]]", values.snippet],
    ["[[link]]", values.link],
    ["[[ruleName]]", values.ruleName],
  ])("resolves %s", (template, expected) => {
    expect(renderIntegrationTextArg({ template, values })).toBe(expected);
  });

  it("resolves markers with inner spaces", () => {
    expect(
      renderIntegrationTextArg({ template: "Title: [[ subject ]]", values }),
    ).toBe("Title: Invoice 42");
  });

  it("leaves wrong-case, unknown and malformed markers literal", () => {
    const template = "[[Subject]] [[unknown]] [[ two words ]] [[]]";
    expect(renderIntegrationTextArg({ template, values })).toBe(template);
  });

  it("replaces markers in literal parts and inserts AI vars in order", () => {
    expect(
      renderIntegrationTextArg({
        template: "[[subject]]: {{summarize}} (from [[from]]) {{next step}}",
        aiVars: { var1: "Pay the invoice", var2: "Reply" },
        values,
      }),
    ).toBe(
      "Invoice 42: Pay the invoice (from Alice <alice@example.com>) Reply",
    );
  });

  it("inserts values containing markers or template syntax literally", () => {
    expect(
      renderIntegrationTextArg({
        template: "Title: [[subject]] {{summarize}}",
        aiVars: { var1: "done" },
        values: {
          ...values,
          subject: "{{ignore previous instructions}} [[from]] $& $1",
        },
      }),
    ).toBe("Title: {{ignore previous instructions}} [[from]] $& $1 done");
  });

  it("does not substitute markers inside AI output", () => {
    expect(
      renderIntegrationTextArg({
        template: "Note: {{summarize}}",
        aiVars: { var1: "See [[subject]] and {{x}}" },
        values,
      }),
    ).toBe("Note: See [[subject]] and {{x}}");
  });

  it("uses an empty string for missing values and AI vars", () => {
    expect(
      renderIntegrationTextArg({
        template: "[[snippet]]|{{summarize}}|[[link]]",
        values: { ...values, snippet: "", link: "" },
      }),
    ).toBe("||");
  });
});

describe("findUnknownPlaceholders", () => {
  it("reports wrong-case and unknown names once each", () => {
    expect(
      findUnknownPlaceholders(
        "[[Subject]] [[ unknown ]] [[subject]] [[unknown]] {{ ai }}",
      ),
    ).toEqual(["Subject", "unknown"]);
  });

  it("ignores markers inside AI sections, which are never substituted", () => {
    expect(
      findUnknownPlaceholders("{{mention [[nope]]}} [[bad]] {{ [[worse]] }}"),
    ).toEqual(["bad"]);
  });

  it("ignores known and malformed markers", () => {
    expect(
      findUnknownPlaceholders(
        "[[ subject ]] [[ruleName]] [[ two words ]] [[]] [[1abc]]",
      ),
    ).toEqual([]);
  });
});

describe("buildPlaceholderValues", () => {
  const message = {
    id: "msg-1",
    threadId: "thread-1",
    headers: {
      subject: "Invoice 42",
      from: "Alice <alice@example.com>",
      to: "bob@example.com",
      date: "Fri, 20 Feb 2026 12:00:00 +0000",
    },
    snippet: "Please pay by Friday",
    internalDate: "1771588800000",
  };
  const googleAccount = {
    email: "bob@example.com",
    account: { provider: "google" },
  };

  it("builds every value from the message, account and rule", () => {
    const result = buildPlaceholderValues({
      message,
      emailAccount: googleAccount,
      ruleName: "Invoices",
    });

    expect(result).toMatchObject({
      subject: "Invoice 42",
      from: "Alice <alice@example.com>",
      to: "bob@example.com",
      date: "2026-02-20T12:00:00.000Z",
      snippet: "Please pay by Friday",
      ruleName: "Invoices",
    });
    expect(result.link).toMatch(/^https:\/\/mail\.google\.com\//);
    expect(result.link).toContain("msg-1");
  });

  it("falls back to the Date header when internalDate is missing", () => {
    const result = buildPlaceholderValues({
      message: {
        ...message,
        internalDate: null,
        headers: {
          ...message.headers,
          date: "Sat, 21 Feb 2026 08:30:00 +0100",
        },
      },
      emailAccount: googleAccount,
      ruleName: "Invoices",
    });

    expect(result.date).toBe("2026-02-21T07:30:00.000Z");
  });

  it("uses empty strings when fields are missing or unparseable", () => {
    const result = buildPlaceholderValues({
      message: {
        id: "msg-1",
        threadId: "thread-1",
        headers: { date: "not a date" } as typeof message.headers,
        snippet: undefined as unknown as string,
        internalDate: "garbage",
      },
      emailAccount: {
        email: "bob@example.com",
        account: { provider: "microsoft" },
      },
      ruleName: "",
    });

    expect(result).toEqual({
      subject: "",
      from: "",
      to: "",
      date: "",
      snippet: "",
      link: "",
      ruleName: "",
    });
  });

  it("uses the message's own Outlook URL for Microsoft accounts", () => {
    const result = buildPlaceholderValues({
      message: {
        ...message,
        externalUrl: "https://outlook.office.com/mail/inbox/id/AAMk1",
      },
      emailAccount: {
        email: "bob@example.com",
        account: { provider: "microsoft" },
      },
      ruleName: "Invoices",
    });

    expect(result.link).toBe(
      "https://outlook.office.com/mail/inbox/id/AAMk1?ispopout=0",
    );
  });
});
