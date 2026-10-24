import { describe, it, expect } from "vitest";
import {
  beforeAddRecordingEvent,
  beforeBreadcrumb,
  scrubSentryEvent,
} from "./sentry-scrub";

describe("scrubSentryEvent", () => {
  it("redacts correspondent address fields in extra, preserving non-sensitive keys", () => {
    const event = {
      extra: { from: "sender@other.com", to: "rcpt@other.com", scope: "reply" },
    };

    const result = scrubSentryEvent(event as never) as typeof event;

    expect(result.extra.from).toBe("[redacted]");
    expect(result.extra.to).toBe("[redacted]");
    expect(result.extra.scope).toBe("reply");
  });

  it("redacts tokens and content fields recursively", () => {
    const event = {
      extra: {
        nested: { access_token: "secret", body: "private email body" },
      },
    };

    const result = scrubSentryEvent(event as never) as typeof event;

    expect(result.extra.nested.access_token).toBe("[redacted]");
    expect(result.extra.nested.body).toBe("[redacted]");
  });

  it("redacts field names with variant casing and separators recursively", () => {
    const event = {
      extra: {
        Authorization: "Bearer secret",
        nested: {
          "access-token": "secret",
          reply_to: "sender@other.com",
          "text plain": "private email body",
          messages: [{ "Decoded-Snippet": "private preview" }],
        },
      },
    };

    const result = scrubSentryEvent(event as never) as typeof event;

    expect(result.extra.Authorization).toBe("[redacted]");
    expect(result.extra.nested["access-token"]).toBe("[redacted]");
    expect(result.extra.nested.reply_to).toBe("[redacted]");
    expect(result.extra.nested["text plain"]).toBe("[redacted]");
    expect(result.extra.nested.messages[0]["Decoded-Snippet"]).toBe(
      "[redacted]",
    );
  });

  it("redacts actual email content fields in rich extra objects", () => {
    const event = {
      extra: {
        thread: {
          messages: [
            {
              subject: "Private invoice details",
              textPlain: "Plain private body",
              textHtml: "<p>HTML private body</p>",
              snippet: "Private preview",
              decodedSnippet: "Decoded private preview",
              metadata: { id: "message-1" },
            },
          ],
        },
      },
      user: { email: "me@own.com", id: "user-1" },
    };

    const result = scrubSentryEvent(event as never) as typeof event;
    const message = result.extra.thread.messages[0];

    expect(message.subject).toBe("[redacted]");
    expect(message.textPlain).toBe("[redacted]");
    expect(message.textHtml).toBe("[redacted]");
    expect(message.snippet).toBe("[redacted]");
    expect(message.decodedSnippet).toBe("[redacted]");
    expect(message.metadata.id).toBe("message-1");
    expect(result.user.email).toBe("me@own.com");
  });

  it("redacts sensitive request data and headers", () => {
    const event = {
      request: {
        data: { from: "sender@other.com" },
        headers: { authorization: "Bearer secret" },
      },
    };

    const result = scrubSentryEvent(event as never) as typeof event;

    expect(result.request.data.from).toBe("[redacted]");
    expect(result.request.headers.authorization).toBe("[redacted]");
  });

  it("preserves the authenticated user's own email on event.user", () => {
    const event = { user: { email: "me@own.com", id: "user-1" } };

    const result = scrubSentryEvent(event as never) as typeof event;

    expect(result.user.email).toBe("me@own.com");
  });
});

