import { describe, expect, it } from "vitest";
import { isWaitingForReply } from "./messages";
import type { ChatMessage } from "@/components/assistant-chat/types";

const userMessage = {
  id: "user-1",
  role: "user",
  parts: [{ type: "text", text: "What rules do I have?" }],
} as ChatMessage;

function assistantMessage(parts: unknown[]) {
  return { id: "assistant-1", role: "assistant", parts } as ChatMessage;
}

describe("isWaitingForReply", () => {
  it("waits while the request is submitted", () => {
    expect(isWaitingForReply("submitted", [userMessage])).toBe(true);
  });

  it("keeps waiting when the reply stream has started but shows nothing yet", () => {
    const messages = [
      userMessage,
      assistantMessage([{ type: "step-start" }, { type: "text", text: "" }]),
    ];

    expect(isWaitingForReply("streaming", messages)).toBe(true);
  });

  it("stops waiting once reply text arrives", () => {
    const messages = [
      userMessage,
      assistantMessage([{ type: "text", text: "You have 3 rules." }]),
    ];

    expect(isWaitingForReply("streaming", messages)).toBe(false);
  });

  it("stops waiting once a tool call shows", () => {
    const messages = [
      userMessage,
      assistantMessage([
        { type: "tool-getUserRulesAndSettings", state: "input-available" },
      ]),
    ];

    expect(isWaitingForReply("streaming", messages)).toBe(false);
  });

  it("does not wait when the chat is idle", () => {
    expect(isWaitingForReply("ready", [userMessage])).toBe(false);
  });
});
