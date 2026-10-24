import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/__mocks__/prisma";
import {
  completeIntegrationTokenRedirectAction,
  startIntegrationTokenRedirectAction,
} from "@/utils/actions/integrations";
import { SafeError } from "@/utils/error";
import { oauthStateCookieOptions } from "@/utils/oauth/state";

const mocks = vi.hoisted(() => ({
  createTokenRedirect: vi.fn(),
  completeTokenRedirect: vi.fn(),
  cookieStore: {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/utils/prisma");
vi.mock("@/utils/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "user-1", email: "owner@example.com" },
    session: {},
  })),
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => mocks.cookieStore),
}));
vi.mock("@/utils/integrations/connection.server", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/utils/integrations/connection.server")
  >()),
  createTokenRedirect: mocks.createTokenRedirect,
  completeTokenRedirect: mocks.completeTokenRedirect,
}));

const COOKIE_NAME = "native-integration-state-fixture-redirect";

describe("startIntegrationTokenRedirectAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOwnedEmailAccount();
  });

  it("stores the signed state in the integration's cookie and returns the authorize url", async () => {
    mocks.createTokenRedirect.mockResolvedValue({
      url: "https://app.example.com/authorize?return=1",
      state: "signed-state",
      cookieName: COOKIE_NAME,
    });

    const result = await startIntegrationTokenRedirectAction("account-1", {
      integrationName: "fixture-redirect",
    });

    expect(result?.data).toEqual({
      url: "https://app.example.com/authorize?return=1",
    });
    expect(mocks.createTokenRedirect).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        emailAccountId: "account-1",
        integrationName: "fixture-redirect",
      }),
    );
    expect(mocks.cookieStore.set).toHaveBeenCalledWith(
      COOKIE_NAME,
      "signed-state",
      oauthStateCookieOptions,
    );
  });

  it("does not set a cookie when the redirect cannot be created", async () => {
    mocks.createTokenRedirect.mockRejectedValue(
      new SafeError("This app does not connect that way"),
    );

    const result = await startIntegrationTokenRedirectAction("account-1", {
      integrationName: "fixture-redirect",
    });

    expect(result?.serverError).toBe("This app does not connect that way");
    expect(mocks.cookieStore.set).not.toHaveBeenCalled();
  });

  it.each([
    "Fixture",
    "fixture;path=/",
    "fixture redirect",
    "../fixture",
    "-fixture",
    "a".repeat(65),
  ])("rejects an integration name that is not safe in a cookie name: %s", async (integrationName) => {
    const result = await startIntegrationTokenRedirectAction("account-1", {
      integrationName,
    });

    expect(result?.validationErrors).toBeDefined();
    expect(mocks.createTokenRedirect).not.toHaveBeenCalled();
    expect(mocks.cookieStore.set).not.toHaveBeenCalled();
  });
});

describe("completeIntegrationTokenRedirectAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOwnedEmailAccount();
    mocks.cookieStore.get.mockReturnValue({
      name: COOKIE_NAME,
      value: "cookie-state",
    });
  });

  it("deletes the state cookie before completing and passes its value through", async () => {
    mocks.completeTokenRedirect.mockResolvedValue(undefined);

    const result = await completeIntegrationTokenRedirectAction("account-1", {
      integrationName: "fixture-redirect",
      state: "signed-state",
      token: "redirect-token",
    });

    expect(result?.serverError).toBeUndefined();
    expect(mocks.cookieStore.get).toHaveBeenCalledWith(COOKIE_NAME);
    expect(mocks.cookieStore.delete).toHaveBeenCalledWith(COOKIE_NAME);
    expect(mocks.completeTokenRedirect).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        emailAccountId: "account-1",
        integrationName: "fixture-redirect",
        state: "signed-state",
        cookieState: "cookie-state",
        token: "redirect-token",
      }),
    );
    expect(mocks.cookieStore.delete.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.completeTokenRedirect.mock.invocationCallOrder[0],
    );
  });

  it("passes an undefined cookie state when the cookie is missing", async () => {
    mocks.cookieStore.get.mockReturnValue(undefined);
    mocks.completeTokenRedirect.mockRejectedValue(
      new SafeError("The connection link expired"),
    );

    const result = await completeIntegrationTokenRedirectAction("account-1", {
      integrationName: "fixture-redirect",
      state: "signed-state",
      token: "redirect-token",
    });

    expect(result?.serverError).toBe("The connection link expired");
    expect(mocks.completeTokenRedirect).toHaveBeenCalledWith(
      expect.objectContaining({ cookieState: undefined }),
    );
  });

  it("deletes the state cookie even when completion fails", async () => {
    mocks.completeTokenRedirect.mockRejectedValue(
      new SafeError("The app rejected that token"),
    );

    const result = await completeIntegrationTokenRedirectAction("account-1", {
      integrationName: "fixture-redirect",
      state: "signed-state",
      token: "redirect-token",
    });

    expect(result?.serverError).toBe("The app rejected that token");
    expect(mocks.cookieStore.delete).toHaveBeenCalledWith(COOKIE_NAME);
  });

  it("rejects an unsafe integration name before touching cookies", async () => {
    const result = await completeIntegrationTokenRedirectAction("account-1", {
      integrationName: "fixture;path=/",
      state: "signed-state",
      token: "redirect-token",
    });

    expect(result?.validationErrors).toBeDefined();
    expect(mocks.cookieStore.get).not.toHaveBeenCalled();
    expect(mocks.cookieStore.delete).not.toHaveBeenCalled();
    expect(mocks.completeTokenRedirect).not.toHaveBeenCalled();
  });
});

function mockOwnedEmailAccount() {
  prisma.emailAccount.findUnique.mockResolvedValue({
    email: "owner@example.com",
    account: { userId: "user-1", provider: "google" },
  } as never);
}
