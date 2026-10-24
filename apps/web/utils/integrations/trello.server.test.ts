import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { trelloExecutor } from "@/utils/integrations/trello.server";
import type { IntegrationError } from "@/utils/integrations/types";

vi.mock("server-only", () => ({}));

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: { TRELLO_API_KEY: "test-key" as string | undefined },
}));

vi.mock("@/env", () => ({
  env: {
    get TRELLO_API_KEY() {
      return mockEnv.TRELLO_API_KEY;
    },
  },
}));

const TOKEN = "test-token-abc";
const conn = { id: "conn-1", emailAccountId: "account-1", accessToken: TOKEN };
const BOARD_ID = "5f1a2b3c4d5e6f7a8b9c0d1e";
const CARD_ID = "6a1b2c3d4e5f6a7b8c9d0e1f";

describe("trelloExecutor", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    mockEnv.TRELLO_API_KEY = "test-key";
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => Response.json({}));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("isConfigured", () => {
    it("is configured only when the server has a Trello API key", () => {
      expect(trelloExecutor.isConfigured?.()).toBe(true);
      mockEnv.TRELLO_API_KEY = undefined;
      expect(trelloExecutor.isConfigured?.()).toBe(false);
    });
  });

  describe("buildAuthorizeUrl", () => {
    it("asks Trello for a non-expiring read/write token returned in the fragment", () => {
      const returnUrl =
        "https://app.example.com/account-1/integrations/connect/trello?state=abc";

      const url = new URL(
        trelloExecutor.buildAuthorizeUrl?.({ returnUrl }) ?? "",
      );

      expect(url.origin + url.pathname).toBe("https://trello.com/1/authorize");
      expect(Object.fromEntries(url.searchParams)).toEqual({
        key: "test-key",
        name: "Inbox Zero",
        scope: "read,write",
        expiration: "never",
        callback_method: "fragment",
        response_type: "token",
        return_url: returnUrl,
      });
    });
  });

  describe("requests", () => {
    it("authenticates with the OAuth header and keeps the token out of the URL", async () => {
      await trelloExecutor.testConnection(
        { accessToken: TOKEN },
        { signal: new AbortController().signal },
      );
      await trelloExecutor.run(
        conn,
        { tool: "create-card", payload: { idList: "list-1", name: "Pay" } },
        { signal: new AbortController().signal },
      );
      await trelloExecutor.listOptions(
        conn,
        "listId",
        { boardId: BOARD_ID },
        {
          signal: new AbortController().signal,
        },
      );

      for (const [url, init] of fetchMock.mock.calls) {
        expect(String(url)).not.toContain(TOKEN);
        expect(new Headers(init?.headers).get("authorization")).toBe(
          `OAuth oauth_consumer_key="test-key", oauth_token="${TOKEN}"`,
        );
      }
    });

    it("tests the connection with a minimal member lookup", async () => {
      await trelloExecutor.testConnection(
        { accessToken: TOKEN },
        { signal: new AbortController().signal },
      );

      expect(getCall(0)).toMatchObject({
        method: "GET",
        url: "https://api.trello.com/1/members/me?fields=id",
      });
    });

    it("passes the caller's abort signal", async () => {
      const signal = new AbortController().signal;

      await trelloExecutor.testConnection({ accessToken: TOKEN }, { signal });

      expect(fetchMock.mock.calls[0][1]?.signal).toBe(signal);
    });

    it("revokes the token, which Trello only accepts in the path", async () => {
      await trelloExecutor.revoke?.(conn, {
        signal: new AbortController().signal,
      });

      expect(getCall(0)).toMatchObject({
        method: "DELETE",
        url: `https://api.trello.com/1/tokens/${TOKEN}`,
      });
    });

    it("fails without calling Trello when the server has no API key", async () => {
      mockEnv.TRELLO_API_KEY = undefined;

      await expect(
        trelloExecutor.testConnection(
          { accessToken: TOKEN },
          { signal: new AbortController().signal },
        ),
      ).rejects.toMatchObject({ kind: "permanent" });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("run", () => {
    it("creates a card on the chosen list", async () => {
      const payload = { idList: "list-1", name: "Pay", idLabels: ["label-1"] };

      await runTool("create-card", payload);

      expect(getCall(0)).toEqual({
        method: "POST",
        url: "https://api.trello.com/1/cards",
        body: payload,
      });
    });

    it("comments on the chosen card", async () => {
      await runTool("add-comment", { cardId: CARD_ID, text: "Replied" });

      expect(getCall(0)).toEqual({
        method: "POST",
        url: `https://api.trello.com/1/cards/${CARD_ID}/actions/comments`,
        body: { text: "Replied" },
      });
    });

    it("moves the card to another list", async () => {
      await runTool("move-card", { cardId: CARD_ID, idList: "list-2" });

      expect(getCall(0)).toEqual({
        method: "PUT",
        url: `https://api.trello.com/1/cards/${CARD_ID}`,
        body: { idList: "list-2" },
      });
    });

    it("archives the card", async () => {
      await runTool("move-card", { cardId: CARD_ID, closed: true });

      expect(getCall(0)).toEqual({
        method: "PUT",
        url: `https://api.trello.com/1/cards/${CARD_ID}`,
        body: { closed: true },
      });
    });

    it.each([
      ["an unknown tool", "delete-card", { cardId: CARD_ID }],
      ["a card id that is not a Trello id", "add-comment", { cardId: "../x" }],
      ["a missing card id", "move-card", { closed: true }],
    ])("refuses %s without calling Trello", async (_, tool, payload) => {
      await expect(runTool(tool, payload)).rejects.toMatchObject({
        kind: "permanent",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("parseResult", () => {
    const card = {
      id: CARD_ID,
      shortUrl: "https://trello.com/c/AbCd1234",
      url: "https://trello.com/c/AbCd1234/1-pay",
    };

    it.each([
      "create-card",
      "move-card",
    ])("reads the card id and short URL for %s", (tool) => {
      expect(trelloExecutor.parseResult(card, tool)).toEqual({
        externalId: CARD_ID,
        url: "https://trello.com/c/AbCd1234",
      });
    });

    it("links a comment to the comment on its card", () => {
      expect(
        trelloExecutor.parseResult(
          { id: "action-1", data: { card: { shortLink: "AbCd1234" } } },
          "add-comment",
        ),
      ).toEqual({
        externalId: "action-1",
        url: "https://trello.com/c/AbCd1234#comment-action-1",
      });
    });

    it("keeps a comment's id without a URL when the short link is missing", () => {
      expect(
        trelloExecutor.parseResult({ id: "action-1", data: {} }, "add-comment"),
      ).toEqual({ externalId: "action-1" });
    });

    it("returns null for an unexpected response", () => {
      expect(trelloExecutor.parseResult("ok", "create-card")).toBeNull();
    });
  });

  describe("listOptions", () => {
    const signal = new AbortController().signal;

    it("lists open boards", async () => {
      fetchMock.mockResolvedValueOnce(
        Response.json([{ id: BOARD_ID, name: "Work" }]),
      );

      await expect(
        trelloExecutor.listOptions(conn, "boardId", {}, { signal }),
      ).resolves.toEqual([{ value: BOARD_ID, label: "Work" }]);
      expect(getCall(0).url).toBe(
        "https://api.trello.com/1/members/me/boards?filter=open&fields=name",
      );
    });

    it.each([
      "listId",
      "destination",
    ])("lists the board's open lists for %s", async (argKey) => {
      fetchMock.mockResolvedValueOnce(
        Response.json([{ id: "list-1", name: "To do" }]),
      );

      await expect(
        trelloExecutor.listOptions(
          conn,
          argKey,
          { boardId: BOARD_ID },
          { signal },
        ),
      ).resolves.toEqual([{ value: "list-1", label: "To do" }]);
      expect(getCall(0).url).toBe(
        `https://api.trello.com/1/boards/${BOARD_ID}/lists?filter=open&fields=name`,
      );
    });

    it("names a label by its colour when it has no name", async () => {
      fetchMock.mockResolvedValueOnce(
        Response.json([
          { id: "label-1", name: "Urgent", color: "red" },
          { id: "label-2", name: "", color: "green" },
          { id: "label-3", name: "", color: null },
        ]),
      );

      await expect(
        trelloExecutor.listOptions(
          conn,
          "labelId",
          { boardId: BOARD_ID },
          { signal },
        ),
      ).resolves.toEqual([
        { value: "label-1", label: "Urgent" },
        { value: "label-2", label: "Green" },
        { value: "label-3", label: "No colour" },
      ]);
      expect(getCall(0).url).toBe(
        `https://api.trello.com/1/boards/${BOARD_ID}/labels?fields=name%2Ccolor`,
      );
    });

    it("lists the board's open cards", async () => {
      fetchMock.mockResolvedValueOnce(
        Response.json([{ id: CARD_ID, name: "Pay invoice" }, { bad: true }]),
      );

      await expect(
        trelloExecutor.listOptions(
          conn,
          "cardId",
          { boardId: BOARD_ID },
          { signal },
        ),
      ).resolves.toEqual([{ value: CARD_ID, label: "Pay invoice" }]);
      expect(getCall(0).url).toBe(
        `https://api.trello.com/1/boards/${BOARD_ID}/cards/open?fields=name`,
      );
    });

    it.each([
      ["an unknown arg", "memberId", { boardId: BOARD_ID }],
      ["a missing board", "listId", {}],
      ["a board id that is not a Trello id", "listId", { boardId: "a/b" }],
    ])("refuses %s without calling Trello", async (_, argKey, parents) => {
      await expect(
        trelloExecutor.listOptions(conn, argKey, parents, { signal }),
      ).rejects.toMatchObject({ kind: "permanent" });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("error classification", () => {
    it.each([
      [401, "invalid token", "auth"],
      [401, "expired token", "auth"],
      [401, "Token not found", "auth"],
      [401, "unauthorized card permission requested", "permanent"],
      [401, "unauthorized permission requested", "permanent"],
      [403, "forbidden", "permanent"],
      [400, "invalid id", "permanent"],
      [404, "model not found", "permanent"],
      [401, "something new", "permanent"],
      [500, "server error", "maybe_sent"],
    ])("classifies %i %s as %s", async (status, body, kind) => {
      fetchMock.mockResolvedValueOnce(new Response(body, { status }));

      await expect(runTool("create-card", {})).rejects.toMatchObject({ kind });
    });

    it("blames the server's API key, not the user's connection, for an invalid key", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response("invalid key", { status: 401 }),
      );

      const error = (await runTool("create-card", {}).catch(
        (caught) => caught,
      )) as IntegrationError;

      expect(error.kind).toBe("permanent");
      expect(error.providerMessage).toContain("TRELLO_API_KEY");
    });

    it("waits as long as Retry-After asks on a rate limit", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response("API_TOKEN_LIMIT_EXCEEDED", {
          status: 429,
          headers: { "retry-after": "3" },
        }),
      );

      await expect(runTool("create-card", {})).rejects.toMatchObject({
        kind: "rate_limit",
        retryAfterMs: 3000,
      });
    });

    it("treats a lookup failure as not sent", async () => {
      fetchMock.mockRejectedValueOnce(
        new TypeError("fetch failed", {
          cause: Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }),
        }),
      );

      await expect(runTool("create-card", {})).rejects.toMatchObject({
        kind: "not_sent",
      });
    });
  });

  function runTool(tool: string, payload: Record<string, unknown>) {
    return trelloExecutor.run(
      conn,
      { tool, payload },
      { signal: new AbortController().signal },
    );
  }

  function getCall(index: number) {
    const [url, init] = fetchMock.mock.calls[index];
    return {
      method: init?.method,
      url: String(url),
      ...(typeof init?.body === "string" && { body: JSON.parse(init.body) }),
    };
  }
});
