import { useAgentStore } from "@/lib/agentStore";
import type { AgentMessage } from "@/lib/agentStore";

function isOpenToolCall(message: AgentMessage): boolean {
  return message.role === "tool"
    && (message.toolStatus === "requested" || message.toolStatus === "executing");
}

export function threadTurnIsActive(messages: AgentMessage[]): boolean {
  const openToolCalls = new Set<string>();
  let hasStreamingAssistant = false;

  for (const message of messages) {
    if (message.role === "assistant" && message.isStreaming === true) {
      hasStreamingAssistant = true;
    }
    if (message.role !== "tool" || !message.toolCallId) {
      continue;
    }
    if (message.toolStatus === "requested" || message.toolStatus === "executing") {
      openToolCalls.add(message.toolCallId);
    } else if (message.toolStatus === "done" || message.toolStatus === "error") {
      openToolCalls.delete(message.toolCallId);
    }
  }

  return hasStreamingAssistant || openToolCalls.size > 0;
}

export function finalizeThreadTurnMessages(messages: AgentMessage[]): AgentMessage[] {
  return messages.map((message) => {
    if (message.role === "assistant" && message.isStreaming === true) {
      return { ...message, isStreaming: false };
    }
    if (isOpenToolCall(message)) {
      return {
        ...message,
        toolStatus: "error",
        content: message.content || "(stopped)",
      };
    }
    return message;
  });
}

function threadTurnNeedsFinalization(messages: AgentMessage[]): boolean {
  return messages.some((message) => (
    (message.role === "assistant" && message.isStreaming === true)
    || isOpenToolCall(message)
  ));
}

export function finalizeStreamingAssistantMessages(threadId: string): void {
  useAgentStore.setState((state) => {
    const list = state.messages[threadId];
    if (!list || !threadTurnNeedsFinalization(list)) {
      return state;
    }
    return {
      messages: {
        ...state.messages,
        [threadId]: finalizeThreadTurnMessages(list),
      },
    };
  });
}
