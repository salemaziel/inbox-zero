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
  type AiTaskModels,
  type AiTaskModelType,
  DEFAULT_PROVIDER,
  getRecommendedTaskModel,
  HIGH_VOLUME_TASK_TYPES,
  isCostlyTaskChoice,
  isSubscriptionProvider,
  type ModelWeight,
  parseAiTaskModels,
  Provider,
  providerOptions,
  type ReasoningEffort,
  reasoningEffortSchema,
  SUBSCRIPTION_MODELS,
  type SubscriptionModel,
  type SubscriptionProvider,
} from "@/utils/llms/config";
import { useUser } from "@/hooks/useUser";
import { useAccount } from "@/providers/EmailAccountProvider";
import { prefixPath } from "@/utils/path";
import { updateAiSettingsAction } from "@/utils/actions/settings";
import {
  isSubscriptionSessionActive,
  SubscriptionConnection,
} from "@/app/(app)/[emailAccountId]/settings/SubscriptionLoginCard";

const SUBSCRIPTION_PROVIDER_OPTIONS = [
  { label: "Claude (your subscription)", value: Provider.CLAUDE_CODE },
  { label: "ChatGPT (your subscription)", value: Provider.CODEX_CLI },
];

const TASK_LABELS: Record<AiTaskModelType, string> = {
  chat: "Chat",
  draft: "Drafts",
  default: "General",
  economy: "Background",
  nano: "Quick checks",
};

const EFFORT_LABELS: Record<ReasoningEffort, string> = {
  none: "None",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};

