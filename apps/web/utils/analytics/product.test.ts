import { describe, expect, it } from "vitest";
import {
  getAppPageFromPathname,
  getAppPageViewProperties,
  getPageViewSearch,
  stripUntrackedUrlParams,
} from "@/utils/analytics/product";

describe("getPageViewSearch", () => {
  it("drops thread selection and search text but keeps the view", () => {
    expect(
      getPageViewSearch(
        new URLSearchParams(
          "type=inbox&thread-id=t1&thread-account-id=a1&side-panel-thread-id=t2&q=invoice&split=s1",
        ),
      ),
    ).toBe("type=inbox&split=s1");
  });

  it("is unchanged when only the open thread changes", () => {
    expect(
      getPageViewSearch(new URLSearchParams("type=inbox&thread-id=t1")),
    ).toBe(getPageViewSearch(new URLSearchParams("type=inbox&thread-id=t2")));
  });

  it("handles missing params", () => {
    expect(getPageViewSearch(null)).toBe("");
    expect(getPageViewSearch(new URLSearchParams("thread-id=t1"))).toBe("");
  });
});

describe("stripUntrackedUrlParams", () => {
  it("removes thread ids and search text from every URL PostHog attaches", () => {
    const event = stripUntrackedUrlParams({
      properties: {
        $current_url:
          "https://app.test/acc/mail?split=news&thread-id=t1&q=invoice",
        $referrer: "https://app.test/acc/mail?side-panel-thread-id=t2",
        event_name: "kept",
      },
      $set_once: {
        $initial_current_url: "https://app.test/acc/mail?q=refund",
      },
    });
    expect(event.properties).toEqual({
      $current_url: "https://app.test/acc/mail?split=news",
      $referrer: "https://app.test/acc/mail",
      event_name: "kept",
    });
    expect(event.$set_once).toEqual({
      $initial_current_url: "https://app.test/acc/mail",
    });
  });

  it("removes a redirected token fragment and the signed state from every URL PostHog attaches", () => {
    const tokenUrl =
      "https://app.test/acc/integrations/connect/app?state=signed#token=secret-token";
    const urls = {
      $current_url: tokenUrl,
      $referrer: tokenUrl,
      $initial_current_url: tokenUrl,
      $initial_referrer: tokenUrl,
      $session_entry_url: tokenUrl,
      $session_entry_referrer: tokenUrl,
    };
    const event = stripUntrackedUrlParams({
      properties: { ...urls },
      $set: { ...urls },
      $set_once: { ...urls },
    });

    const cleanUrl = "https://app.test/acc/integrations/connect/app";
    const cleanUrls = Object.fromEntries(
      Object.keys(urls).map((key) => [key, cleanUrl]),
    );
    expect(event.properties).toEqual(cleanUrls);
    expect(event.$set).toEqual(cleanUrls);
    expect(event.$set_once).toEqual(cleanUrls);
  });
});

describe("getAppPageViewProperties", () => {
  it("tracks the integrations page", () => {
    expect(
      getAppPageViewProperties({ pathname: "/acc/integrations" }),
    ).toMatchObject({ app_page: "integrations" });
  });

  it("does not track the page a redirected token lands on", () => {
    expect(
      getAppPageViewProperties({
        pathname: "/acc/integrations/connect/app",
        searchParams: new URLSearchParams("state=signed"),
      }),
    ).toBeNull();
  });
});

describe("getAppPageFromPathname", () => {
  it("tells shared conversations apart from their activity feed", () => {
    expect(getAppPageFromPathname("/shared")).toBe("shared_conversations");
    expect(getAppPageFromPathname("/shared/conv-1")).toBe(
      "shared_conversations",
    );
    expect(getAppPageFromPathname("/shared/activity")).toBe("shared_activity");
  });
});
