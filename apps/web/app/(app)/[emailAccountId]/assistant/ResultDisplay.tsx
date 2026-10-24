import groupBy from "lodash/groupBy";
import sortBy from "lodash/sortBy";
import { capitalCase } from "capital-case";
import * as he from "he";
import { HoverCard } from "@/components/HoverCard";
import { Badge } from "@/components/Badge";
import { conditionTypesToString } from "@/utils/condition";
import {
  ActionType,
  ExecutedRuleStatus,
  LogicalOperator,
} from "@/generated/prisma/enums";
import type { ExecutedAction, Rule } from "@/generated/prisma/client";
import { Button } from "@/components/ui/button";
import { MessageText, MutedText } from "@/components/Typography";
import { EyeIcon } from "lucide-react";
import { useRuleDialog } from "@/app/(app)/[emailAccountId]/assistant/RuleDialog";
import { ThreadSkipHint } from "@/app/(app)/[emailAccountId]/assistant/ThreadSkipHint";
import { LearnedPatternExclusionHint } from "@/app/(app)/[emailAccountId]/assistant/LearnedPatternExclusionHint";
import type { RunRulesResult } from "@/utils/ai/choose-rule/run-rules";
import { RuleActions } from "@/components/RuleActions";
import { useAccount } from "@/providers/EmailAccountProvider";
import type { ActionItem } from "@/utils/ai/types";
import {
  getSafeIntegrationResultUrl,
  parseIntegrationCallResult,
} from "@/utils/integrations/result";
import { getIntegrationActionLabel } from "@/utils/mcp/tool-specs";
import { findIntegration } from "@/utils/mcp/integrations";

// History rows carry every ExecutedAction column at runtime; RunRulesResult only
// types the ones the rule engine produces.
type HistoryResult = Omit<RunRulesResult, "actionItems"> & {
  actionItems?: (ActionItem & {
    executionStatus?: ExecutedAction["executionStatus"];
    executionError?: unknown;
    integrationResult?: unknown;
  })[];
};

