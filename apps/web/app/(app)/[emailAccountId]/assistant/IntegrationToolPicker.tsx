import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { MutedText } from "@/components/Typography";
import {
  getIntegrationToolChoices,
  type IntegrationToolChoice,
} from "@/utils/integrations/editor";
import { PLACEHOLDER_NAMES } from "@/utils/integrations/placeholders";

export function IntegrationToolPicker({
  integration,
  tool,
  onSelect,
}: {
  integration: string | null | undefined;
  tool: string | null | undefined;
  onSelect: (choice: IntegrationToolChoice) => void;
}) {
  const choices = getIntegrationToolChoices();
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
          if (choice) onSelect(choice);
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
            >
              {choice.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
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
