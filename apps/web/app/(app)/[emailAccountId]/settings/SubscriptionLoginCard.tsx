"use client";

import { useState } from "react";
import { useAction } from "next-safe-action/hooks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toastError, toastSuccess } from "@/components/Toast";
import type { GetAiSubscriptionResponse } from "@/app/api/user/ai-subscription/route";
import {
  cancelAiSubscriptionLoginAction,
  disconnectAiSubscriptionAction,
  startAiSubscriptionLoginAction,
  submitAiSubscriptionLoginCodeAction,
} from "@/utils/actions/ai-subscription";
import { Provider } from "@/utils/llms/config";
import { getActionErrorMessage } from "@/utils/error";

export type SubscriptionEntry = GetAiSubscriptionResponse["providers"][number];

const ACTIVE_SESSION_STATUSES = ["starting", "waiting", "verifying"];

const ACCOUNT_LABELS: Record<string, string> = {
  [Provider.CODEX_CLI]: "ChatGPT",
  [Provider.CLAUDE_CODE]: "Claude",
};

// Stands in for the API key field when the provider is the user's own
// ChatGPT or Claude subscription.
export function SubscriptionConnection({
  entry,
  canUseServerLogin,
  refetch,
}: {
  entry: SubscriptionEntry;
  canUseServerLogin: boolean;
  refetch: () => void;
}) {
  const { provider, login, session } = entry;
  const account = ACCOUNT_LABELS[provider];
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
      toastSuccess({ description: `${account} account disconnected.` });
      refetch();
    },
    onError,
  });

  const sessionActive = isSubscriptionSessionActive(entry);
  const isConnected = login?.status === "connected";

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{account} account</p>
      <div className="flex flex-wrap items-center gap-2">
        {isConnected && <Badge variant="success">Connected</Badge>}
        {login?.status === "needs-reconnect" && (
          <Badge variant="red">Needs reconnect</Badge>
        )}
        {sessionActive ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            loading={cancel.isExecuting}
            onClick={() => cancel.execute({ provider })}
          >
            Cancel
          </Button>
        ) : (
          !isConnected && (
            <Button
              type="button"
              size="sm"
              loading={start.isExecuting}
              onClick={() => start.execute({ provider })}
            >
              {login ? "Reconnect" : "Connect"}
            </Button>
          )
        )}
        {login && !sessionActive && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            loading={disconnect.isExecuting}
            onClick={() => disconnect.execute({ provider })}
          >
            Disconnect
          </Button>
        )}
      </div>

      {!login && !sessionActive && (
        <p className="text-sm text-muted-foreground">
          {canUseServerLogin
            ? `Optional: connect your own ${account} plan instead of the server's.`
            : `Connect your ${account} plan. The assistant runs on your own subscription, used only for you.`}
        </p>
      )}

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
                Open the {account} sign-in page
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
            <div className="flex gap-2">
              <Input
                type="text"
                name="subscriptionLoginCode"
                placeholder="2. Paste the code shown after you sign in"
                autoComplete="off"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                onKeyDown={(event) => {
                  // This sits inside the settings form; Enter must submit
                  // the code, not the form.
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  if (code.trim()) submitCode.execute({ code });
                }}
              />
              <Button
                type="button"
                size="sm"
                loading={submitCode.isExecuting}
                disabled={!code.trim()}
                onClick={() => submitCode.execute({ code })}
              >
                Submit
              </Button>
            </div>
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

export function isSubscriptionSessionActive(entry: SubscriptionEntry) {
  return (
    !!entry.session && ACTIVE_SESSION_STATUSES.includes(entry.session.status)
  );
}
