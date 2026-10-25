import type { Breadcrumb, Event, ReplayFrameEvent } from "@sentry/nextjs";
import {
  CONTENT_FIELD_NAMES,
  normalizeRedactionFieldName,
  REDACTED_FIELD_NAMES,
  SENSITIVE_FIELD_NAMES,
} from "@/utils/redact-fields";

const REDACTED = "[redacted]";
const MAX_DEPTH = 10;

const REDACT_KEYS = new Set<string>(
  [
    ...REDACTED_FIELD_NAMES,
    ...CONTENT_FIELD_NAMES,
    ...SENSITIVE_FIELD_NAMES,
  ].map(normalizeRedactionFieldName),
);

// A token-redirect connect returns the token in the URL fragment and an OAuth
// style `state` in the query, so neither may leave the browser in a URL.
const DROPPED_QUERY_PARAMS = new Set(["state"]);
const BREADCRUMB_URL_KEYS = ["from", "to", "url"];
const SPAN_URL_KEYS = ["url", "url.full", "http.url", "http.target"];
const SPAN_QUERY_KEYS = ["url.query", "http.query"];
const SPAN_FRAGMENT_KEYS = ["url.fragment", "http.fragment"];
// Trello only accepts a token to revoke in the URL path (DELETE /1/tokens/{token}).
const PATH_TOKEN_PATTERN = /(\/1\/tokens\/)[^/?#\s]+/g;

// Sentry is a third party. Before sending an event, redact PII/secrets from the
// fields where captureException context and request data land. We redact (not
// hash) so this stays client- and edge-safe (no node:crypto). event.user.email
// is intentionally left alone: it is the authenticated user's own email, which
// the logging policy allows.
export function scrubSentryEvent<T extends Event>(event: T): T {
  if (event.extra) event.extra = redactPii(event.extra);
  if (event.contexts) event.contexts = redactPii(event.contexts);
  if (event.request) {
    const { data, headers, cookies } = event.request;
    if (data) event.request.data = redactPii(data);
    if (headers) event.request.headers = redactPii(headers);
    if (cookies) event.request.cookies = redactPii(cookies);
    if (event.request.url) {
      event.request.url = stripSensitiveUrlParts(event.request.url);
    }
    if (event.request.query_string) {
      event.request.query_string = stripSensitiveQuery(
        event.request.query_string,
      );
    }
  }
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb);
  }
  scrubSpanData(event.contexts?.trace?.data);
  for (const span of event.spans ?? []) scrubSpanData(span.data);
  // Instrumentations put the request URL into whichever span names and data
  // keys they like (url.path, next.span_name, ...), so a fixed key list misses
  // some. Redact the path token from every string instead.
  if (event.contexts) event.contexts = redactPathTokensDeep(event.contexts);
  if (event.spans) event.spans = redactPathTokensDeep(event.spans);
  if (event.transaction) {
    event.transaction = redactPathTokens(event.transaction);
  }
  // Replay events carry the visited page URLs (initial URL includes the hash).
  const replayUrls = (event as { urls?: unknown }).urls;
  if (Array.isArray(replayUrls)) {
    (event as { urls?: unknown }).urls = replayUrls.map(stripSensitiveUrlParts);
  }
  return event;
}

// Wired into Sentry.init as beforeSend / beforeSendTransaction across all
// runtimes. scrubSentryEvent is generic over the event type, so it instantiates
// to ErrorEvent / TransactionEvent at each call site (both share the scrubbed
// fields). Aliased rather than re-typed to avoid importing TransactionEvent,
// which @sentry/nextjs does not re-export.
export const beforeSend = scrubSentryEvent;
export const beforeSendTransaction = scrubSentryEvent;

// Breadcrumbs stay in the client buffer for the whole session and also feed
// session replay, so clean them before they are stored.
export function beforeBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  return scrubBreadcrumb(breadcrumb);
}

