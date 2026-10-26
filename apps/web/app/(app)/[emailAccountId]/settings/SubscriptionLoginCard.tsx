"use client";

import { useState } from "react";
import useSWR from "swr";
import { useAction } from "next-safe-action/hooks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadingContent } from "@/components/LoadingContent";
import { toastError, toastSuccess } from "@/components/Toast";
import type { GetAiSubscriptionResponse } from "@/app/api/user/ai-subscription/route";
import {
  cancelAiSubscriptionLoginAction,
  disconnectAiSubscriptionAction,
  selectAiSubscriptionAction,
  startAiSubscriptionLoginAction,
  submitAiSubscriptionLoginCodeAction,
} from "@/utils/actions/ai-subscription";
import { Provider } from "@/utils/llms/config";
import { getActionErrorMessage } from "@/utils/error";

type SubscriptionEntry = GetAiSubscriptionResponse["providers"][number];

const ACTIVE_SESSION_STATUSES = ["starting", "waiting", "verifying"];

const PROVIDER_LABELS: Record<string, { title: string; account: string }> = {
  [Provider.CODEX_CLI]: {
    title: "Your ChatGPT subscription",
    account: "ChatGPT",
  },
  [Provider.CLAUDE_CODE]: {
    title: "Your Claude subscription",
    account: "Claude",
  },
};

export function SubscriptionLoginSection({
  refetchUser,
}: {
  refetchUser: () => void;
}) {
  const { data, isLoading, error, mutate } = useSWR<GetAiSubscriptionResponse>(
    "/api/user/ai-subscription",
    {
      refreshInterval: (latest) =>
        latest?.providers.some((entry) => isSessionActive(entry)) ? 3000 : 0,
    },
  );

  if (data && !data.enabled) return null;

  return (
    <LoadingContent loading={isLoading} error={error}>
      {data && (
        <div className="space-y-3 border-t pt-4">
          <div className="space-y-1">
            <h3 className="font-medium">Use your own AI subscription</h3>
            <p className="text-sm text-muted-foreground">
              {data.canUseServerLogin
                ? "Optional: connect your own ChatGPT or Claude plan instead of the server's."
                : "Connect your ChatGPT or Claude plan. The assistant runs on your own subscription, used only for you."}
            </p>
          </div>
          {data.providers.map((entry) => (
            <SubscriptionLoginCard
              key={entry.provider}
              entry={entry}
              isActiveProvider={data.activeProvider === entry.provider}
              refetch={() => {
                mutate();
                refetchUser();
              }}
            />
          ))}
        </div>
      )}
    </LoadingContent>
  );
}

function SubscriptionLoginCard({
  entry,
  isActiveProvider,
  refetch,
}: {
  entry: SubscriptionEntry;
  isActiveProvider: boolean;
  refetch: () => void;
}) {
  const { provider, login, session } = entry;
  const labels = PROVIDER_LABELS[provider];
  const [code, setCode] = useState("");

  const onError = ({
    error,
  }: {
    error: Parameters<typeof getActionErrorMessage>[0];
  }) => {
    toastError({ description: getActionErrorMessage(error) });
    refetch();
  };

  const start = useAction(startAiSubscriptionLoginAction, {
    onSuccess: refetch,
    onError,
  });
  const submitCode = useAction(submitAiSubscriptionLoginCodeAction, {
    onSuccess: () => {
      setCode("");
      refetch();
    },
    onError,
  });
  const cancel = useAction(cancelAiSubscriptionLoginAction, {
    onSuccess: refetch,
    onError,
  });
  const disconnect = useAction(disconnectAiSubscriptionAction, {
    onSuccess: () => {
      toastSuccess({ description: `${labels.account} account disconnected.` });
      refetch();
    },
    onError,
  });
  const select = useAction(selectAiSubscriptionAction, {
    onSuccess: () => {
      toastSuccess({
        description: `The assistant now uses your ${labels.account} subscription.`,
      });
      refetch();
    },
    onError,
  });

  const sessionActive = isSessionActive(entry);
  const isConnected = login?.status === "connected";

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{labels.title}</span>
          {isConnected && <Badge variant="success">Connected</Badge>}
          {login?.status === "needs-reconnect" && (
            <Badge variant="red">Needs reconnect</Badge>
          )}
          {isActiveProvider && isConnected && (
            <Badge variant="secondary">In use</Badge>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {sessionActive ? (
            <Button
              size="sm"
              variant="outline"
              loading={cancel.isExecuting}
              onClick={() => cancel.execute({ provider })}
            >
              Cancel
            </Button>
          ) : (
            <Button
              size="sm"
              variant={isConnected ? "outline" : "default"}
              loading={start.isExecuting}
              onClick={() => start.execute({ provider })}
            >
              {login ? "Reconnect" : "Connect"}
            </Button>
          )}
          {isConnected && !isActiveProvider && (
            <Button
              size="sm"
              loading={select.isExecuting}
              onClick={() => select.execute({ provider })}
            >
              Use this
            </Button>
          )}
          {login && (
            <Button
              size="sm"
              variant="ghost"
              loading={disconnect.isExecuting}
              onClick={() => disconnect.execute({ provider })}
            >
              Disconnect
            </Button>
          )}
        </div>
      </div>

      {sessionActive && (
        <div className="space-y-2 text-sm">
          {!session?.url && <p>Starting sign-in…</p>}

          {session?.url && (
            <p>
              1.{" "}
              <a
                href={session.url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium underline"
              >
                Open the {labels.account} sign-in page
              </a>{" "}
              and sign in with your own account.
            </p>
          )}

          {session?.deviceCode && (
            <>
              <p>
                2. Enter this code when asked:{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono">
                  {session.deviceCode}
                </code>
              </p>
              <p className="text-muted-foreground">
                If ChatGPT says device code sign-in is off, turn it on in your
                ChatGPT security settings and try again. This page updates when
                you're done.
              </p>
            </>
          )}

          {session?.needsCode && (
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                submitCode.execute({ code });
              }}
            >
              <Input
                type="text"
                name="subscriptionLoginCode"
                placeholder="2. Paste the code shown after you sign in"
                autoComplete="off"
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
              <Button
                type="submit"
                size="sm"
                loading={submitCode.isExecuting}
                disabled={!code.trim()}
              >
                Submit
              </Button>
            </form>
          )}

          {session?.status === "verifying" && <p>Finishing sign-in…</p>}
        </div>
      )}

      {!sessionActive && session?.error && (
        <p className="text-sm text-red-600">{session.error}</p>
      )}
      {!sessionActive && !session?.error && login?.lastError && (
        <p className="text-sm text-red-600">{login.lastError}</p>
      )}
    </div>
  );
}

function isSessionActive(entry: SubscriptionEntry) {
  return (
    !!entry.session && ACTIVE_SESSION_STATUSES.includes(entry.session.status)
  );
}