describe("Sentry URL scrubbing", () => {
  const CONNECT_URL =
    "https://app.example.com/acc-1/integrations/connect/trello?state=abc123&view=full#token=secret-token";
  const CLEAN_CONNECT_URL =
    "https://app.example.com/acc-1/integrations/connect/trello?view=full";

  it("removes the fragment and state from request.url and query_string", () => {
    const event = {
      request: {
        url: CONNECT_URL,
        query_string: "state=abc123&view=full",
      },
    };

    const result = scrubSentryEvent(event as never) as typeof event;

    expect(result.request.url).toBe(CLEAN_CONNECT_URL);
    expect(result.request.query_string).toBe("view=full");
  });

  it("keeps the path when state is the only query param", () => {
    const event = { request: { url: "/login?state=abc#token=secret-token" } };

    const result = scrubSentryEvent(event as never) as typeof event;

    expect(result.request.url).toBe("/login");
  });

  it("removes the fragment and state from navigation and fetch breadcrumbs", () => {
    const event = {
      breadcrumbs: [
        {
          category: "navigation",
          data: {
            from: "/acc-1/integrations/connect/trello?state=abc123#token=secret-token",
            to: "/acc-1/integrations",
          },
        },
        {
          category: "fetch",
          type: "http",
          data: { method: "POST", url: CONNECT_URL, status_code: 200 },
        },
        { category: "console", message: "kept" },
      ],
    };

    const result = scrubSentryEvent(event as never) as typeof event;

    expect(result.breadcrumbs[0].data).toEqual({
      from: "/acc-1/integrations/connect/trello",
      to: "/acc-1/integrations",
    });
    expect(result.breadcrumbs[1].data).toEqual({
      method: "POST",
      url: CLEAN_CONNECT_URL,
      status_code: 200,
    });
    expect(result.breadcrumbs[2]).toEqual({
      category: "console",
      message: "kept",
    });
  });

  it("removes the fragment and state from transaction and span URL attributes", () => {
    const event = {
      type: "transaction",
      transaction: "/[emailAccountId]/integrations/connect/[integration]",
      contexts: {
        trace: {
          data: {
            "url.full": CONNECT_URL,
            "url.path": "/acc-1/integrations/connect/trello",
            "sentry.op": "pageload",
          },
        },
      },
      spans: [
        {
          data: {
            url: CONNECT_URL,
            "http.url": CONNECT_URL,
            "http.query": "?state=abc123&view=full",
            "http.fragment": "#token=secret-token",
          },
        },
        {
          data: {
            "http.target": "/acc-1/integrations/connect/trello?state=abc123",
            "url.query": "state=abc123",
            "url.fragment": "token=secret-token",
          },
        },
      ],
    };

    const result = scrubSentryEvent(event as never) as typeof event;

    expect(result.contexts.trace.data).toEqual({
      "url.full": CLEAN_CONNECT_URL,
      "url.path": "/acc-1/integrations/connect/trello",
      "sentry.op": "pageload",
    });
    expect(result.spans[0].data).toEqual({
      url: CLEAN_CONNECT_URL,
      "http.url": CLEAN_CONNECT_URL,
      "http.query": "?view=full",
    });
    expect(result.spans[1].data).toEqual({
      "http.target": "/acc-1/integrations/connect/trello",
      "url.query": "",
    });
    expect(result.transaction).toBe(
      "/[emailAccountId]/integrations/connect/[integration]",
    );
  });

  it("removes the fragment and state from replay event URLs", () => {
    const event = {
      type: "replay_event",
      urls: [CONNECT_URL, "https://app.example.com/acc-1/integrations"],
    };

    const result = scrubSentryEvent(event as never) as typeof event;

    expect(result.urls).toEqual([
      CLEAN_CONNECT_URL,
      "https://app.example.com/acc-1/integrations",
    ]);
  });

  it("only drops an exact state param, including an encoded key", () => {
    const event = {
      request: {
        url: "https://app.example.com/a?statement=1&%73tate=x&q=a+b%20c&flag",
      },
    };

    const result = scrubSentryEvent(event as never) as typeof event;

    expect(result.request.url).toBe(
      "https://app.example.com/a?statement=1&q=a+b%20c&flag",
    );
  });

  it("redacts a token sent in the URL path, as Trello's revoke call does", () => {
    const revokeUrl = "https://api.trello.com/1/tokens/abc123secret";
    const cleanUrl = "https://api.trello.com/1/tokens/[redacted]";
    const event = {
      breadcrumbs: [
        { category: "http", data: { method: "DELETE", url: revokeUrl } },
      ],
      spans: [
        {
          description: `DELETE ${revokeUrl}`,
          data: { "url.full": revokeUrl },
        },
      ],
    };

    const result = scrubSentryEvent(event as never) as typeof event;

    expect(result.breadcrumbs[0].data.url).toBe(cleanUrl);
    expect(result.spans[0].data["url.full"]).toBe(cleanUrl);
    expect(result.spans[0].description).toBe(`DELETE ${cleanUrl}`);
  });

  it("does not throw on malformed URLs", () => {
    const event = {
      request: { url: "http://[bad host/%E0%A4%A?%E0%A4%A=1&state=x#token=y" },
      breadcrumbs: [{ category: "navigation", data: { from: 42, to: null } }],
    };

    const result = scrubSentryEvent(event as never) as typeof event;

    expect(result.request.url).toBe("http://[bad host/%E0%A4%A?%E0%A4%A=1");
    expect(result.breadcrumbs[0].data).toEqual({ from: 42, to: null });
  });
});

describe("beforeBreadcrumb", () => {
  it("removes the fragment and state before the breadcrumb is buffered", () => {
    const result = beforeBreadcrumb({
      category: "navigation",
      data: {
        from: "/acc-1/integrations/connect/trello?state=abc123#token=secret-token",
        to: "/acc-1/integrations?tab=apps",
      },
    });

    expect(result.data).toEqual({
      from: "/acc-1/integrations/connect/trello",
      to: "/acc-1/integrations?tab=apps",
    });
  });
});

describe("beforeAddRecordingEvent", () => {
  it("removes the fragment and state from replay history span frames", () => {
    const result = beforeAddRecordingEvent({
      type: 5,
      timestamp: 1,
      data: {
        tag: "performanceSpan",
        payload: {
          op: "navigation.push",
          description: "/acc-1/integrations",
          startTimestamp: 1,
          endTimestamp: 1,
          data: {
            previous:
              "/acc-1/integrations/connect/trello?state=abc123#token=secret-token",
          },
        },
      },
    } as never);

    expect(result.data.payload).toMatchObject({
      description: "/acc-1/integrations",
      data: { previous: "/acc-1/integrations/connect/trello" },
    });
  });

  it("removes the fragment from replay click breadcrumb frames", () => {
    const result = beforeAddRecordingEvent({
      type: 5,
      timestamp: 1,
      data: {
        tag: "breadcrumb",
        payload: {
          category: "ui.multiClick",
          timestamp: 1,
          data: { url: "https://app.example.com/login#token=secret-token" },
        },
      },
    } as never);

    expect(result.data.payload).toMatchObject({
      data: { url: "https://app.example.com/login" },
    });
  });
});
