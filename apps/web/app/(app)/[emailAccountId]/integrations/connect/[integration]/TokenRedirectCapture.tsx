"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { Button } from "@/components/ui/button";
import { MutedText } from "@/components/Typography";
import { toastError, toastSuccess } from "@/components/Toast";
import { useIntegrations } from "@/hooks/useIntegrations";
import { useAccount } from "@/providers/EmailAccountProvider";
import { completeIntegrationTokenRedirectAction } from "@/utils/actions/integrations";
import { getActionErrorMessage } from "@/utils/error";
import {
  takeIntegrationConnectDenied,
  takeIntegrationToken,
} from "@/utils/integrations/token-fragment";
import { findIntegration } from "@/utils/mcp/integrations";
import { prefixPath } from "@/utils/path";

export function TokenRedirectCapture({
  integrationName,
}: {
  integrationName: string;
}) {
  const router = useRouter();
  const { emailAccountId } = useAccount();
  const { mutate } = useIntegrations();
  const [missingParams, setMissingParams] = useState(false);
  const [denied, setDenied] = useState(false);
  const started = useRef(false);

  const integrationsPath = prefixPath(emailAccountId, "/integrations");

  const { execute } = useAction(
    completeIntegrationTokenRedirectAction.bind(null, emailAccountId),
    {
      onSuccess: () => {
        mutate();
        toastSuccess({ description: "Integration connected" });
        router.replace(integrationsPath);
      },
      onError: (error) => {
        toastError({
          title: "Could not connect the integration",
          description: getActionErrorMessage(error.error),
        });
        router.replace(integrationsPath);
      },
    },
  );

  // instrumentation-client moves the token out of the URL fragment into
  // session storage before hydration; reading it also removes it. The ref keeps
  // the dev double-mount from running a second time with nothing left to read.
  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const state = new URLSearchParams(window.location.search).get("state");
    const token = takeIntegrationToken();
    const wasDenied = takeIntegrationConnectDenied();
    window.history.replaceState(null, "", window.location.pathname);

    if (!token && wasDenied) {
      setDenied(true);
      return;
    }

    if (!state || !token) {
      setMissingParams(true);
      return;
    }

    execute({ integrationName, state, token });
  }, [execute, integrationName]);

  if (missingParams || denied) {
    const displayName =
      findIntegration(integrationName)?.displayName ?? "The app";

    return (
      <div className="mt-8 space-y-4">
        <MutedText>
          {denied
            ? `${displayName} didn't grant access, so nothing was connected. Start again from the integrations page if you want to connect it.`
            : "The connection link was incomplete or has already been used. Start the connection again from the integrations page."}
        </MutedText>
        <Button asChild variant="outline">
          <Link href={integrationsPath}>Back to integrations</Link>
        </Button>
      </div>
    );
  }

  return <MutedText className="mt-8">Finishing connection...</MutedText>;
}
