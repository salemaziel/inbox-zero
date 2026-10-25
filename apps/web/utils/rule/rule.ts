import type { CreateOrUpdateRuleSchema } from "@/utils/ai/rule/create-rule-schema";
import { after } from "next/server";
import prisma from "@/utils/prisma";
import type { Logger } from "@/utils/logger";
import { ActionType } from "@/generated/prisma/enums";
import type { SystemType } from "@/generated/prisma/enums";
import type { Prisma, Rule } from "@/generated/prisma/client";
import { getActionRiskLevel, type RiskAction } from "@/utils/risk";
import {
  createRuleHistory,
  ruleHistoryRuleInclude,
  type RuleHistoryTrigger,
} from "@/utils/rule/rule-history";
import { isMicrosoftProvider } from "@/utils/email/provider-types";
import { createEmailProvider } from "@/utils/email/provider";
import { resolveLabelNameAndId } from "@/utils/label/resolve-label";
import { getMissingRecipientMessage } from "@/utils/rule/recipient-validation";
import { isDuplicateError } from "@/utils/prisma-helpers";
import { SafeError } from "@/utils/error";
import type { AttachmentSourceInput } from "@/utils/attachments/source-schema";
import { validateWebhookUrlFormat } from "@/utils/outbound-webhook/url-validation";
import {
  getBlockedLowTrustStaticFromActionTypes,
  LOW_TRUST_STATIC_FROM_OUTBOUND_MESSAGE,
} from "@/utils/rule/static-from-risk";
import type { RuleWithRelations } from "@/utils/rule/types";
import type { RuleConditions } from "@/utils/condition";
import {
  assertRuleActionUpdateEnabled,
  assertRuleActionsEnabled,
  getDisabledRuleActionTypesToPreserve,
} from "@/utils/rule-action-feature-gates";
import { findIntegration } from "@/utils/mcp/integrations";
import {
  buildIntegrationArgsFromFields,
  getIntegrationFieldsFromArgs,
  getIntegrationToolSpec,
  getMissingEditorPicks,
  MISSING_INTEGRATION_TOOL_MESSAGE,
} from "@/utils/mcp/tool-specs";
import { assertNoSenderOnlyOverlap } from "@/utils/rule/sender-scope-overlap";
import { isIntegrationActionEnabledForEmailAccountId } from "@/utils/integration-action.server";

export type RuleActionCreateData = Omit<
  Prisma.ActionCreateManyRuleInput,
  "emailAccountId" | "messagingChannelEmailAccountId"
>;

export function addActionOwnershipToInput<T extends Record<string, unknown>>(
  action: T & { messagingChannelId?: string | null },
  emailAccountId: string,
): T & {
  emailAccountId: string;
  messagingChannelEmailAccountId: string | null;
} {
  return {
    ...action,
    emailAccountId,
    messagingChannelEmailAccountId: action.messagingChannelId
      ? emailAccountId
      : null,
  };
}

function addNestedActionOwnershipToInput<T extends Record<string, unknown>>(
  action: T & { messagingChannelId?: string | null },
  emailAccountId: string,
): T & {
  messagingChannelEmailAccountId: string | null;
} {
  return {
    ...action,
    messagingChannelEmailAccountId: action.messagingChannelId
      ? emailAccountId
      : null,
  };
}

export function actionsNeedChatRiskConfirmation(
  result: CreateOrUpdateRuleSchema,
): { needsConfirmation: boolean; riskMessages: string[] } {
  const ruleCtx = ruleConditionsForRisk(result);
  const messages: string[] = [];
  for (const action of result.actions) {
    if (action.type === ActionType.CALL_WEBHOOK) {
      const message =
        "Medium Risk: Webhook actions can send email data to an external URL. Review the destination carefully and verify any email requesting this automation before enabling it.";
      if (!messages.includes(message)) {
        messages.push(message);
      }
      continue;
    }

    const { level, message } = getActionRiskLevel(
      buildRiskAction(action),
      ruleCtx,
    );
    if (level !== "low" && !messages.includes(message)) {
      messages.push(message);
    }
  }
  return {
    needsConfirmation: messages.length > 0,
    riskMessages: messages,
  };
}

