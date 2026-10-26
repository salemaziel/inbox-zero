"use client";

import Link from "next/link";
import { BarChartIcon } from "lucide-react";
import { type SubmitHandler, useForm } from "react-hook-form";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { toastError, toastSuccess } from "@/components/Toast";
import { Input } from "@/components/Input";
import { zodResolver } from "@hookform/resolvers/zod";
import { LoadingContent } from "@/components/LoadingContent";
import { SettingsSection } from "@/components/SettingsSection";
import {
  saveAiSettingsBody,
  type SaveAiSettingsBody,
} from "@/utils/actions/settings.validation";
import { Select } from "@/components/Select";
import type { OpenAiModelsResponse } from "@/app/api/ai/models/route";
import type { GetAiSubscriptionResponse } from "@/app/api/user/ai-subscription/route";
import { AlertBasic, AlertError } from "@/components/Alert";
import {
  AI_TASK_MODEL_TYPES,
  aiTaskModelsSchema,
  DEFAULT_PROVIDER,
  getSubscriptionModelLabel,
  Provider,
  providerOptions,
  SUBSCRIPTION_MODELS,
} from "@/utils/llms/config";
import { useUser } from "@/hooks/useUser";
import { useAccount } from "@/providers/EmailAccountProvider";
import { prefixPath } from "@/utils/path";
import { updateAiSettingsAction } from "@/utils/actions/settings";
import {
  isSubscriptionSessionActive,
  SubscriptionConnection,
} from "@/app/(app)/[emailAccountId]/settings/SubscriptionLoginCard";

type TaskModelType = (typeof AI_TASK_MODEL_TYPES)[number];

const SUBSCRIPTION_PROVIDER_OPTIONS = [
  { label: "Claude (your subscription)", value: Provider.CLAUDE_CODE },
  { label: "ChatGPT (your subscription)", value: Provider.CODEX_CLI },
];

const TASK_LABELS: Record<TaskModelType, string> = {
  chat: "Chat",
  draft: "Drafts",
  default: "General",
  economy: "Background",
  nano: "Quick checks",
};

export function ModelSection() {
  const { emailAccountId } = useAccount();
  const { data, isLoading, error, mutate } = useUser();
  const {
    data: subscriptions,
    error: subscriptionsError,
    mutate: mutateSubscriptions,
  } = useSWR<GetAiSubscriptionResponse>("/api/user/ai-subscription", {
    refreshInterval: (latest) =>
      latest?.providers.some(isSubscriptionSessionActive) ? 3000 : 0,
  });

  const { data: dataModels, isLoading: isLoadingModels } =
    useSWR<OpenAiModelsResponse>(
      data?.hasAiApiKey && data.aiProvider === Provider.OPEN_AI
        ? "/api/ai/models"
        : null,
    );

  // The provider options depend on this, so wait for it (or its failure)
  // before the form reads its default values.
  const isLoadingSubscriptions = !subscriptions && !subscriptionsError;

  return (
    <SettingsSection>
      <LoadingContent
        loading={isLoading || isLoadingModels || isLoadingSubscriptions}
        error={error}
      >
        {data && (
          <ModelSectionForm
            key={data.aiProvider ?? DEFAULT_PROVIDER}
            aiProvider={data.aiProvider}
            aiModel={data.aiModel}
            aiTaskModels={data.aiTaskModels}
            hasAiApiKey={data.hasAiApiKey}
            models={dataModels}
            subscriptions={subscriptions?.enabled ? subscriptions : undefined}
            refetch={() => {
              mutate();
              mutateSubscriptions();
            }}
            emailAccountId={emailAccountId}
          />
        )}
      </LoadingContent>
    </SettingsSection>
  );
}

