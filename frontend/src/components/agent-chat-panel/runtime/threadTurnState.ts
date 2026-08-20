import { useAgentStore } from "@/lib/agentStore";
import type { AgentMessage } from "@/lib/agentStore";

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

export function finalizeStreamingAssistantMessages(threadId: string): void {
  useAgentStore.setState((state) => {
    const list = state.messages[threadId];
    if (!list?.some((message) => message.role === "assistant" && message.isStreaming === true)) {
      return state;
    }
    return {
      messages: {
        ...state.messages,
        [threadId]: list.map((message) => (
          message.role === "assistant" && message.isStreaming === true
            ? { ...message, isStreaming: false }
            : message
        )),
      },
    };
  });
}