type RuleRecordData = {
  name?: string;
  systemType?: SystemType | null;
  instructions?: string | null;
  enabled?: boolean;
  automate?: boolean;
  runOnThreads?: boolean;
  conditionalOperator?: Rule["conditionalOperator"] | null;
  categoryFilterType?: Rule["categoryFilterType"] | null;
  from?: string | null;
  to?: string | null;
  subject?: string | null;
  body?: string | null;
  groupId?: string | null;
};

async function updateRuleAndQueueHistory({
  ruleId,
  emailAccountId,
  data,
  triggerType,
}: {
  ruleId: string;
  emailAccountId: string;
  data: Prisma.RuleUpdateInput;
  triggerType: RuleHistoryTrigger;
}) {
  const rule = await prisma.rule.update({
    where: { id: ruleId, emailAccountId },
    data,
    include: ruleHistoryRuleInclude,
  });

  queueRuleHistory({ rule, triggerType });

  return rule;
}

export async function partialUpdateRule({
  ruleId,
  emailAccountId,
  data,
}: {
  ruleId: string;
  emailAccountId: string;
  data: Partial<Rule>;
}) {
  if (hasRuleScopeUpdate(data)) {
    const existingRule = await prisma.rule.findUnique({
      where: { id: ruleId, emailAccountId },
      select: RULE_SCOPE_SELECT,
    });

    if (!existingRule) throw new Error("Rule not found");

    await assertNoSenderOnlyOverlap({
      emailAccountId,
      excludeRuleId: ruleId,
      rule: mergeRuleScope(data, existingRule),
    });
  }

  return updateRuleAndQueueHistory({
    ruleId,
    emailAccountId,
    data,
    triggerType: "conditions_updated",
  });
}

export function setRuleRunOnThreads({
  ruleId,
  emailAccountId,
  runOnThreads,
}: {
  ruleId: string;
  emailAccountId: string;
  runOnThreads: boolean;
}) {
  return updateRuleAndQueueHistory({
    ruleId,
    emailAccountId,
    data: { runOnThreads },
    triggerType: "run_on_threads_updated",
  });
}

export async function setRuleEnabled({
  ruleId,
  emailAccountId,
  enabled,
}: {
  ruleId: string;
  emailAccountId: string;
  enabled: boolean;
}) {
  if (enabled) {
    // An unfinished integration action would fail on every matching email.
    const rule = await prisma.rule.findFirst({
      where: { id: ruleId, emailAccountId },
      select: {
        actions: {
          where: { type: ActionType.INTEGRATION },
          select: INTEGRATION_ACTION_SELECT,
        },
      },
    });
    const picks = describeMissingEditorPicks(rule?.actions ?? []);
    if (picks) {
      throw new SafeError(
        `This rule can't be turned on yet. Open it in the rule editor, pick ${picks}, then turn it on.`,
      );
    }
  }

  return updateRuleAndQueueHistory({
    ruleId,
    emailAccountId,
    data: { enabled },
    triggerType: "enabled_updated",
  });
}

export async function createRuleWithResolvedActions({
  emailAccountId,
  data,
  actions,
  skipSenderOnlyOverlapCheck = false,
}: {
  emailAccountId: string;
  data: RuleRecordData & { name: string };
  actions: RuleActionCreateData[];
  skipSenderOnlyOverlapCheck?: boolean;
}): Promise<RuleWithRelations> {
  assertRuleActionsEnabled(actions);
  await assertIntegrationActionsEnabled(actions, emailAccountId);

  if (!skipSenderOnlyOverlapCheck) {
    await assertNoSenderOnlyOverlap({ emailAccountId, rule: data });
  }

  validateLowTrustStaticFromOutboundActions({
    from: data.from,
    actionTypes: actions.map((action) => action.type),
  });

  validateWebhookUrlsInActions(actions);

  const rule = await prisma.rule.create({
    data: {
      emailAccountId,
      name: data.name,
      systemType: data.systemType ?? undefined,
      instructions: data.instructions ?? undefined,
      enabled: data.enabled ?? undefined,
      automate: data.automate ?? undefined,
      runOnThreads: data.runOnThreads ?? undefined,
      conditionalOperator: data.conditionalOperator ?? undefined,
      categoryFilterType: data.categoryFilterType ?? undefined,
      from: data.from ?? undefined,
      to: data.to ?? undefined,
      subject: data.subject ?? undefined,
      body: data.body ?? undefined,
      groupId: data.groupId ?? undefined,
      actions: {
        createMany: {
          data: addNestedActionOwnershipToInputs(actions, emailAccountId),
        },
      },
    },
    include: { actions: true, group: true },
  });

  return rule;
}

