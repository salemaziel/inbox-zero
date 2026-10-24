export const INTEGRATION_TOKEN_STORAGE_KEY = "integration-connect-token";

const CONNECT_PATH = /^\/[^/]+\/integrations\/connect\/[^/]+\/?$/;

// A token-redirect connect returns the token in the URL fragment. Runs before
// Sentry, PostHog and hydration so no telemetry ever records a URL holding it.
// Only the connect page needs the token; anywhere else (for example /login
// after an expired session carried the fragment along) it is dropped, and the
// user restarts the connect after signing in.
export function moveTokenFragmentToSessionStorage() {
  if (typeof window === "undefined") return;

  const token = getFragmentToken();
  if (token === null) return;

  const { pathname, search } = window.location;
  if (token && CONNECT_PATH.test(pathname)) {
    try {
      window.sessionStorage.setItem(INTEGRATION_TOKEN_STORAGE_KEY, token);
    } catch {
      // Storage can be unavailable (privacy modes). The URL is still cleared;
      // the connect page then asks the user to start again.
    }
  }

  window.history.replaceState(window.history.state, "", pathname + search);
}

// The fragment fallback covers the case where the early guard did not run.
export function takeIntegrationToken(): string | null {
  let stored: string | null = null;
  try {
    stored = window.sessionStorage.getItem(INTEGRATION_TOKEN_STORAGE_KEY);
    window.sessionStorage.removeItem(INTEGRATION_TOKEN_STORAGE_KEY);
  } catch {
    // Storage unavailable: fall through to the fragment.
  }
  return stored || getFragmentToken();
}

function getFragmentToken() {
  return new URLSearchParams(window.location.hash.slice(1)).get("token");
}
