import "server-only";
import { env } from "@/env";
import { integrationFetch } from "@/utils/integrations/http";
import type { IntegrationCallResult } from "@/utils/integrations/result";
import {
  IntegrationError,
  type IntegrationErrorKind,
  type NativeIntegrationExecutor,
} from "@/utils/integrations/types";
import type { IntegrationArgOption } from "@/utils/mcp/tool-specs";

const API_BASE_URL = "https://api.trello.com/1";
const AUTHORIZE_URL = "https://trello.com/1/authorize";
const TRELLO_ID_PATTERN = /^[A-Za-z0-9]{1,64}$/;

// Trello answers 401 both for a dead token and for "this token can't see that
// board", so only the dead-token wording may deactivate the connection.
const DEAD_TOKEN_MESSAGES = [
  "invalid token",
  "expired token",
  "token not found",
];

const INVALID_KEY_MESSAGE =
  "invalid key: the server's Trello API key is wrong. Whoever runs this Inbox Zero server needs to fix TRELLO_API_KEY.";

export const trelloExecutor: NativeIntegrationExecutor = {
  isConfigured: () => !!env.TRELLO_API_KEY,

  buildAuthorizeUrl: ({ returnUrl }) => {
    const url = new URL(AUTHORIZE_URL);
    url.search = new URLSearchParams({
      key: getApiKey(),
      name: "Inbox Zero",
      scope: "read,write",
      expiration: "never",
      callback_method: "fragment",
      response_type: "token",
      return_url: returnUrl,
    }).toString();
    return url.toString();
  },

  run: async (conn, { tool, payload }, { signal }) => {
    switch (tool) {
      case "create-card":
        return trelloRequest(conn.accessToken, "POST", "/cards", {
          body: payload,
          signal,
        });
      case "add-comment": {
        const cardId = getTrelloId(payload.cardId);
        return trelloRequest(
          conn.accessToken,
          "POST",
          `/cards/${cardId}/actions/comments`,
          { body: { text: payload.text }, signal },
        );
      }
      case "move-card": {
        const { cardId, ...update } = payload;
        return trelloRequest(
          conn.accessToken,
          "PUT",
          `/cards/${getTrelloId(cardId)}`,
          { body: update, signal },
        );
      }
      default:
        throw permanentError(`Unknown Trello tool: ${tool}`);
    }
  },

  parseResult: (raw, tool) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const result = raw as Record<string, unknown>;
    if (typeof result.id !== "string") return null;

    if (tool === "add-comment") {
      const shortLink = getCommentCardShortLink(result.data);
      return {
        externalId: result.id,
        ...(shortLink && {
          url: `https://trello.com/c/${encodeURIComponent(shortLink)}#comment-${encodeURIComponent(result.id)}`,
        }),
      } satisfies IntegrationCallResult;
    }

    return {
      externalId: result.id,
      ...(typeof result.shortUrl === "string" && { url: result.shortUrl }),
    } satisfies IntegrationCallResult;
  },

  listOptions: async (conn, argKey, parents, { signal }) => {
    if (argKey === "boardId") {
      return toOptions(
        await trelloRequest(conn.accessToken, "GET", "/members/me/boards", {
          query: { filter: "open", fields: "name" },
          signal,
        }),
      );
    }

    if (!["listId", "destination", "labelId", "cardId"].includes(argKey)) {
      throw permanentError(`Unknown Trello option list: ${argKey}`);
    }

    const boardPath = `/boards/${getTrelloId(parents.boardId)}`;

    if (argKey === "labelId") {
      const labels = await trelloRequest(
        conn.accessToken,
        "GET",
        `${boardPath}/labels`,
        { query: { fields: "name,color" }, signal },
      );
      return toOptions(labels, getLabelName);
    }

    if (argKey === "cardId") {
      return toOptions(
        await trelloRequest(
          conn.accessToken,
          "GET",
          `${boardPath}/cards/open`,
          {
            query: { fields: "name" },
            signal,
          },
        ),
      );
    }

    return toOptions(
      await trelloRequest(conn.accessToken, "GET", `${boardPath}/lists`, {
        query: { filter: "open", fields: "name" },
        signal,
      }),
    );
  },

  testConnection: async ({ accessToken }, { signal }) => {
    await trelloRequest(accessToken, "GET", "/members/me", {
      query: { fields: "id" },
      signal,
    });
  },

  // Trello's only revoke form carries the token in the path; Sentry's URL
  // scrubbing redacts that segment.
  revoke: async (conn, { signal }) => {
    await trelloRequest(
      conn.accessToken,
      "DELETE",
      `/tokens/${encodeURIComponent(conn.accessToken)}`,
      { signal },
    );
  },
};

async function trelloRequest(
  token: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  {
    query,
    body,
    signal,
  }: {
    query?: Record<string, string>;
    body?: Record<string, unknown>;
    signal: AbortSignal;
  },
) {
  const url = `${API_BASE_URL}${path}${query ? `?${new URLSearchParams(query)}` : ""}`;

  return integrationFetch(
    url,
    {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `OAuth oauth_consumer_key="${getApiKey()}", oauth_token="${token}"`,
        ...(body && { "Content-Type": "application/json" }),
      },
      ...(body && { body: JSON.stringify(body) }),
      signal,
    },
    { classifyError },
  );
}

function classifyError(
  status: number,
  body: string,
): { kind: IntegrationErrorKind; providerMessage?: string } | undefined {
  const text = body.toLowerCase();

  if (status === 401) {
    if (text.includes("invalid key")) {
      return { kind: "permanent", providerMessage: INVALID_KEY_MESSAGE };
    }
    if (DEAD_TOKEN_MESSAGES.some((message) => text.includes(message))) {
      return { kind: "auth" };
    }
    return { kind: "permanent" };
  }

  if (status === 403) return { kind: "permanent" };
}

function getApiKey(): string {
  const key = env.TRELLO_API_KEY;
  if (!key) throw permanentError("Trello isn't set up on this server.");
  return key;
}

function getTrelloId(value: unknown): string {
  if (typeof value !== "string" || !TRELLO_ID_PATTERN.test(value)) {
    throw permanentError("Missing or invalid Trello id");
  }
  return value;
}

function getCommentCardShortLink(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return;
  const card = (data as { card?: unknown }).card;
  if (!card || typeof card !== "object") return;
  const shortLink = (card as { shortLink?: unknown }).shortLink;
  return typeof shortLink === "string" && shortLink ? shortLink : undefined;
}

function toOptions(
  raw: unknown,
  getLabel: (item: Record<string, unknown>) => string | undefined = (item) =>
    typeof item.name === "string" ? item.name : undefined,
): IntegrationArgOption[] {
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((item) => {
    if (!item || typeof item !== "object" || typeof item.id !== "string") {
      return [];
    }
    const label = getLabel(item);
    return label ? [{ value: item.id, label }] : [];
  });
}

function getLabelName(label: Record<string, unknown>): string {
  if (typeof label.name === "string" && label.name.trim()) return label.name;
  if (typeof label.color !== "string" || !label.color) return "No colour";
  return label.color.charAt(0).toUpperCase() + label.color.slice(1);
}

function permanentError(providerMessage: string) {
  return new IntegrationError({ kind: "permanent", providerMessage });
}
