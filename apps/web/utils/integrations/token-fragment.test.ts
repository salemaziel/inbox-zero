/** @vitest-environment jsdom */

import { afterEach, describe, expect, it } from "vitest";
import {
  INTEGRATION_TOKEN_STORAGE_KEY,
  moveTokenFragmentToSessionStorage,
  takeIntegrationConnectDenied,
  takeIntegrationToken,
} from "./token-fragment";

const CONNECT_PATH = "/account-1/integrations/connect/trello";

afterEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("moveTokenFragmentToSessionStorage", () => {
  it("stores the token and clears the fragment on a connect path", () => {
    window.history.replaceState(
      null,
      "",
      `${CONNECT_PATH}?state=abc123#token=secret-token`,
    );

    moveTokenFragmentToSessionStorage();

    expect(window.sessionStorage.getItem(INTEGRATION_TOKEN_STORAGE_KEY)).toBe(
      "secret-token",
    );
    expect(window.location.hash).toBe("");
    expect(window.location.pathname).toBe(CONNECT_PATH);
    expect(window.location.search).toBe("?state=abc123");
  });

  it("clears the fragment without storing the token on any other path", () => {
    window.history.replaceState(null, "", "/login?next=%2Fmail#token=secret");

    moveTokenFragmentToSessionStorage();

    expect(window.sessionStorage.getItem(INTEGRATION_TOKEN_STORAGE_KEY)).toBe(
      null,
    );
    expect(window.location.hash).toBe("");
    expect(window.location.pathname).toBe("/login");
    expect(window.location.search).toBe("?next=%2Fmail");
  });

  it("drops the whole fragment when token sits next to other keys", () => {
    window.history.replaceState(
      null,
      "",
      `${CONNECT_PATH}?state=abc#expires=never&token=secret-token`,
    );

    moveTokenFragmentToSessionStorage();

    expect(window.sessionStorage.getItem(INTEGRATION_TOKEN_STORAGE_KEY)).toBe(
      "secret-token",
    );
    expect(window.location.hash).toBe("");
  });

  it("leaves the URL and storage alone when the fragment has no token key", () => {
    window.history.replaceState(null, "", `${CONNECT_PATH}?state=abc`);

    moveTokenFragmentToSessionStorage();

    expect(window.location.href).toBe(
      `http://localhost:3000${CONNECT_PATH}?state=abc`,
    );
    expect(window.sessionStorage.length).toBe(0);
  });

  it("records a denial, which carries an empty token and an error, and stores no token", () => {
    window.history.replaceState(
      null,
      "",
      `${CONNECT_PATH}?state=abc#token=&error=Token%20request%20rejected`,
    );

    moveTokenFragmentToSessionStorage();

    expect(window.location.hash).toBe("");
    expect(window.sessionStorage.getItem(INTEGRATION_TOKEN_STORAGE_KEY)).toBe(
      null,
    );
    expect(takeIntegrationToken()).toBe(null);
    expect(takeIntegrationConnectDenied()).toBe(true);
    expect(takeIntegrationConnectDenied()).toBe(false);
  });

  it("does not touch other fragment content", () => {
    window.history.replaceState(null, "", "/docs/page?tab=1#section-tokens=2");

    moveTokenFragmentToSessionStorage();

    expect(window.location.hash).toBe("#section-tokens=2");
    expect(window.location.search).toBe("?tab=1");
    expect(window.sessionStorage.length).toBe(0);
  });
});

describe("takeIntegrationToken", () => {
  it("returns the stored token once and removes it", () => {
    window.sessionStorage.setItem(INTEGRATION_TOKEN_STORAGE_KEY, "stored");

    expect(takeIntegrationToken()).toBe("stored");
    expect(window.sessionStorage.getItem(INTEGRATION_TOKEN_STORAGE_KEY)).toBe(
      null,
    );
    expect(takeIntegrationToken()).toBe(null);
  });

  it("falls back to the fragment when nothing was stored", () => {
    window.history.replaceState(null, "", `${CONNECT_PATH}#token=from-hash`);

    expect(takeIntegrationToken()).toBe("from-hash");
  });
});

describe("takeIntegrationConnectDenied", () => {
  it("is false after a normal connect", () => {
    window.history.replaceState(null, "", `${CONNECT_PATH}#token=secret-token`);
    moveTokenFragmentToSessionStorage();

    expect(takeIntegrationConnectDenied()).toBe(false);
  });

  it("falls back to the fragment when the early guard did not run", () => {
    window.history.replaceState(
      null,
      "",
      `${CONNECT_PATH}#token=&error=denied`,
    );

    expect(takeIntegrationConnectDenied()).toBe(true);
  });
});
