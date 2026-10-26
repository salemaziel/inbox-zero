import {
  INTEGRATION_TOOL_SPECS,
  type IntegrationArgSpec,
  type IntegrationToolSpec,
} from "@/utils/mcp/tool-specs";

export type IntegrationToolChoice = {
  integration: string;
  tool: string;
  label: string;
  disabledReason?: string;
};

/**
 * Tools whose app the user can use: connected apps are selectable, available
 * but unconnected apps are listed disabled, and anything else is left out.
 * `integrations` is the Integrations page list, which holds only available apps.
 */
export function getIntegrationToolChoices({
  integrations,
  specs = INTEGRATION_TOOL_SPECS,
}: {
  integrations: readonly {
    name: string;
    displayName: string;
    connection?: { isActive: boolean } | null;
  }[];
  specs?: readonly IntegrationToolSpec[];
}): IntegrationToolChoice[] {
  return specs.flatMap((spec) => {
    const app = integrations.find(
      (integration) => integration.name === spec.integration,
    );
    if (!app) return [];

    return [
      {
        integration: spec.integration,
        tool: spec.tool,
        label: spec.actionLabel,
        ...(!app.connection?.isActive && {
          disabledReason: `Connect ${app.displayName} first`,
        }),
      },
    ];
  });
}

/**
 * Keys to wipe from the stored args when `changedKey` changes: every arg that
 * depends on it, directly or through another dependent, plus their display
 * companions. A stale child value would otherwise point into the old parent.
 */
export function getArgsToClear(
  spec: IntegrationToolSpec,
  changedKey: string,
): string[] {
  const cleared = new Set<string>();
  const queue = [changedKey];

  for (const parentKey of queue) {
    for (const arg of spec.args) {
      if (cleared.has(arg.key) || arg.key === changedKey) continue;
      if (!getDependsOn(arg).includes(parentKey)) continue;

      cleared.add(arg.key);
      queue.push(arg.key);
    }
  }

  return spec.args.flatMap((arg) => {
    if (!cleared.has(arg.key)) return [];
    return arg.displayValueKey ? [arg.key, arg.displayValueKey] : [arg.key];
  });
}

/**
 * The parent values needed to load an arg's options, or null while any parent
 * is unset (the select stays disabled until then). A parent with no stored
 * value counts as its default, which is what the editor shows for it.
 */
export function getParentValues(
  spec: IntegrationToolSpec,
  arg: IntegrationArgSpec,
  storedArgs: Record<string, unknown> | null | undefined,
): Record<string, string> | null {
  const parents: Record<string, string> = {};

  for (const key of getDependsOn(arg)) {
    const stored = storedArgs?.[key];
    const value =
      typeof stored === "string" && stored.trim()
        ? stored
        : spec.args.find((candidate) => candidate.key === key)?.defaultValue;
    if (!value?.trim()) return null;
    parents[key] = value;
  }

  return parents;
}

function getDependsOn(arg: IntegrationArgSpec): readonly string[] {
  return arg.control.type === "remote-select"
    ? (arg.control.dependsOn ?? [])
    : [];
}