export async function replaceRuleWithResolvedActions({
  ruleId,
  emailAccountId,
  data,
  actions,
}: {
  ruleId: string;
  emailAccountId: string;
  data: RuleRecordData;
  actions: RuleActionCreateData[];
}): Promise<RuleWithRelations> {
  const existingRule = await prisma.rule.findUnique({
    where: { id: ruleId, emailAccountId },
    select: {
      ...RULE_SCOPE_SELECT,
      actions: { select: { type: true } },
    },
  });

  assertRuleActionUpdateEnabled(actions, existingRule?.actions ?? []);
  await assertIntegrationActionsEnabled(actions, emailAccountId);

  await assertNoSenderOnlyOverlap({
    emailAccountId,
    excludeRuleId: ruleId,
    rule: existingRule ? mergeRuleScope(data, existingRule) : data,
  });

  validateLowTrustStaticFromOutboundActions({
    from: data.from,
    actionTypes: actions.map((action) => action.type),
  });

  validateWebhookUrlsInActions(actions);

  const rule = await prisma.rule.update({
    where: { id: ruleId, emailAccountId },
    data: {
      name: data.name,
      systemType: data.systemType,
      instructions: data.instructions,
      enabled: data.enabled,
      automate: data.automate,
      runOnThreads: data.runOnThreads,
      conditionalOperator: data.conditionalOperator ?? undefined,
      categoryFilterType: data.categoryFilterType,
      from: data.from,
      to: data.to,
      subject: data.subject,
      body: data.body,
      groupId: data.groupId,
      actions: {
        deleteMany: getReplaceableRuleActionsWhere(),
        createMany: {
          data: addNestedActionOwnershipToInputs(actions, emailAccountId),
        },
      },
    },
    include: { actions: true, group: true },
  });

  if (existingRule?.groupId && existingRule.groupId !== rule.groupId) {
    await prisma.group.deleteMany({
      where: { id: existingRule.groupId, emailAccountId },
    });
  }

  return rule;
}

export async function createRule({
  result,
  emailAccountId,
  systemType,
  provider,
  runOnThreads,
  enabled = true,
  logger,
}: {
  result: CreateOrUpdateRuleSchema;
  emailAccountId: string;
  systemType?: SystemType | null;
  provider: string;
  runOnThreads: boolean;
  enabled?: boolean;
  logger: Logger;
}) {
  try {
    logger.info("Creating rule", {
      name: result.name,
      systemType,
    });

    await assertNoSenderOnlyOverlap({
      emailAccountId,
      rule: {
        instructions: result.condition.aiInstructions,
        from: result.condition.static?.from,
        to: result.condition.static?.to,
        subject: result.condition.static?.subject,
      },
    });

    validateLowTrustStaticFromOutboundActions({
      from: result.condition.static?.from,
      actionTypes: result.actions.map((action) => action.type),
    });

    const mappedActions = await mapActionFields(
      result.actions,
      provider,
      emailAccountId,
      logger,
    );

    const rule = await createRuleWithResolvedActions({
      emailAccountId,
      data: {
        name: result.name,
        systemType,
        // A rule the editor still has to finish would fail on every email.
        enabled: enabled && !getIntegrationSetupMessage(mappedActions),
        runOnThreads,
        conditionalOperator: result.condition.conditionalOperator ?? undefined,
        instructions: result.condition.aiInstructions,
        from: result.condition.static?.from,
        to: result.condition.static?.to,
        subject: result.condition.static?.subject,
      },
      actions: mappedActions,
      skipSenderOnlyOverlapCheck: true,
    });

    queueRuleHistory({ rule, triggerType: "created" });

    return rule;
  } catch (error) {
    logger.error("Error creating rule", { error });
    throw error;
  }
}