// Session replay records history navigations and network requests as span
// frames, and slow/multi click breadcrumbs with the page URL; none of these
// pass through beforeBreadcrumb or beforeSend.
export function beforeAddRecordingEvent(
  event: ReplayFrameEvent,
): ReplayFrameEvent {
  if (event.data.tag === "performanceSpan") {
    const payload = event.data.payload;
    payload.description = stripSensitiveUrlParts(payload.description);
    if (payload.data && "previous" in payload.data) {
      payload.data.previous = stripSensitiveUrlParts(payload.data.previous);
    }
  } else if (event.data.tag === "breadcrumb") {
    event.data.payload = scrubBreadcrumb(event.data.payload);
  }
  return event;
}

function redactPii<T>(value: T, depth = 0): T {
  if (depth > MAX_DEPTH || value === null || value === undefined) return value;

  if (Array.isArray(value)) {
    return value.map((item) => redactPii(item, depth + 1)) as T;
  }

  if (!isPlainObject(value)) return value;

  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    result[key] = REDACT_KEYS.has(normalizeRedactionFieldName(key))
      ? REDACTED
      : redactPii(nested, depth + 1);
  }
  return result as T;
}

function scrubBreadcrumb<T extends Breadcrumb>(breadcrumb: T): T {
  if (!breadcrumb.data) return redactPathTokensDeep(breadcrumb);
  const data = { ...breadcrumb.data };
  for (const key of BREADCRUMB_URL_KEYS) {
    if (key in data) data[key] = stripSensitiveUrlParts(data[key]);
  }
  return redactPathTokensDeep({ ...breadcrumb, data });
}

function scrubSpanData(data: Record<string, unknown> | undefined) {
  if (!data) return;
  for (const key of SPAN_URL_KEYS) {
    if (key in data) data[key] = stripSensitiveUrlParts(data[key]);
  }
  for (const key of SPAN_QUERY_KEYS) {
    if (key in data) data[key] = stripSensitiveQuery(data[key]);
  }
  for (const key of SPAN_FRAGMENT_KEYS) delete data[key];
}

// String splitting instead of URL parsing keeps relative and malformed URLs
// (and the rest of the URL's encoding) intact without throwing.
function stripSensitiveUrlParts<T>(url: T): T {
  if (typeof url !== "string") return url;
  const withoutFragment = redactPathTokens(url.split("#", 1)[0]);
  const queryStart = withoutFragment.indexOf("?");
  if (queryStart === -1) return withoutFragment as T;

  const base = withoutFragment.slice(0, queryStart);
  const query = withoutFragment
    .slice(queryStart + 1)
    .split("&")
    .filter((pair) => !DROPPED_QUERY_PARAMS.has(decodeQueryKey(pair)))
    .join("&");
  return (query ? `${base}?${query}` : base) as T;
}

function redactPathTokens(text: string) {
  return text.replace(PATH_TOKEN_PATTERN, `$1${REDACTED}`);
}

function redactPathTokensDeep<T>(value: T, depth = 0): T {
  if (typeof value === "string") return redactPathTokens(value) as T;
  if (depth > MAX_DEPTH) return value;
  if (Array.isArray(value)) {
    return value.map((item) => redactPathTokensDeep(item, depth + 1)) as T;
  }
  if (!isPlainObject(value)) return value;

  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    result[key] = redactPathTokensDeep(nested, depth + 1);
  }
  return result as T;
}

function stripSensitiveQuery<T>(query: T): T {
  if (typeof query !== "string") return query;
  const hasPrefix = query.startsWith("?");
  const cleaned = stripSensitiveUrlParts(hasPrefix ? query : `?${query}`);
  return (hasPrefix ? cleaned : cleaned.slice(1)) as T;
}

function decodeQueryKey(pair: string) {
  const key = pair.split("=", 1)[0].replace(/\+/g, " ");
  try {
    return decodeURIComponent(key);
  } catch {
    return key;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
