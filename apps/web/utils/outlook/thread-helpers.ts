import type { OutlookClient } from "@/utils/outlook/client";
import type { Logger } from "@/utils/logger";
import { runWithBoundedConcurrency } from "@/utils/async";
import { escapeODataString } from "@/utils/outlook/odata-escape";
import { resolveMicrosoftGraphNextLink } from "@/utils/outlook/page-token";
import { withMicrosoftGraphRetry } from "@/utils/outlook/retry";

const OUTLOOK_THREAD_WRITE_CONCURRENCY = 3;
const THREAD_MESSAGE_PAGE_SIZE = 100;
const MAX_THREAD_MESSAGE_PAGES = 50;
const GRAPH_ID_PATTERN = /^[A-Za-z0-9+/=_-]+$/;

// Thrown when a conversation can't be listed past its first page. Callers'
// fallbacks are for Graph rejecting the conversation filter itself; running
// them here would act on part of the thread and report success.
export class OutlookThreadPaginationError extends Error {
  statusCode?: unknown;
  status?: unknown;
  code?: unknown;
  body?: unknown;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "OutlookThreadPaginationError";
    // Keep the Graph error's status and code readable by retry and
    // rate-limit handling, which inspect the thrown error directly.
    const cause = options?.cause;
    if (cause && typeof cause === "object") {
      const { statusCode, status, code, body } = cause as Record<
        string,
        unknown
      >;
      Object.assign(this, { statusCode, status, code, body });
    }
  }
}

// Thrown for a thread ID that can't be a Graph conversation ID. Callers'
// fallbacks must not run: they would match nothing and report success.
export class InvalidOutlookThreadIdError extends Error {
  constructor() {
    super("Invalid Outlook thread ID");
    this.name = "InvalidOutlookThreadIdError";
  }
}

/**
 * Lists every message in a conversation, optionally limited to one folder.
 *
 * Graph pages /me/messages at 10 results by default, so reading only the first
 * page leaves the rest of a long thread untouched. Enumeration finishes before
 * callers mutate anything, because moving messages changes the paged result
 * set.
 */
export async function listThreadMessages<TMessage extends { id: string }>({
  client,
  threadId,
  select,
  folderId,
  logger,
}: {
  client: OutlookClient;
  threadId: string;
  select: string;
  folderId?: string;
  logger: Logger;
}): Promise<TMessage[]> {
  // Messages without a conversation carry an empty thread ID; there is
  // nothing to list for them.
  if (!threadId) return [];
  // Graph conversation IDs are base64 or base64url. Anything else is not a
  // real thread, and callers mutate whatever this returns.
  if (!GRAPH_ID_PATTERN.test(threadId)) throw new InvalidOutlookThreadIdError();

  const conversationFilter = `conversationId eq '${escapeODataString(threadId)}'`;
  const filter = folderId
    ? `${conversationFilter} and parentFolderId eq '${escapeODataString(folderId)}'`
    : conversationFilter;

  type MessagePage = {
    value: (TMessage & { conversationId?: string | null })[];
    "@odata.nextLink"?: string;
  };
  const selectFields = select.split(",").includes("conversationId")
    ? select
    : `${select},conversationId`;
  let page: MessagePage = await withMicrosoftGraphRetry(
    () =>
      client
        .getClient()
        .api("/me/messages")
        .filter(filter)
        .select(selectFields)
        .top(THREAD_MESSAGE_PAGE_SIZE)
        .get(),
    logger,
  );

  const messages = new Map<string, TMessage>();
  const visitedPages = new Set<string>();
  let otherConversationCount = 0;
  while (true) {
    for (const message of page.value) {
      // Callers trash, archive, or relabel every message returned, so a
      // filter Graph read more broadly than intended must not reach them.
      if (message.conversationId && message.conversationId !== threadId) {
        otherConversationCount++;
        continue;
      }
      if (message.id) messages.set(message.id, message);
    }

    const nextPageToken = page["@odata.nextLink"];
    if (!nextPageToken) break;
    page = await getNextThreadMessagePage<MessagePage>({
      client,
      nextPageToken,
      visitedPages,
      logger,
    });
  }

  if (otherConversationCount > 0) {
    logger.warn("Dropped messages from other conversations in thread listing", {
      otherConversationCount,
    });
  }

  return [...messages.values()];
}

export async function runThreadMessageMutation({
  messageIds,
  threadId,
  logger,
  messageHandler,
  failureMessage,
  continueOnError = false,
  throwIfAllFail = false,
}: {
  messageIds: string[];
  threadId: string;
  logger: Logger;
  messageHandler: (messageId: string) => Promise<unknown>;
  failureMessage: string;
  continueOnError?: boolean;
  throwIfAllFail?: boolean;
}) {
  if (messageIds.length === 0) return;

  const results = await runWithBoundedConcurrency({
    items: messageIds,
    concurrency: OUTLOOK_THREAD_WRITE_CONCURRENCY,
    run: (messageId) => messageHandler(messageId),
  });

  const failures = results.filter(
    (
      entry,
    ): entry is {
      item: string;
      result: PromiseRejectedResult;
    } => entry.result.status === "rejected",
  );

  for (const failure of failures) {
    logger.warn(failureMessage, {
      threadId,
      messageId: failure.item,
      error: failure.result.reason,
    });
  }

  const firstFailure = failures[0];
  if (!firstFailure) return;
  const reason = firstFailure.result.reason;
  const error = reason instanceof Error ? reason : new Error(String(reason));

  if (!continueOnError) {
    throw error;
  }
  if (throwIfAllFail && failures.length === messageIds.length) {
    throw error;
  }
}

/**
 * Fetches messages by conversationId and applies an operation to each.
 * Used as a fallback when the OData $filter approach fails.
 */
export async function processThreadMessagesFallback({
  client,
  threadId,
  logger,
  messageHandler,
  noMessagesMessage,
  throwIfAllFail = false,
}: {
  client: OutlookClient;
  threadId: string;
  logger: Logger;
  messageHandler: (messageId: string) => Promise<unknown>;
  noMessagesMessage: string;
  throwIfAllFail?: boolean;
}) {
  const messages = await client
    .getClient()
    .api("/me/messages")
    .select("id,conversationId")
    .get();

  const threadMessages = messages.value.filter(
    (message: { conversationId: string }) =>
      message.conversationId === threadId,
  );

  if (threadMessages.length > 0) {
    await runThreadMessageMutation({
      messageIds: threadMessages.map((message: { id: string }) => message.id),
      threadId,
      logger,
      messageHandler,
      failureMessage: "Failed to process message in thread fallback",
      continueOnError: true,
      throwIfAllFail,
    });
  } else {
    logger.warn(noMessagesMessage, { threadId });
  }
}

async function getNextThreadMessagePage<TPage>({
  client,
  nextPageToken,
  visitedPages,
  logger,
}: {
  client: OutlookClient;
  nextPageToken: string;
  visitedPages: Set<string>;
  logger: Logger;
}): Promise<TPage> {
  try {
    const nextLink = resolveMicrosoftGraphNextLink(nextPageToken);
    if (
      !nextLink ||
      visitedPages.has(nextLink) ||
      visitedPages.size >= MAX_THREAD_MESSAGE_PAGES
    ) {
      throw new Error("Unable to complete Outlook thread pagination");
    }
    visitedPages.add(nextLink);
    return await withMicrosoftGraphRetry(
      () => client.getClient().api(nextLink).get(),
      logger,
    );
  } catch (error) {
    throw new OutlookThreadPaginationError(
      error instanceof Error ? error.message : String(error),
      { cause: error },
    );
  }
}
