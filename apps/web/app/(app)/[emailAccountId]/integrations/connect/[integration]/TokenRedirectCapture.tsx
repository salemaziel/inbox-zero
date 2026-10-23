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

  // The token lives in the URL fragment and must be removed from the address
  // bar before anything else runs. The ref keeps the dev double-mount from
  // reading the already-cleared URL.
  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const state = new URLSearchParams(window.location.search).get("state");
    const token = new URLSearchParams(window.location.hash.slice(1)).get(
      "token",
    );
    window.history.replaceState(null, "", window.location.pathname);

    if (!state || !token) {
      setMissingParams(true);
      return;
    }

    execute({ integrationName, state, token });
  }, [execute, integrationName]);

  if (missingParams) {
    return (
      <div className="mt-8 space-y-4">
        <MutedText>
          The connection link was incomplete or has already been used. Start the
          connection again from the integrations page.
        </MutedText>
        <Button asChild variant="outline">
          <Link href={integrationsPath}>Back to integrations</Link>
        </Button>
      </div>
    );
  }

  return <MutedText className="mt-8">Finishing connection...</MutedText>;
}
