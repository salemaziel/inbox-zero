import { internalDateToDate } from "@/utils/date";
import { TEMPLATE_VARIABLE_PATTERN } from "@/utils/template";
import type { ParsedMessage } from "@/utils/types";
import { getEmailUrlForOptionalMessage } from "@/utils/url";

export const PLACEHOLDER_NAMES = [
  "subject",
  "from",
  "to",
  "date",
  "snippet",
  "link",
  "ruleName",
] as const;

type PlaceholderName = (typeof PLACEHOLDER_NAMES)[number];

export type PlaceholderValues = Record<PlaceholderName, string>;

const MARKER_PATTERN = "\\[\\[ *([A-Za-z][A-Za-z0-9]*) *\\]\\]";

// Only the author-written parts count: markers inside {{…}} are never
// substituted at runtime, so they are neither valid nor invalid.
export function findUnknownPlaceholders(text: string): string[] {
  const unknown = new Set<string>();
  for (const literal of text.split(new RegExp(TEMPLATE_VARIABLE_PATTERN))) {
    for (const match of literal.matchAll(new RegExp(MARKER_PATTERN, "g"))) {
      if (!isPlaceholderName(match[1])) unknown.add(match[1]);
    }
  }
  return [...unknown];
}

export function buildPlaceholderValues({
  message,
  emailAccount,
  ruleName,
}: {
  message: Pick<
    ParsedMessage,
    "id" | "threadId" | "headers" | "snippet" | "internalDate" | "externalUrl"
  >;
  emailAccount: { email: string; account: { provider: string } };
  ruleName: string;
}): PlaceholderValues {
  return {
    subject: message.headers.subject ?? "",
    from: message.headers.from ?? "",
    to: message.headers.to ?? "",
    date: getMessageDate(message),
    snippet: message.snippet ?? "",
    link:
      getEmailUrlForOptionalMessage({
        messageId: message.id,
        threadId: message.threadId,
        emailAddress: emailAccount.email,
        provider: emailAccount.account.provider,
        externalUrl: message.externalUrl,
      }) ?? "",
    ruleName,
  };
}

// Markers are replaced only in the author-written parts, and each part is
// scanned once, so inserted values and AI output are never re-parsed.
export function renderIntegrationTextArg({
  template,
  aiVars,
  values,
}: {
  template: string;
  aiVars?: Record<`var${number}`, string>;
  values: PlaceholderValues;
}): string {
  const literalParts = template.split(new RegExp(TEMPLATE_VARIABLE_PATTERN));

  return literalParts
    .map((literal, index) => {
      const aiValue = index === 0 ? "" : aiVars?.[`var${index}`] || "";
      return aiValue + replacePlaceholders(literal, values);
    })
    .join("");
}

function replacePlaceholders(text: string, values: PlaceholderValues) {
  return text.replace(
    new RegExp(MARKER_PATTERN, "g"),
    (marker, name: string) => (isPlaceholderName(name) ? values[name] : marker),
  );
}

function isPlaceholderName(name: string): name is PlaceholderName {
  return (PLACEHOLDER_NAMES as readonly string[]).includes(name);
}

function getMessageDate(
  message: Pick<ParsedMessage, "headers" | "internalDate">,
) {
  const internalDate = internalDateToDate(message.internalDate, {
    fallbackToNow: false,
  });
  if (!Number.isNaN(internalDate.getTime())) return internalDate.toISOString();

  const headerDate = new Date(message.headers.date ?? "");
  if (!Number.isNaN(headerDate.getTime())) return headerDate.toISOString();

  return "";
}