export async function updateRule({
  ruleId,
  result,
  emailAccountId,
  provider,
  logger,
  runOnThreads,
}: {
  ruleId: string;
  result: CreateOrUpdateRuleSchema;
  emailAccountId: string;
  provider: string;
  logger: Logger;
  runOnThreads?: boolean;
}) {
  try {
    logger.info("Updating rule", {
      name: result.name,
      ruleId,
    });

    validateLowTrustStaticFromOutboundActions({
      from: result.condition.static?.from,
      actionTypes: result.actions.map((action) => action.type),
    });

    const mappedActions = await mapActionFields(
      result.actions,
      provider,
      emailAccountId,
      logger,
    );

    const rule = await replaceRuleWithResolvedActions({
      ruleId,
      emailAccountId,
      data: {
        name: result.name,
        conditionalOperator: result.condition.conditionalOperator ?? undefined,
        instructions: result.condition.aiInstructions,
        from: result.condition.static?.from,
        to: result.condition.static?.to,
        subject: result.condition.static?.subject,
        ...(runOnThreads !== undefined && { runOnThreads }),
      },
      actions: mappedActions,
    });

    queueRuleHistory({ rule, triggerType: "updated" });

    return rule;
  } catch (error) {
    logger.error("Error updating rule", { error });
    throw error;
  }
}

export async function upsertSystemRule({
  name,
  instructions,
  actions,
  emailAccountId,
  systemType,
  runOnThreads,
  enabled,
  logger,
}: {
  name: string;
  instructions: string;
  actions: RuleActionCreateData[];
  emailAccountId: string;
  systemType: SystemType;
  runOnThreads: boolean;
  enabled: boolean;
  logger: Logger;
}) {
  logger.info("Upserting system rule", { name, systemType });

  const existingRule = await prisma.rule.findFirst({
    where: {
      emailAccountId,
      OR: [{ systemType }, { name }],
    },
    include: { actions: true, group: true },
  });

  const data = {
    name,
    instructions,
    systemType,
    runOnThreads,
    enabled,
  };

  if (existingRule) {
    logger.info("Updating existing rule", {
      ruleId: existingRule.id,
      hadSystemType: !!existingRule.systemType,
    });

    const rule = await replaceRuleWithResolvedActions({
      ruleId: existingRule.id,
      emailAccountId,
      data: {
        ...data,
      },
      actions,
    });

    queueRuleHistory({ rule, triggerType: "updated" });
    return rule;
  } else {
    logger.info("Creating new system rule");

    try {
      const rule = await createRuleWithResolvedActions({
        emailAccountId,
        data: {
          ...data,
        },
        actions,
      });

      queueRuleHistory({ rule, triggerType: "created" });
      return rule;
    } catch (error) {
      if (!isDuplicateError(error, "name")) throw error;

      logger.info("Rule already exists (race condition), updating instead");
      const existing = await prisma.rule.findFirst({
        where: { emailAccountId, name },
      });
      if (!existing) throw error;

      const rule = await replaceRuleWithResolvedActions({
        ruleId: existing.id,
        emailAccountId,
        data: {
          ...data,
        },
        actions,
      });

      queueRuleHistory({ rule, triggerType: "updated" });
      return rule;
    }
  }
}

