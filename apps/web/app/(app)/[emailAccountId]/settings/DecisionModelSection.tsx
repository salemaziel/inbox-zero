"use client";

import { useState } from "react";
import { useAction } from "next-safe-action/hooks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item";
import { toastError, toastSuccess } from "@/components/Toast";
import { useUser } from "@/hooks/useUser";
import {
  updateDecisionModelApiKeyAction,
  updateDecisionModelSettingsAction,
} from "@/utils/actions/settings";
import type { SaveDecisionModelApiKeyBody } from "@/utils/actions/settings.validation";
import { getActionErrorMessage } from "@/utils/error";

export function DecisionModelSection() {
  const { data, mutate } = useUser();

  const { execute, isExecuting } = useAction(
    updateDecisionModelSettingsAction,
    {
      onSuccess: () => {
        toastSuccess({ description: "Settings updated!" });
      },
      onError: (error) => {
        toastError({
          description: getActionErrorMessage(error.error, {
            prefix: "Failed to update settings",
          }),
        });
      },
      onSettled: () => {
        mutate();
      },
    },
  );

  if (!data) return null;

  return (
    <>
      <Item size="sm">
        <ItemContent>
          <ItemTitle>Specialized decision model</ItemTitle>
          <ItemDescription>
            Use an optional decision model for rule matching and other
            structured decisions. Falls back to your AI model if unavailable.
          </ItemDescription>
        </ItemContent>
        <ItemActions>
          <Switch
            aria-label="Specialized decision model"
            checked={data.decisionModelEnabled}
            onCheckedChange={(decisionModelEnabled) => {
              mutate({ ...data, decisionModelEnabled }, false);
              execute({ decisionModelEnabled });
            }}
            disabled={isExecuting}
          />
        </ItemActions>
      </Item>
      {data.decisionModelEnabled &&
        DECISION_KEY_PROVIDERS.filter(
          ({ provider }) => provider === data.decisionModelProvider,
        ).map(({ provider, label, keysUrl }) => (
          <DecisionModelApiKey
            key={provider}
            provider={provider}
            label={label}
            keysUrl={keysUrl}
            hasKey={
              provider === "typesafe"
                ? data.hasDecisionTypesafeApiKey
                : data.hasDecisionOpenrouterApiKey
            }
            onSaved={() => mutate()}
          />
        ))}
    </>
  );
}

const DECISION_KEY_PROVIDERS: {
  provider: SaveDecisionModelApiKeyBody["provider"];
  label: string;
  keysUrl: string;
}[] = [
  {
    provider: "typesafe",
    label: "TypeSafe",
    keysUrl: "https://console.typesafe.ai/keys",
  },
  {
    provider: "openrouter",
    label: "OpenRouter",
    keysUrl: "https://openrouter.ai/settings/keys",
  },
];

// The key is write-only: the page only learns whether one is saved.
function DecisionModelApiKey({
  provider,
  label,
  keysUrl,
  hasKey,
  onSaved,
}: {
  provider: SaveDecisionModelApiKeyBody["provider"];
  label: string;
  keysUrl: string;
  hasKey: boolean;
  onSaved: () => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const { execute, isExecuting } = useAction(updateDecisionModelApiKeyAction, {
    onSuccess: ({ input }) => {
      setApiKey("");
      toastSuccess({
        description: input.apiKey ? "Key saved." : "Key removed.",
      });
    },
    onError: (error) => {
      toastError({
        description: getActionErrorMessage(error.error, {
          prefix: "Failed to save the key",
        }),
      });
    },
    onSettled: onSaved,
  });

  return (
    <Item size="sm">
      <ItemContent>
        <ItemTitle>
          Your own {label} key{" "}
          <Badge variant={hasKey ? "default" : "outline"}>
            {hasKey ? "Saved" : "Not set"}
          </Badge>
        </ItemTitle>
        <ItemDescription>
          Optional. Decisions run on your {label} account instead of this
          server's.{" "}
          <a
            href={keysUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            Get a {label} key
          </a>
        </ItemDescription>
        <form
          className="mt-2 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (apiKey.trim()) execute({ provider, apiKey });
          }}
        >
          <Input
            type="password"
            autoComplete="off"
            aria-label={`${label} key`}
            placeholder={hasKey ? "Enter a new key to replace it" : "Paste key"}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
          <Button
            type="submit"
            size="sm"
            disabled={!apiKey.trim()}
            loading={isExecuting}
          >
            {hasKey ? "Replace" : "Save"}
          </Button>
          {hasKey && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isExecuting}
              onClick={() => execute({ provider, apiKey: null })}
            >
              Remove
            </Button>
          )}
        </form>
      </ItemContent>
    </Item>
  );
}
