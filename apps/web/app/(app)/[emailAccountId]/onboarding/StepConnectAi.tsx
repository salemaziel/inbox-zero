"use client";

import { useState } from "react";
import { ArrowRightIcon, ExternalLinkIcon, SparklesIcon } from "lucide-react";
import useSWR from "swr";
import { toastError } from "@/components/Toast";
import { PageHeading, TypographyP } from "@/components/Typography";
import { Button } from "@/components/ui/button";
import { IconCircle } from "@/app/(app)/[emailAccountId]/onboarding/IconCircle";
import type { GetAiSubscriptionResponse } from "@/app/api/user/ai-subscription/route";
import { useUser } from "@/hooks/useUser";
import { updateAiSettingsAction } from "@/utils/actions/settings";
import { DEFAULT_PROVIDER, Provider } from "@/utils/llms/config";
import { isSubscriptionProvider } from "@/utils/llms/subscription-config";

// The lightest model, so the shared daily requests go furthest.
const SHARED_AI_MODEL = "sonnet";

type AiStatus =
  | "loading"
  | "unknown"
  | "connected"
  | "shared"
  | "builtIn"
  | "missing";

const STATUS_COPY: Record<
  AiStatus,
  { detail: string; nextLabel: string; isSkip: boolean }
> = {
  loading: {
    detail: "Checking your AI settings…",
    nextLabel: "Continue",
    isSkip: false,
  },
  unknown: {
    detail:
      "We couldn't check your AI settings. Open Settings and look under AI Model to make sure your account is connected.",
    nextLabel: "Continue",
    isSkip: false,
  },
  connected: {
    detail:
      "Your AI is set up. You can check or change it anytime under AI Model in Settings.",
    nextLabel: "Continue",
    isSkip: false,
  },
  shared: {
    detail:
      "You're using the shared AI. Connect your own account anytime under AI Model in Settings to remove the daily limit.",
    nextLabel: "Continue",
    isSkip: false,
  },
  builtIn: {
    detail:
      "You can start right away with the built-in AI, or switch to your own account anytime under AI Model in Settings.",
    nextLabel: "Continue",
    isSkip: false,
  },
  missing: {
    detail:
      "Open Settings, go to AI Model, and connect your account. Then come back here to continue.",
    nextLabel: "Skip for now",
    isSkip: true,
  },
};

export function StepConnectAi({
  onNext,
  onSkip,
}: {
  onNext: () => void;
  onSkip: () => void;
}) {
  const {
    data: user,
    isLoading: isUserLoading,
    error: userError,
    mutate: mutateUser,
  } = useUser();
  const {
    data: subscriptions,
    isLoading: isSubscriptionsLoading,
    error: subscriptionsError,
    mutate: mutateSubscriptions,
  } = useSWR<GetAiSubscriptionResponse>("/api/user/ai-subscription");
  const [isEnablingShared, setIsEnablingShared] = useState(false);

  const status = getAiStatus({
    isLoading: isUserLoading || isSubscriptionsLoading,
    hasError:
      Boolean(userError || subscriptionsError) || !user || !subscriptions,
    aiProvider: user?.aiProvider,
    hasAiApiKey: Boolean(user?.hasAiApiKey),
    subscriptions,
  });
  const copy = STATUS_COPY[status];
  const isReady =
    status === "connected" || status === "shared" || status === "builtIn";
  const sharedAccess = subscriptions?.sharedAccess;

  const enableSharedAi = async () => {
    setIsEnablingShared(true);
    const res = await updateAiSettingsAction({
      aiProvider: Provider.CLAUDE_CODE,
      aiModel: SHARED_AI_MODEL,
    });
    setIsEnablingShared(false);
    if (res?.serverError) {
      toastError({ description: res.serverError });
      return;
    }
    await Promise.all([mutateUser(), mutateSubscriptions()]);
  };

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-slate-50 dark:bg-background px-4 py-8">
      <div className="flex max-w-md flex-col items-center text-center">
        <IconCircle size="lg" className="mx-auto mb-6">
          <SparklesIcon className="size-6" />
        </IconCircle>

        <PageHeading className="mb-3">Connect your AI account</PageHeading>
        <TypographyP className="mb-3 text-muted-foreground">
          {subscriptions?.hasDeploymentModel
            ? "The assistant works out of the box, or you can run it on your own AI account."
            : "The assistant runs on your own AI account, not one built into the app."}{" "}
          {subscriptions?.enabled
            ? "Sign in with your Claude or ChatGPT subscription, or paste an API key from Anthropic, OpenAI, Google and others."
            : "Paste an API key from Anthropic, OpenAI, Google and others."}
        </TypographyP>
        <TypographyP className="mb-8 text-muted-foreground" aria-live="polite">
          {copy.detail}
        </TypographyP>

        <div className="flex w-full max-w-xs flex-col gap-2">
          {status === "missing" && sharedAccess && (
            <Button
              className="w-full"
              loading={isEnablingShared}
              onClick={enableSharedAi}
            >
              Use the shared AI ({sharedAccess.dailyLimit} requests a day)
            </Button>
          )}
          <Button
            className="w-full"
            variant={isReady || sharedAccess ? "outline" : "default"}
            asChild
          >
            <a href="/settings" target="_blank" rel="noopener noreferrer">
              Open AI settings
              <ExternalLinkIcon className="ml-2 size-4" />
            </a>
          </Button>
          <Button
            className="w-full"
            variant={isReady ? "default" : "ghost"}
            disabled={status === "loading"}
            onClick={copy.isSkip ? onSkip : onNext}
          >
            {copy.nextLabel}
            <ArrowRightIcon className="ml-2 size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// Mirrors how the AI Model settings decide a provider is usable. A saved
// key or login is not proof the credentials still work.
function getAiStatus({
  isLoading,
  hasError,
  aiProvider,
  hasAiApiKey,
  subscriptions,
}: {
  isLoading: boolean;
  hasError: boolean;
  aiProvider: string | null | undefined;
  hasAiApiKey: boolean;
  subscriptions: GetAiSubscriptionResponse | undefined;
}): AiStatus {
  if (isLoading) return "loading";
  if (hasError || !subscriptions) return "unknown";

  if (isSubscriptionProvider(aiProvider)) {
    const entry = subscriptions.providers.find(
      (provider) => provider.provider === aiProvider,
    );
    if (subscriptions.enabled) {
      if (entry?.login?.status === "connected") return "connected";
      if (subscriptions.sharedAccess) return "shared";
      if (subscriptions.canUseServerLogin) return "connected";
    }
  } else if (aiProvider && aiProvider !== DEFAULT_PROVIDER && hasAiApiKey) {
    return "connected";
  }

  return subscriptions.hasDeploymentModel ? "builtIn" : "missing";
}