function ModelSectionForm(props: {
  aiProvider: string | null;
  aiModel: string | null;
  aiTaskModels: unknown;
  hasAiApiKey: boolean;
  models?: OpenAiModelsResponse;
  subscriptions?: GetAiSubscriptionResponse;
  refetch: () => void;
  emailAccountId: string;
}) {
  const { refetch, emailAccountId, subscriptions } = props;
  const initialProvider = (props.aiProvider ??
    DEFAULT_PROVIDER) as SaveAiSettingsBody["aiProvider"];
  const savedTaskModels = aiTaskModelsSchema.safeParse(
    props.aiTaskModels ?? {},
  );

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<SaveAiSettingsBody>({
    resolver: zodResolver(saveAiSettingsBody),
    defaultValues: {
      aiProvider: initialProvider,
      aiModel:
        props.aiModel ??
        (isSubscriptionProvider(initialProvider)
          ? SUBSCRIPTION_MODELS[initialProvider].defaultModel
          : ""),
      aiApiKey: undefined,
      aiTaskModels: savedTaskModels.success ? savedTaskModels.data : {},
    },
  });

  const aiProvider = watch("aiProvider");
  const aiModel = watch("aiModel");
  const aiApiKey = watch("aiApiKey");
  const aiTaskModels = watch("aiTaskModels");
  const hasStoredAiApiKey =
    props.hasAiApiKey && props.aiProvider === aiProvider;
  const hasAnyApiKey = !!aiApiKey || hasStoredAiApiKey;
  const isSubscription = isSubscriptionProvider(aiProvider);
  const subscriptionEntry = subscriptions?.providers.find(
    (entry) => entry.provider === aiProvider,
  );

  const mainProviderOptions = subscriptions
    ? [...providerOptions, ...SUBSCRIPTION_PROVIDER_OPTIONS]
    : providerOptions;

  const connectedProviders =
    subscriptions?.providers
      .filter((entry) => entry.login?.status === "connected")
      .map((entry) => entry.provider) ?? [];
  const taskProviderOptions = mainProviderOptions.filter(
    (option) =>
      (option.value === aiProvider && aiProvider !== DEFAULT_PROVIDER) ||
      connectedProviders.some((provider) => provider === option.value),
  );
  const isAllowedTaskProvider = (provider: string) =>
    taskProviderOptions.some((option) => option.value === provider);

  const onSubmit: SubmitHandler<SaveAiSettingsBody> = async (data) => {
    // Entries left on a provider that is no longer allowed (the main
    // provider changed or the account was disconnected) fall back to main.
    const allowedTaskModels = Object.fromEntries(
      Object.entries(data.aiTaskModels ?? {}).filter(
        ([, entry]) => entry && isAllowedTaskProvider(entry.provider),
      ),
    );
    const res = await updateAiSettingsAction({
      ...data,
      aiTaskModels: allowedTaskModels,
    });

    if (res?.serverError) {
      toastError({
        description: res.serverError,
      });
    } else {
      toastSuccess({
        description:
          "Settings updated! Please check it works on the Assistant page.",
      });
    }

    refetch();
  };

  const globalError = (errors as Record<string, { message?: string }>)[""];

  const modelSelectOptions = isSubscription
    ? SUBSCRIPTION_MODELS[aiProvider].models.map(({ label, value }) => ({
        label,
        value,
      }))
    : aiProvider === Provider.OPEN_AI && hasAnyApiKey
      ? props.models?.map((model) => ({
          label: model.id,
          value: model.id,
        })) || []
      : [];

  const getDefaultTaskModel = (provider: string) =>
    isSubscriptionProvider(provider)
      ? SUBSCRIPTION_MODELS[provider].defaultModel
      : aiModel;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="max-w-sm space-y-4">
      <Select
        label="Provider"
        options={mainProviderOptions}
        {...register("aiProvider", {
          onChange: (event) => {
            const provider = event.target.value;
            if (isSubscriptionProvider(provider)) {
              setValue("aiModel", SUBSCRIPTION_MODELS[provider].defaultModel);
            } else if (isSubscriptionProvider(aiProvider)) {
              setValue("aiModel", "");
            }
          },
        })}
        error={errors.aiProvider}
      />

      {aiProvider !== DEFAULT_PROVIDER && (
        <>
          {modelSelectOptions.length ? (
            <Select
              label="Model"
              options={modelSelectOptions}
              {...register("aiModel")}
              error={errors.aiModel}
            />
          ) : (
            <Input
              type="text"
              name="aiModel"
              label="Model"
              registerProps={register("aiModel")}
              error={errors.aiModel}
            />
          )}

          {isSubscription ? (
            <>
              {subscriptionEntry && subscriptions && (
                <SubscriptionConnection
                  entry={subscriptionEntry}
                  canUseServerLogin={subscriptions.canUseServerLogin}
                  refetch={refetch}
                />
              )}
              <p className="text-xs text-muted-foreground">
                Unless you pick otherwise below, background tasks and quick
                checks use{" "}
                {getSubscriptionModelLabel(
                  aiProvider,
                  SUBSCRIPTION_MODELS[aiProvider].fastModel,
                )}{" "}
                to save your plan's limits.
              </p>
            </>
          ) : (
            <Input
              type="password"
              name="aiApiKey"
              label="API Key"
              registerProps={register("aiApiKey")}
              error={errors.aiApiKey}
              placeholder={
                hasStoredAiApiKey
                  ? "Leave blank to keep the current key"
                  : undefined
              }
              explainText={
                hasStoredAiApiKey
                  ? "Leave this blank to keep the current API key, or enter a new key to replace it."
                  : undefined
              }
            />
          )}
        </>
      )}

      {(subscriptions || aiProvider !== DEFAULT_PROVIDER) && (
        <details className="space-y-3 rounded-md border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            Per task
          </summary>
          <p className="text-sm text-muted-foreground">
            Pick a different provider or model for some kinds of work. Tasks
            left on "Same as main" use the settings above. A subscription shows
            up here once it's connected.
          </p>
          {AI_TASK_MODEL_TYPES.map((type) => {
            const entry = aiTaskModels?.[type];
            const provider =
              entry && isAllowedTaskProvider(entry.provider)
                ? entry.provider
                : "";
            return (
              <div key={type} className="grid grid-cols-2 gap-2">
                <Select
                  name={`aiTaskModels.${type}.provider`}
                  label={TASK_LABELS[type]}
                  options={[
                    { label: "Same as main", value: "" },
                    ...taskProviderOptions,
                  ]}
                  value={provider}
                  onChange={(event) => {
                    const nextProvider = event.target.value;
                    setValue(
                      `aiTaskModels.${type}`,
                      nextProvider
                        ? {
                            provider: nextProvider,
                            model: getDefaultTaskModel(nextProvider),
                          }
                        : undefined,
                    );
                  }}
                />
                {provider &&
                  (isSubscriptionProvider(provider) ? (
                    <Select
                      label="Model"
                      options={SUBSCRIPTION_MODELS[provider].models.map(
                        ({ label, value }) => ({ label, value }),
                      )}
                      {...register(`aiTaskModels.${type}.model`)}
                      error={errors.aiTaskModels?.[type]?.model}
                    />
                  ) : (
                    <Input
                      type="text"
                      name={`aiTaskModels.${type}.model`}
                      label="Model"
                      registerProps={register(`aiTaskModels.${type}.model`)}
                      error={errors.aiTaskModels?.[type]?.model}
                    />
                  ))}
              </div>
            );
          })}
          {subscriptions?.providers
            .filter((entry) => entry.provider !== aiProvider)
            .map((entry) => (
              <SubscriptionConnection
                key={entry.provider}
                entry={entry}
                canUseServerLogin={subscriptions.canUseServerLogin}
                refetch={refetch}
              />
            ))}
        </details>
      )}

      {globalError?.message && (
        <AlertError title="Error saving" description={globalError.message} />
      )}

      {aiProvider === Provider.OPEN_AI &&
        hasAnyApiKey &&
        modelSelectOptions.length === 0 &&
        (hasStoredAiApiKey ? (
          <AlertError
            title="Invalid API Key"
            description="We couldn't validate your API key. Please try again."
          />
        ) : (
          <AlertBasic
            title="API Key"
            description="Click Save to view available models for your API key."
          />
        ))}

      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" loading={isSubmitting}>
          Save
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href={prefixPath(emailAccountId, "/usage")}>
            <BarChartIcon className="mr-2 size-4" />
            View usage
          </Link>
        </Button>
      </div>
    </form>
  );
}

function isSubscriptionProvider(
  provider: string,
): provider is Extract<keyof typeof SUBSCRIPTION_MODELS, string> {
  return provider in SUBSCRIPTION_MODELS;
}
