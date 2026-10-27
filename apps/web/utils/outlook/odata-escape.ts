/**
 * Escapes a string value for an OData string literal in a Graph SDK query
 * (`.filter()`, `.query({ $filter })`). Doubles single quotes, then
 * URL-encodes the result, because the Graph SDK puts query values into the URL
 * as-is and Graph URL-decodes them before parsing the filter: an unencoded
 * `%27` would arrive as a quote that ends the literal.
 *
 * Do not use it for values that go through URLSearchParams, which encodes them
 * again.
 *
 * @example
 * escapeODataString("O'Brien") // returns "O''Brien"
 * escapeODataString("a%27b") // returns "a%2527b"
 */
export function escapeODataString(value: string): string {
  if (typeof value !== "string") {
    return "";
  }
  return encodeURIComponent(value.replace(/'/g, "''"));
}