export async function updateRuleActions({
  ruleId,
  actions,
  provider,
  emailAccountId,
  logger,
}: {
  ruleId: string;
  actions: CreateOrUpdateRuleSchema["actions"];
  provider: string;
  emailAccountId: string;
  logger: Logger;
}) {
  const existingRule = await prisma.rule.findFirst({
    where: { id: ruleId, emailAccountId },
    select: {
      from: true,
      actions: {
        select: {
          type: true,
          integrationName: true,
          integrationToolName: true,
          integrationArgs: true,
        },
      },
    },
  });

  if (!existingRule) {
    throw new Error("Rule not found");
  }

  assertRuleActionUpdateEnabled(actions, existingRule.actions);
  await assertIntegrationActionsEnabled(actions, emailAccountId);

  validateLowTrustStaticFromOutboundActions({
    from: existingRule.from,
    actionTypes: actions.map((action) => action.type),
  });

  const mappedActions = await mapActionFields(
    keepEditorPickedIntegrationArgs(actions, existingRule.actions),
    provider,
    emailAccountId,
    logger,
  );
  validateWebhookUrlsInActions(mappedActions);

  const rule = await prisma.rule.update({
    where: { id: ruleId, emailAccountId },
    data: {
      ...(getIntegrationSetupMessage(mappedActions) && { enabled: false }),
      actions: {
        deleteMany: getReplaceableRuleActionsWhere(),
        createMany: {
          data: addNestedActionOwnershipToInputs(mappedActions, emailAccountId),
        },
      },
    },
    include: ruleHistoryRuleInclude,
  });

  queueRuleHistory({ rule, triggerType: "actions_updated" });

  return rule;
}

export async function deleteRule({
  emailAccountId,
  ruleId,
  groupId,
}: {
  emailAccountId: string;
  ruleId: string;
  groupId?: string | null;
}) {
  if (groupId) {
    const deletedGroups = await prisma.group.deleteMany({
      where: { id: groupId, emailAccountId },
    });

    if (deletedGroups.count > 0) return;
  }

  await prisma.rule.delete({ where: { id: ruleId, emailAccountId } });
}

type RuleScopeKey =
  | "instructions"
  | "from"
  | "to"
  | "subject"
  | "body"
  | "groupId";

const RULE_SCOPE_KEYS = [
  "instructions",
  "from",
  "to",
  "subject",
  "body",
  "groupId",
] as const satisfies RuleScopeKey[];

const RULE_SCOPE_SELECT = {
  instructions: true,
  from: true,
  to: true,
  subject: true,
  body: true,
  groupId: true,
} as const;

function hasRuleScopeUpdate(data: Partial<Rule>) {
  return RULE_SCOPE_KEYS.some((key) => Object.hasOwn(data, key));
}

function mergeRuleScope<T extends Record<RuleScopeKey, string | null>>(
  data: Partial<Record<RuleScopeKey, string | null | undefined>>,
  existingRule: T,
): Record<RuleScopeKey, string | null> {
  return Object.fromEntries(
    RULE_SCOPE_KEYS.map((key) => [
      key,
      Object.hasOwn(data, key)
        ? ((data[key] as string | null | undefined) ?? null)
        : existingRule[key],
    ]),
  ) as Record<RuleScopeKey, string | null>;
}

function validateLowTrustStaticFromOutboundActions({
  from,
  actionTypes,
}: {
  from: string | null | undefined;
  actionTypes: readonly ActionType[];
}) {
  const blockedActionTypes = getBlockedLowTrustStaticFromActionTypes(
    from,
    actionTypes,
  );
  if (!blockedActionTypes.length) return;

  throw new SafeError(LOW_TRUST_STATIC_FROM_OUTBOUND_MESSAGE, 400);
}

function getReplaceableRuleActionsWhere() {
  const disabledActionTypes = getDisabledRuleActionTypesToPreserve();
  return disabledActionTypes.length
    ? { type: { notIn: disabledActionTypes } }
    : {};
}

type MappableAction = CreateOrUpdateRuleSchema["actions"][number] & {
  messagingChannelId?: string | null;
  labelId?: string | null;
  folderId?: string | null;
  integrationName?: string | null;
  integrationToolName?: string | null;
  integrationArgs?: Prisma.JsonValue | null;
};

