import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ErrorMessage } from "@/components/Input";
import { Label } from "@/components/ui/label";
import { MutedText } from "@/components/Typography";
import type { IntegrationToolChoice } from "@/utils/integrations/editor";
import { PLACEHOLDER_NAMES } from "@/utils/integrations/placeholders";

export function IntegrationToolPicker({
  choices,
  errorMessage,
  integration,
  tool,
  onSelect,
}: {
  choices: IntegrationToolChoice[];
  errorMessage?: string;
  integration: string | null | undefined;
  tool: string | null | undefined;
  onSelect: (choice: IntegrationToolChoice) => void;
}) {
  const selected = choices.find(
    (choice) => choice.integration === integration && choice.tool === tool,
  );

  return (
    <div className="space-y-2">
      <Label>Integration action</Label>
      <Select
        value={selected ? getChoiceValue(selected) : ""}
        onValueChange={(nextValue) => {
          const choice = choices.find(
            (option) => getChoiceValue(option) === nextValue,
          );
          if (choice && !choice.disabledReason) onSelect(choice);
        }}
      >
        <SelectTrigger>
          <SelectValue placeholder="Choose an action" />
        </SelectTrigger>
        <SelectContent>
          {choices.map((choice) => (
            <SelectItem
              key={getChoiceValue(choice)}
              value={getChoiceValue(choice)}
              disabled={!!choice.disabledReason}
            >
              {choice.disabledReason
                ? `${choice.label} (${choice.disabledReason})`
                : choice.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {choices.length > 0 &&
      choices.every((choice) => choice.disabledReason) ? (
        <MutedText className="text-xs">
          Connect an app on the Integrations page to use this action.
        </MutedText>
      ) : null}
      {errorMessage ? <ErrorMessage message={errorMessage} /> : null}
    </div>
  );
}

export function IntegrationPlaceholderHint() {
  return (
    <MutedText className="mt-1 text-xs">
      {`Insert details from the email with ${PLACEHOLDER_NAMES.map((name) => `[[${name}]]`).join(", ")}.`}
    </MutedText>
  );
}

function getChoiceValue(choice: IntegrationToolChoice) {
  return `${choice.integration}/${choice.tool}`;
}
