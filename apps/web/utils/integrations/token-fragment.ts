export const INTEGRATION_TOKEN_STORAGE_KEY = "integration-connect-token";
const INTEGRATION_DENIED_STORAGE_KEY = "integration-connect-denied";

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
  if (CONNECT_PATH.test(pathname) && (token || isFragmentDenial())) {
    try {
      window.sessionStorage.setItem(
        token ? INTEGRATION_TOKEN_STORAGE_KEY : INTEGRATION_DENIED_STORAGE_KEY,
        token || "1",
      );
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

// The user declined on the app's authorize page: it returns an empty token
// and an error instead of a token.
export function takeIntegrationConnectDenied(): boolean {
  let stored: string | null = null;
  try {
    stored = window.sessionStorage.getItem(INTEGRATION_DENIED_STORAGE_KEY);
    window.sessionStorage.removeItem(INTEGRATION_DENIED_STORAGE_KEY);
  } catch {
    // Storage unavailable: fall through to the fragment.
  }
  return !!stored || isFragmentDenial();
}

function isFragmentDenial() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  return !params.get("token") && params.has("error");
}

function getFragmentToken() {
  return new URLSearchParams(window.location.hash.slice(1)).get("token");
}