async function mapActionFields(
  actions: MappableAction[],
  provider: string,
  emailAccountId: string,
  logger: Logger,
) {
  await assertMessagingChannelsBelongToEmailAccount(actions, emailAccountId);
  await assertIntegrationActionsConnected(actions, emailAccountId);

  const actionPromises = actions.map(
    async (a): Promise<RuleActionCreateData> => {
      const to = a.fields?.to?.trim() || null;
      const recipientMessage = getMissingRecipientMessage({
        actionType: a.type,
        recipient: to,
        sendEmailMessage:
          "SEND_EMAIL action requires a recipient in the to field. Use REPLY for automatic responses.",
        forwardMessage: "FORWARD action requires a recipient in the to field.",
      });
      if (recipientMessage) throw new Error(recipientMessage);

      let label = a.fields?.label;
      let labelId: string | null = null;
      const folderName =
        typeof a.fields?.folderName === "string" ? a.fields.folderName : null;
      let folderId: string | null = a.folderId || null;

      if (a.type === ActionType.LABEL) {
        const emailProvider = await createEmailProvider({
          emailAccountId,
          provider,
          logger,
        });

        const resolved = await resolveLabelNameAndId({
          emailProvider,
          label: a.fields?.label || null,
          labelId: a.labelId || null,
        });
        label = resolved.label;
        labelId = resolved.labelId;
      }

      if (
        a.type === ActionType.MOVE_FOLDER &&
        folderName &&
        !folderId &&
        isMicrosoftProvider(provider)
      ) {
        const emailProvider = await createEmailProvider({
          emailAccountId,
          provider,
          logger,
        });

        folderId = await emailProvider.getOrCreateFolderIdByName(folderName);
      }

      const integrationFields =
        a.type === ActionType.INTEGRATION
          ? getIntegrationCreateFields(a)
          : null;

      return {
        type: a.type,
        messagingChannelId: a.messagingChannelId ?? null,
        label,
        labelId,
        to,
        cc: a.fields?.cc,
        bcc: a.fields?.bcc,
        subject: a.fields?.subject,
        content: integrationFields ? null : a.fields?.content,
        url: a.fields?.webhookUrl,
        ...(isMicrosoftProvider(provider) && {
          folderName: folderName ?? null,
          folderId,
        }),
        delayInMinutes: a.delayInMinutes,
        staticAttachments:
          (a as { staticAttachments?: AttachmentSourceInput[] | null })
            .staticAttachments ?? undefined,
        ...integrationFields,
      };
    },
  );

  return Promise.all(actionPromises);
}

function getIntegrationCreateFields(action: MappableAction) {
  const { integrationName, integrationToolName } = action;
  if (!integrationName || !integrationToolName) {
    throw new SafeError(MISSING_INTEGRATION_TOOL_MESSAGE);
  }

  return {
    integrationName,
    integrationToolName,
    integrationArgs: (action.integrationArgs ??
      buildIntegrationArgsFromFields({
        integrationName,
        integrationToolName,
        fields: action.fields,
      })) as Prisma.InputJsonValue,
  };
}

/**
 * Plain-words next step for a rule whose integration actions still need a
 * choice only the rule editor can make; null when nothing is missing.
 */
export function getIntegrationSetupMessage(
  actions: readonly IntegrationActionArgs[],
): string | null {
  const picks = describeMissingEditorPicks(actions);
  if (!picks) return null;
  return `This rule was saved turned off. To finish it, open it in the rule editor, pick ${picks}, then turn the rule on.`;
}

type IntegrationActionArgs = {
  type: ActionType;
  integrationName?: string | null;
  integrationToolName?: string | null;
  integrationArgs?: unknown;
};

const INTEGRATION_ACTION_SELECT = {
  type: true,
  integrationName: true,
  integrationToolName: true,
  integrationArgs: true,
} as const;

// "the Trello board and list", or null when every editor choice is made.
function describeMissingEditorPicks(
  actions: readonly IntegrationActionArgs[],
): string | null {
  const picks = new Set<string>();
  for (const action of actions) {
    if (action.type !== ActionType.INTEGRATION) continue;
    const spec = getIntegrationToolSpec(
      action.integrationName,
      action.integrationToolName,
    );
    if (!spec) continue;

    const missing = getMissingEditorPicks(spec, action.integrationArgs);
    if (!missing.length) continue;
    const appName = findIntegration(spec.integration)?.displayName ?? "";
    picks.add(
      `the ${appName} ${joinWords(missing.map((arg) => arg.label.toLowerCase()))}`,
    );
  }

  return picks.size ? joinWords([...picks]) : null;
}

