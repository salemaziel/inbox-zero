// This file configures the initialization of Sentry on the client.
// The config you add here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { env } from "@/env";
import {
  beforeAddRecordingEvent,
  beforeBreadcrumb,
  beforeSend,
  beforeSendTransaction,
  scrubSentryEvent,
} from "@/utils/sentry-scrub";
import { installStaleDeploymentReload } from "@/utils/stale-deployment";
import {
  canUseTrackingCookies,
  subscribeToCookieConsent,
} from "@/utils/cookie-consent";
import { moveTokenFragmentToSessionStorage } from "@/utils/integrations/token-fragment";

// Must run before Sentry.init (and before PostHog, which starts after
// hydration) so no telemetry sees a URL that still holds a connect token.
moveTokenFragmentToSessionStorage();

const REPLAY_SESSION_SAMPLE_RATE = 0.1;

Sentry.init({
  dsn: env.NEXT_PUBLIC_SENTRY_DSN,

  // Adjust this value in production, or use tracesSampler for greater control
  tracesSampleRate: 0.1,

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,

  // Errors thrown by browser extensions, link scanners, and injected scripts.
  ignoreErrors: [/Object Not Found Matching Id:\d+, MethodName:\w+/],
  denyUrls: [/\/executors\/\d+\.js/],

  // Redact PII/secrets before sending to Sentry (third party).
  beforeSend,
  beforeSendTransaction,
  beforeBreadcrumb,

  // Session replay stores data in the browser, so it waits for cookie consent
  // where that is required.
  replaysOnErrorSampleRate: canUseTrackingCookies() ? 1.0 : 0,
  replaysSessionSampleRate: canUseTrackingCookies()
    ? REPLAY_SESSION_SAMPLE_RATE
    : 0,

  integrations: [
    Sentry.replayIntegration({
      maskAllText: true,
      blockAllMedia: true,
      beforeAddRecordingEvent,
    }),
  ],
});

// Replay events skip beforeSend, but carry the visited page URLs.
Sentry.getClient()?.on("postprocessEvent", (event) => {
  if (event.type === "replay_event") scrubSentryEvent(event);
});

if (!canUseTrackingCookies()) {
  const unsubscribe = subscribeToCookieConsent(() => {
    if (!canUseTrackingCookies()) return;

    unsubscribe();
    // Mirrors the sampling Sentry applies when consent exists at page load:
    // some sessions are recorded in full, the rest only around errors.
    const replay = Sentry.getReplay();
    if (Math.random() < REPLAY_SESSION_SAMPLE_RATE) replay?.start();
    else replay?.startBuffering();
  });
}

installStaleDeploymentReload();

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