const WEIGHT_NOTES: Record<ModelWeight, string> = {
  light: "light on your limits",
  medium: "in between",
  heavy: "uses your limits fastest",
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
            aiReasoningEffort={data.aiReasoningEffort}
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
  aiReasoningEffort: string | null;
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
  const savedTaskModels = parseAiTaskModels(props.aiTaskModels).models;
  const savedEffort = reasoningEffortSchema.safeParse(props.aiReasoningEffort);
  const getModels = (provider: SubscriptionProvider): SubscriptionModel[] =>
    subscriptions?.models[provider] ?? [
      ...SUBSCRIPTION_MODELS[provider].models,
    ];
  const findModel = (provider: string, model: string | undefined) =>
    isSubscriptionProvider(provider)
      ? getModels(provider).find((m) => m.value === model)
      : undefined;
  // Background work starts on the light model with little thinking until the
  // user picks otherwise; getModel does the same for tasks with no entry,
  // against the same list.
  const getRecommended = (provider: string, type: AiTaskModelType) =>
    isSubscriptionProvider(provider)
      ? getRecommendedTaskModel(provider, type, getModels(provider))
      : null;
  const getRecommendedTaskModels = (provider: string): AiTaskModels =>
    Object.fromEntries(
      HIGH_VOLUME_TASK_TYPES.flatMap((type) => {
        const recommended = getRecommended(provider, type);
        return recommended ? [[type, { provider, ...recommended }]] : [];
      }),
    );
  const hasSavedTaskModels = Object.keys(savedTaskModels).length > 0;

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
      // A saved model missing from the current list is kept, not swapped.
      aiModel:
        isSubscriptionProvider(initialProvider) && !props.aiModel
          ? SUBSCRIPTION_MODELS[initialProvider].defaultModel
          : (props.aiModel ?? ""),
      aiApiKey: undefined,
      aiReasoningEffort: savedEffort.success ? savedEffort.data : null,
      aiTaskModels: hasSavedTaskModels
        ? savedTaskModels
        : getRecommendedTaskModels(initialProvider),
    },
  });

  const aiProvider = watch("aiProvider");
  const aiModel = watch("aiModel");
  const aiApiKey = watch("aiApiKey");
  const aiReasoningEffort = watch("aiReasoningEffort");
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

  // Owners may run any subscription on the server's own login.
  const usableSubscriptions =
    subscriptions?.providers
      .filter(
        (entry) =>
          subscriptions.canUseServerLogin ||
          entry.login?.status === "connected",
      )
      .map((entry) => entry.provider) ?? [];
  const taskProviderOptions = mainProviderOptions.filter(
    (option) =>
      (option.value === aiProvider && aiProvider !== DEFAULT_PROVIDER) ||
      usableSubscriptions.some((provider) => provider === option.value),
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
    ? withSavedModel(
        toModelOptions(getModels(aiProvider)),
        aiProvider === initialProvider ? props.aiModel : null,
      )
    : aiProvider === Provider.OPEN_AI && hasAnyApiKey
      ? props.models?.map((model) => ({
          label: model.id,
          value: model.id,
        })) || []
      : [];

  const mainModel = findModel(aiProvider, aiModel);

  const getDefaultTaskEntry = (provider: string, type: AiTaskModelType) => {
    if (!isSubscriptionProvider(provider)) return { provider, model: aiModel };
    const recommended = getRecommended(provider, type);
    return recommended
      ? { provider, ...recommended }
      : {
          provider,
          model: SUBSCRIPTION_MODELS[provider].defaultModel,
          reasoningEffort: null,
        };
  };

  // What a task with no entry runs on, named the same way the runtime picks it.
  const getNoEntryLabel = (type: AiTaskModelType) => {
    const recommended = getRecommended(aiProvider, type);
    if (!recommended) return "Same as main";
    const label =
      findModel(aiProvider, recommended.model)?.label ?? recommended.model;
    return recommended.reasoningEffort
      ? `Recommended (${label}, ${EFFORT_LABELS[recommended.reasoningEffort].toLowerCase()} thinking)`
      : `Recommended (${label})`;
  };
  const hasLightModel = !!getRecommended(aiProvider, "default");

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
            setValue("aiReasoningEffort", null);
            if (!hasSavedTaskModels) {
              setValue("aiTaskModels", getRecommendedTaskModels(provider));
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
              explainText={mainModel?.description ?? undefined}
              {...register("aiModel", {
                onChange: (event) => {
                  const next = findModel(aiProvider, event.target.value);
                  if (
                    aiReasoningEffort &&
                    !next?.efforts.includes(aiReasoningEffort)
                  ) {
                    setValue("aiReasoningEffort", null);
                  }
                },
              })}
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

          {mainModel && mainModel.efforts.length > 0 && (
            <Select
              label="Thinking"
              options={toEffortOptions(mainModel)}
              {...register("aiReasoningEffort", {
                setValueAs: (value) => value || null,
              })}
              error={errors.aiReasoningEffort}
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
                {hasLightModel
                  ? "This model runs chat and drafts. Work that runs on every email (general, background and quick checks) uses a lighter model unless you change it under Per task. "
                  : "This model runs all AI work unless you change it under Per task. "}
                More thinking gives better answers but is slower and uses more
                of your plan.
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
          {isSubscription && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setValue("aiTaskModels", {
                  ...aiTaskModels,
                  ...Object.fromEntries(
                    HIGH_VOLUME_TASK_TYPES.map((type) => [type, undefined]),
                  ),
                  ...getRecommendedTaskModels(aiProvider),
                })
              }
            >
              Use recommended settings for email work
            </Button>
          )}
          {AI_TASK_MODEL_TYPES.map((type) => {
            const entry = aiTaskModels?.[type];
            const provider =
              entry && isAllowedTaskProvider(entry.provider)
                ? entry.provider
                : "";
            const taskModel = entry
              ? findModel(provider, entry.model)
              : undefined;
            const showCostWarning =
              !!entry &&
              !!taskModel &&
              isCostlyTaskChoice({
                type,
                model: entry.model,
                reasoningEffort:
                  entry.reasoningEffort ?? taskModel.defaultEffort,
              });
            return (
              <div key={type} className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <Select
                    name={`aiTaskModels.${type}.provider`}
                    label={TASK_LABELS[type]}
                    options={[
                      { label: getNoEntryLabel(type), value: "" },
                      ...taskProviderOptions,
                    ]}
                    value={provider}
                    onChange={(event) => {
                      const nextProvider = event.target.value;
                      setValue(
                        `aiTaskModels.${type}`,
                        nextProvider
                          ? getDefaultTaskEntry(nextProvider, type)
                          : undefined,
                      );
                    }}
                  />
                  {provider &&
                    (isSubscriptionProvider(provider) ? (
                      <Select
                        label="Model"
                        options={withSavedModel(
                          toModelOptions(getModels(provider)),
                          savedTaskModels[type]?.provider === provider
                            ? savedTaskModels[type]?.model
                            : null,
                        )}
                        {...register(`aiTaskModels.${type}.model`, {
                          onChange: (event) => {
                            const next = findModel(
                              provider,
                              event.target.value,
                            );
                            const effort = entry?.reasoningEffort;
                            if (effort && !next?.efforts.includes(effort)) {
                              setValue(
                                `aiTaskModels.${type}.reasoningEffort`,
                                null,
                              );
                            }
                          },
                        })}
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
                {taskModel && taskModel.efforts.length > 0 && (
                  <div className="grid grid-cols-2 gap-2">
                    <div />
                    <Select
                      label="Thinking"
                      options={toEffortOptions(taskModel)}
                      {...register(`aiTaskModels.${type}.reasoningEffort`, {
                        setValueAs: (value) => value || null,
                      })}
                      error={errors.aiTaskModels?.[type]?.reasoningEffort}
                    />
                  </div>
                )}
                {showCostWarning && (
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    This runs on every new email. A heavier model or more
                    thinking here can use up your plan's limits fast.
                  </p>
                )}
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

function toModelOptions(models: SubscriptionModel[]) {
  return models.map(({ label, value, weight }) => ({
    label: weight ? `${label} (${WEIGHT_NOTES[weight]})` : label,
    value,
  }));
}

// A saved model missing from the current list (the list couldn't be read, or
// the plan changed) stays selectable instead of being swapped out.
function withSavedModel(
  options: { label: string; value: string }[],
  saved: string | null | undefined,
) {
  if (!saved || options.some((option) => option.value === saved)) {
    return options;
  }
  return [
    ...options,
    { label: `${saved} (not on your current list)`, value: saved },
  ];
}

function toEffortOptions(model: SubscriptionModel) {
  return [
    {
      label: model.defaultEffort
        ? `Default (${EFFORT_LABELS[model.defaultEffort]})`
        : "Default",
      value: "",
    },
    ...model.efforts.map((effort) => ({
      label: EFFORT_LABELS[effort],
      value: effort,
    })),
  ];
}
