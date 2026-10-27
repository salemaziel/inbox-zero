import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Provider, SUBSCRIPTION_MODELS } from "@/utils/llms/config";

const { mockEnv, listCodexModels, getCodexModelListLogin } = vi.hoisted(() => ({
  mockEnv: { CLI_LLM_ENABLED: true },
  listCodexModels: vi.fn(),
  getCodexModelListLogin: vi.fn(),
}));

vi.mock("@/env", () => ({ env: mockEnv }));
vi.mock("@/utils/llms/cli-provider", () => ({
  listCodexModels,
  getCodexModelListLogin,
}));

const OWNER = { userId: "owner1", allowServerLogin: true };
const USER_A = { userId: "user-a", allowServerLogin: false };
const USER_B = { userId: "user-b", allowServerLogin: false };

import {
  getSubscriptionModels,
  parseCodexModels,
} from "@/utils/llms/subscription-models";

// Trimmed from Codex 0.164.0's `codex debug models` output, out of order.
const CODEX_MODEL_LIST = [
  codexEntry("gpt-6-luna", "GPT-6-Luna", "medium", 5),
  codexEntry("gpt-6.1-sol", "GPT-6.1-Sol", "low", 1, true),
  codexEntry("gpt-6.1-terra", "GPT-6.1 Terra", "low", 3, true),
  {
    ...codexEntry("gpt-reserve", "GPT-Reserve", "medium", 4),
    visibility: "hide",
  },
  codexEntry("gpt-6-astra", "GPT-6-Astra", "low", 2, true),
];

describe("parseCodexModels", () => {
  it("keeps listed models sorted by Codex's priority with their levels, minus ultra", () => {
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
      codexEntry("--config=evil", "Bad", "low", 1),
      codexEntry("gpt 6", "Space", "low", 1),
      null,
      "gpt-6-luna",
      codexEntry("gpt-6-luna", "GPT-6-Luna", "medium", 5),
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
    getCodexModelListLogin.mockImplementation(async (scope) =>
      scope.allowServerLogin ? "server" : "user",
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lists Codex models with the user's login, including ones the built-in list lacks, and caches them", async () => {
    listCodexModels.mockResolvedValue(CODEX_MODEL_LIST);

    const first = await getSubscriptionModels(Provider.CODEX_CLI, USER_A);
    const second = await getSubscriptionModels(Provider.CODEX_CLI, USER_A);

    expect(listCodexModels).toHaveBeenCalledWith(USER_A);
    expect(first.map((m) => m.value)).toContain("gpt-6.1-terra");
    expect(second).toBe(first);
    expect(listCodexModels).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(6 * 60 * 60 * 1000 + 1);
    await getSubscriptionModels(Provider.CODEX_CLI, USER_A);
    expect(listCodexModels).toHaveBeenCalledTimes(2);
  });

  it("keeps one list per user login and one shared by owners on the server login", async () => {
    listCodexModels.mockImplementation(async (scope) =>
      scope.userId === USER_B.userId
        ? [codexEntry("gpt-5.6-luna", "GPT-5.6-Luna", "medium", 9)]
        : CODEX_MODEL_LIST,
    );

    const a = await getSubscriptionModels(Provider.CODEX_CLI, USER_A);
    const b = await getSubscriptionModels(Provider.CODEX_CLI, USER_B);
    await getSubscriptionModels(Provider.CODEX_CLI, OWNER);
    await getSubscriptionModels(Provider.CODEX_CLI, {
      userId: "owner2",
      allowServerLogin: true,
    });

    expect(a.map((m) => m.value)).toContain("gpt-6.1-terra");
    expect(b.map((m) => m.value)).toEqual(["gpt-5.6-luna"]);
    // user A, user B, and once for both owners.
    expect(listCodexModels).toHaveBeenCalledTimes(3);
  });

  it("offers the built-in list without running the CLI when the user has no login to list with", async () => {
    getCodexModelListLogin.mockResolvedValue(null);

    const models = await getSubscriptionModels(Provider.CODEX_CLI, USER_A);

    expect(listCodexModels).not.toHaveBeenCalled();
    expect(models.map((m) => m.value)).toEqual(
      SUBSCRIPTION_MODELS[Provider.CODEX_CLI].models.map((m) => m.value),
    );
  });

  it("falls back to the built-in list when listing fails, keeps a list read earlier, and retries sooner", async () => {
    listCodexModels.mockResolvedValueOnce(null);

    const fallback = await getSubscriptionModels(Provider.CODEX_CLI, USER_A);
    expect(fallback.map((m) => m.value)).toEqual(
      SUBSCRIPTION_MODELS[Provider.CODEX_CLI].models.map((m) => m.value),
    );

    listCodexModels.mockResolvedValueOnce(CODEX_MODEL_LIST);
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    const listed = await getSubscriptionModels(Provider.CODEX_CLI, USER_A);

    listCodexModels.mockResolvedValueOnce(null);
    vi.advanceTimersByTime(6 * 60 * 60 * 1000 + 1);
    expect(await getSubscriptionModels(Provider.CODEX_CLI, USER_A)).toBe(
      listed,
    );
    expect(listCodexModels).toHaveBeenCalledTimes(3);
  });

  it("shares one CLI lookup per login between calls that arrive together", async () => {
    listCodexModels.mockResolvedValue(CODEX_MODEL_LIST);

    await Promise.all([
      getSubscriptionModels(Provider.CODEX_CLI, USER_A),
      getSubscriptionModels(Provider.CODEX_CLI, USER_A),
      getSubscriptionModels(Provider.CODEX_CLI, USER_B),
    ]);

    expect(listCodexModels).toHaveBeenCalledTimes(2);
  });

  it("does not run the CLI when subscriptions are off, and keeps Claude's built-in list", async () => {
    mockEnv.CLI_LLM_ENABLED = false;

    const codex = await getSubscriptionModels(Provider.CODEX_CLI, OWNER);
    const claude = await getSubscriptionModels(Provider.CLAUDE_CODE, OWNER);

    expect(listCodexModels).not.toHaveBeenCalled();
    expect(codex.length).toBeGreaterThan(0);
    expect(claude.map((m) => m.value)).toEqual([
      "sonnet",
      "opus",
      "fable",
      "haiku",
    ]);
    expect(claude.find((m) => m.value === "haiku")?.efforts).toEqual([]);
    expect(await getSubscriptionModels(Provider.OPEN_AI, OWNER)).toEqual([]);
  });
});

function codexEntry(
  slug: string,
  displayName: string,
  defaultReasoningLevel: string,
  priority: number,
  supportsUltra = false,
) {
  const levels = ["low", "medium", "high", "xhigh", "max"];
  if (supportsUltra) levels.push("ultra");
  return {
    slug,
    display_name: displayName,
    description: `Description of ${slug}`,
    visibility: "list",
    priority,
    supported_reasoning_levels: levels.map((effort) => ({
      effort,
      description: effort,
    })),
    default_reasoning_level: defaultReasoningLevel,
  };
}

function clearCache() {
  const store = globalThis as {
    inboxZeroCodexModels?: Map<string, unknown>;
    inboxZeroCodexModelsPending?: Map<string, unknown>;
  };
  store.inboxZeroCodexModels?.clear();
  store.inboxZeroCodexModelsPending?.clear();
}
