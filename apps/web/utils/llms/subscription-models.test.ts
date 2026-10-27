import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Provider, SUBSCRIPTION_MODELS } from "@/utils/llms/config";

const { mockEnv, listCodexModels } = vi.hoisted(() => ({
  mockEnv: { CLI_LLM_ENABLED: true },
  listCodexModels: vi.fn(),
}));

vi.mock("@/env", () => ({ env: mockEnv }));
vi.mock("@/utils/llms/cli-provider", () => ({ listCodexModels }));

import {
  getSubscriptionModels,
  parseCodexModels,
} from "@/utils/llms/subscription-models";

// Trimmed from Codex 0.164.0's model/list response.
const CODEX_MODEL_LIST = [
  codexEntry("gpt-6.1-sol", "GPT-6.1-Sol", "low", true),
  codexEntry("gpt-6-astra", "GPT-6-Astra", "low", true),
  codexEntry("gpt-6.1-terra", "GPT-6.1 Terra", "low", true),
  { ...codexEntry("gpt-reserve", "GPT-Reserve", "medium"), hidden: true },
  codexEntry("gpt-6-luna", "GPT-6-Luna", "medium"),
];

describe("parseCodexModels", () => {
  it("keeps visible models in Codex's order with their levels, minus ultra", () => {
    const models = parseCodexModels(CODEX_MODEL_LIST);

    expect(models.map((m) => m.value)).toEqual([
      "gpt-6.1-sol",
      "gpt-6-astra",
      "gpt-6.1-terra",
      "gpt-6-luna",
    ]);
    expect(models[0]).toEqual({
      value: "gpt-6.1-sol",
      label: "GPT-6.1-Sol",
      description: "Description of gpt-6.1-sol",
      efforts: ["low", "medium", "high", "xhigh", "max"],
      defaultEffort: "low",
      weight: null,
    });
    expect(models[1].weight).toBe("heavy");
    expect(models[3]).toMatchObject({
      efforts: ["low", "medium", "high", "xhigh", "max"],
      defaultEffort: "medium",
      weight: "light",
    });
  });

  it("drops entries whose id isn't a plain model id", () => {
    const models = parseCodexModels([
      codexEntry("--config=evil", "Bad", "low"),
      codexEntry("gpt 6", "Space", "low"),
      null,
      "gpt-6-luna",
      { ...codexEntry("gpt-6-luna", "GPT-6-Luna", "medium"), model: undefined },
    ]);

    expect(models.map((m) => m.value)).toEqual(["gpt-6-luna"]);
  });
});

describe("getSubscriptionModels", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockEnv.CLI_LLM_ENABLED = true;
    clearCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lists Codex models from the CLI, including ones the built-in list lacks, and caches them", async () => {
    listCodexModels.mockResolvedValue(CODEX_MODEL_LIST);

    const first = await getSubscriptionModels(Provider.CODEX_CLI);
    const second = await getSubscriptionModels(Provider.CODEX_CLI);

    expect(first.map((m) => m.value)).toContain("gpt-6.1-terra");
    expect(second).toBe(first);
    expect(listCodexModels).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(6 * 60 * 60 * 1000 + 1);
    await getSubscriptionModels(Provider.CODEX_CLI);
    expect(listCodexModels).toHaveBeenCalledTimes(2);
  });

  it("falls back to the built-in Codex list when the CLI fails or lists nothing, and retries sooner", async () => {
    listCodexModels.mockRejectedValueOnce(new Error("codex not found"));

    const models = await getSubscriptionModels(Provider.CODEX_CLI);

    expect(models.map((m) => m.value)).toEqual(
      SUBSCRIPTION_MODELS[Provider.CODEX_CLI].models.map((m) => m.value),
    );
    expect(models.map((m) => m.value)).toContain("gpt-6.1-terra");

    listCodexModels.mockResolvedValueOnce([]);
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    expect(
      (await getSubscriptionModels(Provider.CODEX_CLI)).map((m) => m.value),
    ).toContain("gpt-6-luna");
    expect(listCodexModels).toHaveBeenCalledTimes(2);
  });

  it("shares one CLI lookup between calls that arrive together", async () => {
    listCodexModels.mockResolvedValue(CODEX_MODEL_LIST);

    await Promise.all([
      getSubscriptionModels(Provider.CODEX_CLI),
      getSubscriptionModels(Provider.CODEX_CLI),
    ]);

    expect(listCodexModels).toHaveBeenCalledTimes(1);
  });

  it("does not run the CLI when subscriptions are off, and keeps Claude's built-in list", async () => {
    mockEnv.CLI_LLM_ENABLED = false;

    const codex = await getSubscriptionModels(Provider.CODEX_CLI);
    const claude = await getSubscriptionModels(Provider.CLAUDE_CODE);

    expect(listCodexModels).not.toHaveBeenCalled();
    expect(codex.length).toBeGreaterThan(0);
    expect(claude.map((m) => m.value)).toEqual([
      "sonnet",
      "opus",
      "fable",
      "haiku",
    ]);
    expect(claude.find((m) => m.value === "haiku")?.efforts).toEqual([]);
    expect(await getSubscriptionModels(Provider.OPEN_AI)).toEqual([]);
  });
});

function codexEntry(
  id: string,
  displayName: string,
  defaultReasoningEffort: string,
  supportsUltra = false,
) {
  const levels = ["low", "medium", "high", "xhigh", "max"];
  if (supportsUltra) levels.push("ultra");
  return {
    id,
    model: id,
    displayName,
    description: `Description of ${id}`,
    hidden: false,
    supportedReasoningEfforts: levels.map((reasoningEffort) => ({
      reasoningEffort,
      description: reasoningEffort,
    })),
    defaultReasoningEffort,
    isDefault: id === "gpt-6.1-sol",
  };
}

function clearCache() {
  const store = globalThis as {
    inboxZeroCodexModels?: unknown;
    inboxZeroCodexModelsPending?: unknown;
  };
  store.inboxZeroCodexModels = undefined;
  store.inboxZeroCodexModelsPending = undefined;
}
