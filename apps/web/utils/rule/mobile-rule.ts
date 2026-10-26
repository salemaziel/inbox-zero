import { ConditionType } from "@/utils/config";
import type { CreateRuleBody } from "@/utils/actions/rule.validation";
import type { CreateRuleSchema } from "@/utils/ai/rule/create-rule-schema";
import { ActionType } from "@/generated/prisma/enums";
import {
  buildIntegrationArgsFromFields,
  getIntegrationToolSpec,
  getMissingEditorPicks,
} from "@/utils/mcp/tool-specs";

export function toCreateRuleBodyFromAiRule(
  rule: CreateRuleSchema,
): CreateRuleBody {
  const conditions: CreateRuleBody["conditions"] = [];

  if (rule.condition.aiInstructions) {
    conditions.push({
      type: ConditionType.AI,
      instructions: rule.condition.aiInstructions,
    });
  }

  for (const field of ["from", "to", "subject"] as const) {
    const value = rule.condition.static?.[field];
    if (!value) continue;
    conditions.push({
      type: ConditionType.STATIC,
      [field]: value,
    });
  }

  const actions: CreateRuleBody["actions"] = rule.actions.map((action) => {
    if (action.type === ActionType.INTEGRATION) {
      return {
        type: action.type,
        integrationName: action.integrationName,
        integrationToolName: action.integrationToolName,
        integrationArgs: buildIntegrationArgsFromFields({
          integrationName: action.integrationName,
          integrationToolName: action.integrationToolName,
          fields: action.fields,
        }),
        delayInMinutes: action.delayInMinutes,
      };
    }

    return {
      type: action.type,
      labelId: action.fields?.label ? { name: action.fields.label } : undefined,
      subject: action.fields?.subject
        ? { value: action.fields.subject }
        : undefined,
      content: action.fields?.content
        ? { value: action.fields.content }
        : undefined,
      to: action.fields?.to ? { value: action.fields.to } : undefined,
      cc: action.fields?.cc ? { value: action.fields.cc } : undefined,
      bcc: action.fields?.bcc ? { value: action.fields.bcc } : undefined,
      url: action.fields?.webhookUrl
        ? { value: action.fields.webhookUrl }
        : undefined,
      folderName: action.fields?.folderName
        ? { value: action.fields.folderName }
        : undefined,
      delayInMinutes: action.delayInMinutes,
    };
  });

  // The rule writer can't pick a Trello board or card, so such a rule is saved
  // turned off and the user finishes it in the rule editor.
  const needsEditorPicks = actions.some((action) => {
    const spec = getIntegrationToolSpec(
      action.integrationName,
      action.integrationToolName,
    );
    return !!spec && getMissingEditorPicks(spec, action.integrationArgs).length;
  });

  return {
    name: rule.name,
    ...(needsEditorPicks && { enabled: false }),
    runOnThreads: true,
    conditionalOperator: rule.condition.conditionalOperator ?? undefined,
    conditions,
    actions,
  };
}