export function ResultsDisplay({
  results,
  showFullContent = false,
}: {
  results: HistoryResult[];
  showFullContent?: boolean;
}) {
  const groupedResults = groupBy(results, (result) =>
    result.createdAt.toString(),
  );

  const sortedBatches = sortBy(
    Object.entries(groupedResults),
    ([, batchResults]) => {
      const createdAt = batchResults[0]?.createdAt;
      return createdAt ? -new Date(createdAt) : 0; // Negative for descending order
    },
  );

  return (
    <div className="flex flex-col gap-2">
      {sortedBatches.map(([date, batchResults], batchIndex) => (
        <div key={date}>
          {batchIndex === 1 && sortedBatches.length > 1 && (
            <div className="my-1 text-xs text-muted-foreground">Previous:</div>
          )}
          <div
            className={
              showFullContent
                ? "flex flex-col gap-4"
                : "flex flex-wrap gap-1 sm:flex-nowrap"
            }
          >
            {batchResults.map((result, resultIndex) => (
              <ResultDisplay
                key={`${date}-${resultIndex}`}
                result={result}
                showFullContent={showFullContent}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ResultDisplay({
  result,
  showFullContent = false,
}: {
  result: HistoryResult;
  showFullContent?: boolean;
}) {
  const { rule, status } = result;

  if (showFullContent) {
    return (
      <div className="w-full">
        <ResultDisplayContent result={result} />
      </div>
    );
  }

  return (
    <HoverCard
      content={<ResultDisplayContent result={result} />}
      className="w-max min-w-64 max-w-[min(32rem,calc(100vw-2rem))] overflow-visible"
    >
      <Badge
        color={rule ? "green" : "red"}
        className="whitespace-nowrap max-sm:whitespace-normal max-sm:break-all max-sm:max-w-full"
      >
        {rule
          ? rule.name
          : status === ExecutedRuleStatus.SKIPPED
            ? "No match found"
            : capitalCase(status)}
        <EyeIcon className="ml-1.5 size-3.5 shrink-0 opacity-70" />
      </Badge>
    </HoverCard>
  );
}

export function ResultDisplayContent({ result }: { result: HistoryResult }) {
  const { rule, status, reason } = result;
  const reasonDisplay = getRuleResultReasonDisplay(reason ?? "");
  const skippedThreadRuleNames =
    result.selectionMetadata?.skippedThreadRuleNames ?? [];
  const learnedPatternExcludedRules =
    result.selectionMetadata?.learnedPatternExcludedRules ?? [];

  const integrationActions =
    result.actionItems?.filter(
      (action) => action.type === ActionType.INTEGRATION,
    ) ?? [];

  const { ruleDialog, RuleDialogComponent } = useRuleDialog();
  const { provider } = useAccount();

  return (
    <div>
      <div className="flex justify-between font-medium">
        {rule ? (
          <>
            {rule.name}
            <Badge color="blue">{conditionTypesToString(rule)}</Badge>
          </>
        ) : (
          status === ExecutedRuleStatus.SKIPPED && "No match found"
        )}
      </div>
      <div className="mt-2">
        {rule ? <PrettyConditions rule={rule} /> : null}
      </div>
      <div className="mt-2">
        {!!rule && (
          <Button
            size="sm"
            onClick={() => {
              ruleDialog.onOpen({ ruleId: rule.id });
            }}
          >
            View matching rule
          </Button>
        )}
      </div>

      <div className="mt-2">
        {result.actionItems?.length ? (
          <>
            <div className="font-medium text-sm mb-1">Actions:</div>
            <RuleActions
              actions={
                result.actionItems?.map((action) => ({
                  id: action.id,
                  type: action.type,
                  label: action.label,
                  folderName: action.folderName,
                  content: action.content,
                  to: action.to,
                  subject: action.subject,
                  cc: action.cc,
                  bcc: action.bcc,
                  url: action.url,
                })) || []
              }
              provider={provider}
              labels={[]}
            />
            {integrationActions.map((action) => (
              <IntegrationActionOutcome key={action.id} action={action} />
            ))}
          </>
        ) : (
          <div className="text-muted-foreground text-sm">No actions taken</div>
        )}
      </div>

      {(status === ExecutedRuleStatus.SKIPPED ||
        learnedPatternExcludedRules.length > 0) && (
        <div className="mt-3 space-y-2">
          {status === ExecutedRuleStatus.SKIPPED && (
            <ThreadSkipHint skippedThreadRuleNames={skippedThreadRuleNames} />
          )}
          {learnedPatternExcludedRules.length > 0 && (
            <LearnedPatternExclusionHint
              learnedPatternExcludedRules={learnedPatternExcludedRules}
            />
          )}
        </div>
      )}

      {(!!reasonDisplay.reason ||
        reasonDisplay.actionFailureMessages.length > 0) && (
        <div className="mt-4 space-y-2 bg-muted p-2 rounded-md">
          <div className="font-medium text-sm">
            Reason for choosing this rule:
          </div>
          {!!reasonDisplay.reason && (
            <MessageText className="whitespace-pre-wrap break-words">
              {reasonDisplay.reason}
            </MessageText>
          )}
          {reasonDisplay.actionFailureMessages.length > 0 && (
            <div className="space-y-1">
              <div className="font-medium text-sm">Action issues:</div>
              <ul className="list-disc space-y-1 pl-4 text-sm text-slate-700 dark:text-foreground">
                {reasonDisplay.actionFailureMessages.map((message) => (
                  <li key={message} className="break-words">
                    {message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <RuleDialogComponent />
    </div>
  );
}

function IntegrationActionOutcome({
  action,
}: {
  action: NonNullable<HistoryResult["actionItems"]>[number];
}) {
  const displayName =
    (action.integrationName &&
      findIntegration(action.integrationName)?.displayName) ||
    "the app";
  const url = getSafeIntegrationResultUrl(
    parseIntegrationCallResult(action.integrationResult)?.url,
  );
  const message =
    action.executionStatus === "FAILED"
      ? getIntegrationErrorMessage(action.executionError)
      : null;

  if (!url && !message) return null;

  return (
    <div className="mt-1 space-y-1 text-sm">
      {url && (
        <Button asChild variant="link" size="sm" className="h-auto p-0">
          <a href={url} target="_blank" rel="noopener noreferrer">
            Open in {displayName}
          </a>
        </Button>
      )}
      {message && (
        <MutedText className="whitespace-pre-wrap break-words">
          <span className="font-medium">
            {getIntegrationActionLabel(action)}:
          </span>{" "}
          <span>{message}</span>
        </MutedText>
      )}
    </div>
  );
}

function getIntegrationErrorMessage(executionError: unknown) {
  if (!executionError || typeof executionError !== "object") return null;
  const { message } = executionError as { message?: unknown };
  if (typeof message !== "string" || !message.trim()) return null;
  // Already bounded when stored: our copy plus at most 500 chars from the app
  return message;
}

function PrettyConditions({
  rule,
}: {
  rule: Pick<
    Rule,
    "from" | "to" | "subject" | "body" | "instructions" | "conditionalOperator"
  >;
}) {
  const conditions: { text: string; isInstructions?: boolean }[] = [];

  // Static conditions - grouped with commas
  const staticConditions: string[] = [];
  if (rule.from) staticConditions.push(`From: ${rule.from}`);
  if (rule.subject) staticConditions.push(`Subject: "${rule.subject}"`);
  if (rule.to) staticConditions.push(`To: ${rule.to}`);
  if (rule.body) staticConditions.push(`Body: "${rule.body}"`);
  if (staticConditions.length)
    conditions.push({ text: staticConditions.join(", ") });

  if (rule.instructions)
    conditions.push({ text: rule.instructions, isInstructions: true });

  const operator =
    rule.conditionalOperator === LogicalOperator.AND ? "AND" : "OR";

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {conditions.map((condition, index) => (
        <div key={index} className="flex min-w-0 items-center gap-1.5">
          <MutedText
            className={
              condition.isInstructions
                ? "line-clamp-2 whitespace-pre-line break-words"
                : undefined
            }
          >
            {condition.text}
          </MutedText>
          {index < conditions.length - 1 && (
            <Badge color="purple" className="text-xs">
              {operator}
            </Badge>
          )}
        </div>
      ))}
    </div>
  );
}

export function getRuleResultReasonDisplay(reason: string): {
  reason: string;
  actionFailureMessages: string[];
} {
  const actionFailureMessages: string[] = [];
  const reasonLines: string[] = [];

  const plainText = stripHtmlTagsFromReason(he.decode(reason));

  for (const line of plainText.split(/\r?\n/)) {
    const trimmedLine = line.replace(/\s+/g, " ").trim();
    if (trimmedLine.startsWith("Action failures:")) {
      actionFailureMessages.push(
        ...getActionFailureMessages(
          trimmedLine.slice("Action failures:".length),
        ),
      );
    } else {
      reasonLines.push(trimmedLine);
    }
  }

  return {
    reason: reasonLines.join("\n").trim(),
    actionFailureMessages,
  };
}

function stripHtmlTagsFromReason(reason: string) {
  let plainText = "";

  for (let index = 0; index < reason.length; index++) {
    const char = reason[index];
    if (char !== "<") {
      plainText += char;
      continue;
    }

    const tagStart = index + (reason[index + 1] === "/" ? 2 : 1);
    const tagName = readTagName(reason, tagStart);
    if (!tagName) {
      plainText += char;
      continue;
    }

    const tagEnd = reason.indexOf(">", tagStart + tagName.length);
    if (tagEnd === -1) {
      plainText += char;
      continue;
    }

    if (BLOCK_REASON_TAGS.has(tagName)) plainText += " ";
    index = tagEnd;
  }

  return plainText;
}

const BLOCK_REASON_TAGS = new Set([
  "p",
  "div",
  "br",
  "li",
  "ul",
  "ol",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);

function readTagName(value: string, start: number) {
  let tagName = "";

  for (let index = start; index < value.length; index++) {
    const char = value[index]?.toLowerCase();
    if (!char) break;

    const isTagNameChar =
      (char >= "a" && char <= "z") ||
      (tagName.length > 0 && char >= "0" && char <= "9");
    if (!isTagNameChar) break;

    tagName += char;
  }

  return tagName;
}

function getActionFailureMessages(failures: string): string[] {
  return failures
    .split(",")
    .map((failure) => failure.trim())
    .filter(Boolean)
    .map((failure) => {
      const separatorIndex = failure.indexOf(":");
      if (separatorIndex === -1) return getActionFailureMessage(failure, "");

      return getActionFailureMessage(
        failure.slice(0, separatorIndex),
        failure.slice(separatorIndex + 1),
      );
    });
}

const ACTION_FAILURE_MESSAGES: Partial<
  Record<ActionType, { fallback: string; codes: Record<string, string> }>
> = {
  [ActionType.DRAFT_MESSAGING_CHANNEL]: {
    fallback: "The draft reply action could not be completed.",
    codes: {
      MESSAGING_DELIVERY_FAILED:
        "The draft reply could not be sent to the messaging channel.",
      MISSING_MESSAGING_CHANNEL:
        "The draft reply action needs a messaging channel.",
    },
  },
  [ActionType.NOTIFY_MESSAGING_CHANNEL]: {
    fallback: "The messaging channel notification could not be completed.",
    codes: {
      MESSAGING_DELIVERY_FAILED:
        "The messaging channel notification could not be sent.",
      MISSING_MESSAGING_CHANNEL:
        "The messaging channel notification needs a channel.",
    },
  },
  [ActionType.NOTIFY_SENDER]: {
    fallback: "The sender notification could not be completed.",
    codes: {
      RESEND_NOT_CONFIGURED:
        "The sender notification could not be sent because email sending is not configured.",
      MISSING_SENDER_EMAIL:
        "The sender notification could not be sent because the sender email could not be found.",
      SEND_FAILED: "The sender notification could not be sent.",
    },
  },
  // Only the action type and error code survive in the stored reason, so this
  // copy stays integration-neutral. The executor records a message naming the
  // integration alongside it.
  [ActionType.INTEGRATION]: {
    fallback: "The integration action could not be completed.",
    codes: {
      INTEGRATION_NOT_CONNECTED:
        "The integration isn't connected. Connect it on the Integrations page.",
      MISSING_INTEGRATION_ARGS:
        "The integration action could not run because a required field was empty.",
      INTEGRATION_CALL_FAILED: "The integration action could not be completed.",
      INTEGRATION_AUTH_FAILED:
        "The integration rejected the connection. Reconnect it on the Integrations page.",
      INTEGRATION_RATE_LIMITED:
        "The integration is limiting requests right now, so nothing was created. Try again later.",
      INTEGRATION_NOT_SENT:
        "The request never reached the integration, so nothing was created.",
      INTEGRATION_MAYBE_SENT:
        "The integration didn't confirm the request, so the item may have been created; check the app before re-running.",
    },
  },
};

function getActionFailureMessage(actionType: string, errorCode: string) {
  const entry = Object.hasOwn(ACTION_FAILURE_MESSAGES, actionType)
    ? ACTION_FAILURE_MESSAGES[actionType as ActionType]
    : undefined;
  if (!entry) return "An action could not be completed.";
  return Object.hasOwn(entry.codes, errorCode)
    ? entry.codes[errorCode]
    : entry.fallback;
}