function joinWords(words: string[]) {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

// The rule writer resends whole action lists, so an edit would otherwise drop
// what the user set in the editor (board, list, card, project, a fixed title or
// due date...). Each existing action with the same app and tool lends its
// stored values to one incoming action, in list order, unless the values sent
// show each action was only moved. A field the rule writer leaves out keeps its
// stored value; one it sends wins, and an empty one means the AI fills it per
// email.
function keepEditorPickedIntegrationArgs<T extends MappableAction>(
  actions: T[],
  existingActions: ExistingIntegrationAction[],
): T[] {
  if (!actions.some((action) => action.type === ActionType.INTEGRATION)) {
    return actions;
  }
  const existingIntegrationActions = existingActions.filter(
    (action) => action.type === ActionType.INTEGRATION,
  );
  const incoming = actions.flatMap((action, index) => {
    if (action.type !== ActionType.INTEGRATION || action.integrationArgs) {
      return [];
    }
    const fields: Record<string, string | null | undefined> | null | undefined =
      action.fields;
    const args: Record<string, unknown> = buildIntegrationArgsFromFields({
      integrationName: action.integrationName,
      integrationToolName: action.integrationToolName,
      fields,
    });
    return [{ action, index, fields, args }];
  });

  const matches = new Map<number, ExistingIntegrationAction>();
  for (const toolKey of new Set(
    incoming.map(({ action }) => getToolKey(action)),
  )) {
    const group = incoming.filter(
      ({ action }) => getToolKey(action) === toolKey,
    );
    const candidates = existingIntegrationActions.filter(
      (existing) => getToolKey(existing) === toolKey,
    );
    const valueMatches = group.map(({ action, fields, args }) =>
      findOnlyActionShowingSentValues(action, fields, args, candidates),
    );
    const isClearlyReordered =
      valueMatches.every(Boolean) &&
      new Set(valueMatches).size === valueMatches.length;
    group.forEach(({ index }, position) => {
      const match = isClearlyReordered
        ? valueMatches[position]
        : candidates[position];
      if (match) matches.set(index, match);
    });
  }

  return actions.map((action, index) => {
    const entry = incoming.find((item) => item.index === index);
    const existingArgs = matches.get(index)?.integrationArgs;
    const spec = getIntegrationToolSpec(
      action.integrationName,
      action.integrationToolName,
    );
    if (!entry || !spec || !isJsonObject(existingArgs)) return action;
    const { fields, args } = entry;

    for (const arg of spec.args) {
      if (arg.llmDescription && fields?.[arg.key] != null) continue;
      for (const key of [arg.key, arg.displayValueKey]) {
        if (key && key in existingArgs) args[key] = existingArgs[key];
      }
    }

    return { ...action, integrationArgs: args as Prisma.JsonValue };
  });
}

type ExistingIntegrationAction = {
  type: ActionType;
  integrationName: string | null;
  integrationToolName: string | null;
  integrationArgs: Prisma.JsonValue | null;
};

function getToolKey(action: {
  integrationName?: string | null;
  integrationToolName?: string | null;
}) {
  return `${action.integrationName}/${action.integrationToolName}`;
}

// Value pairing only overrides list order when the values chat sent point to
// exactly one stored action. A field left out could belong to any action, and
// an AI-written field looks the same on every action, so neither counts.
function findOnlyActionShowingSentValues(
  action: MappableAction,
  fields: Record<string, string | null | undefined> | null | undefined,
  args: Record<string, unknown>,
  candidates: ExistingIntegrationAction[],
) {
  const spec = getIntegrationToolSpec(
    action.integrationName,
    action.integrationToolName,
  );
  const sentKeys = (spec?.args ?? [])
    .filter((arg) => arg.llmDescription && fields?.[arg.key] != null)
    .map((arg) => arg.key);
  const shown = getIntegrationFieldsFromArgs({
    ...action,
    integrationArgs: args,
  });
  if (!sentKeys.some((key) => shown[key] !== undefined)) return;

  const showingSentValues = candidates.filter((existing) => {
    const stored = getIntegrationFieldsFromArgs(existing);
    return sentKeys.every((key) => stored[key] === shown[key]);
  });
  return showingSentValues.length === 1 ? showingSentValues[0] : undefined;
}

function isJsonObject(
  value: Prisma.JsonValue | null | undefined,
): value is Prisma.JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function buildRiskAction(action: MappableAction): RiskAction {
  const integrationFields =
    action.type === ActionType.INTEGRATION
      ? getIntegrationCreateFields(action)
      : null;

  return {
    type: action.type,
    subject: action.fields?.subject ?? null,
    content: action.fields?.content ?? null,
    to: action.fields?.to?.trim() || null,
    cc: action.fields?.cc ?? null,
    bcc: action.fields?.bcc ?? null,
    integrationName: integrationFields?.integrationName ?? null,
    integrationToolName: integrationFields?.integrationToolName ?? null,
    integrationArgs:
      (integrationFields?.integrationArgs as Prisma.JsonValue | undefined) ??
      null,
  };
}

export async function assertIntegrationActionsConnected(
  actions: readonly { type: ActionType; integrationName?: string | null }[],
  emailAccountId: string,
) {
  const integrationNames = [
    ...new Set(
      actions
        .filter((action) => action.type === ActionType.INTEGRATION)
        .map((action) => action.integrationName)
        .filter((name): name is string => !!name),
    ),
  ];

  if (!integrationNames.length) return;

  const connections = await prisma.mcpConnection.findMany({
    where: {
      emailAccountId,
      isActive: true,
      integration: { name: { in: integrationNames } },
    },
    select: { integration: { select: { name: true } } },
  });
  const connectedNames = new Set(
    connections.map((connection) => connection.integration.name),
  );

  for (const name of integrationNames) {
    if (connectedNames.has(name)) continue;

    const displayName = findIntegration(name)?.displayName ?? name;
    throw new SafeError(
      `${displayName} isn't connected. Connect it to use this action.`,
    );
  }
}

async function assertIntegrationActionsEnabled(
  actions: readonly { type: ActionType }[],
  emailAccountId: string,
) {
  if (!actions.some((action) => action.type === ActionType.INTEGRATION)) return;

  if (!(await isIntegrationActionEnabledForEmailAccountId(emailAccountId))) {
    throw new SafeError("Integration actions are not enabled for this user.");
  }
}

async function assertMessagingChannelsBelongToEmailAccount(
  actions: readonly { messagingChannelId?: string | null }[],
  emailAccountId: string,
) {
  const messagingChannelIds = [
    ...new Set(
      actions
        .map((action) => action.messagingChannelId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  if (!messagingChannelIds.length) return;

  const channels = await prisma.messagingChannel.findMany({
    where: {
      id: { in: messagingChannelIds },
      emailAccountId,
    },
    select: { id: true },
  });

  if (channels.length !== messagingChannelIds.length) {
    throw new SafeError("Messaging channel not found");
  }
}

function ruleConditionsForRisk(rule: CreateOrUpdateRuleSchema): RuleConditions {
  return {
    instructions: rule.condition.aiInstructions ?? undefined,
    from: rule.condition.static?.from ?? undefined,
    to: rule.condition.static?.to ?? undefined,
    subject: rule.condition.static?.subject ?? undefined,
  };
}

function validateWebhookUrlsInActions(actions: RuleActionCreateData[]) {
  for (const action of actions) {
    if (action.type !== ActionType.CALL_WEBHOOK || !action.url) continue;

    const result = validateWebhookUrlFormat(action.url);
    if (!result.valid) {
      throw new SafeError(`Invalid webhook URL: ${result.error}`, 400);
    }
  }
}

function queueRuleHistory(params: {
  rule: RuleWithRelations;
  triggerType: RuleHistoryTrigger;
}) {
  after(() => createRuleHistory(params));
}

function addNestedActionOwnershipToInputs(
  actions: RuleActionCreateData[],
  emailAccountId: string,
): Prisma.ActionCreateManyRuleInput[] {
  return actions.map((action) => {
    const actionWithSupportedDelay =
      action.type === ActionType.INTEGRATION
        ? { ...action, delayInMinutes: null }
        : action;

    return addNestedActionOwnershipToInput(
      actionWithSupportedDelay,
      emailAccountId,
    );
  });
}
