import {
  INTEGRATION_TOOL_SPECS,
  type IntegrationArgSpec,
  type IntegrationToolSpec,
} from "@/utils/mcp/tool-specs";

export type IntegrationToolChoice = {
  integration: string;
  tool: string;
  label: string;
};

export function getIntegrationToolChoices(
  specs: readonly IntegrationToolSpec[] = INTEGRATION_TOOL_SPECS,
): IntegrationToolChoice[] {
  return specs.map((spec) => ({
    integration: spec.integration,
    tool: spec.tool,
    label: spec.actionLabel,
  }));
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
