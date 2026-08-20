import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@/lib/agentStore";
import { threadTurnIsActive } from "@/components/agent-chat-panel/runtime/threadTurnState";
import {
  createQueuedComposerMessage,
  queuedComposerLabel,
  shouldDispatchQueuedFollowUp,
} from "./composerQueue";

describe("queued composer follow-ups", () => {
  it("keeps media blocks on a queued payload instead of flattening to text", () => {
    const queued = createQueuedComposerMessage({
      text: "",
      contentBlocksJson: '[{"type":"image","data_url":"data:image/png;base64,abc"}]',
      localContentBlocks: [{ type: "image", data_url: "data:image/png;base64,abc", mime_type: "image/png" }],
    });

    expect(queued.contentBlocksJson).toContain("image");
    expect(queued.localContentBlocks).toHaveLength(1);
    expect(queuedComposerLabel(queued)).toBe("(attachment)");
  });

  it("does not dispatch the next follow-up until the in-flight send has started streaming", () => {
    expect(shouldDispatchQueuedFollowUp({
      isStreaming: false,
      awaitingStreamStart: false,
      hasSendNow: false,
      queueLength: 2,
    })).toBe(true);

    expect(shouldDispatchQueuedFollowUp({
      isStreaming: false,
      awaitingStreamStart: true,
      hasSendNow: false,
      queueLength: 1,
    })).toBe(false);
  });

  it("holds the remaining queue while a send-now interrupt is waiting for the stream to close", () => {
    expect(shouldDispatchQueuedFollowUp({
      isStreaming: true,
      awaitingStreamStart: false,
      hasSendNow: true,
      queueLength: 1,
    })).toBe(false);
  });

  it("does not auto-send the next follow-up during the tool_call gap", () => {
    const isStreaming = threadTurnIsActive([
      {
        id: "asst-1",
        threadId: "thread-1",
        createdAt: 1,
        role: "assistant",
        content: "Calling tools...",
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        isCompactionSummary: false,
        isStreaming: false,
      } satisfies AgentMessage,
      {
        id: "tool-1",
        threadId: "thread-1",
        createdAt: 2,
        role: "tool",
        content: "",
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        isCompactionSummary: false,
        toolCallId: "call-1",
        toolName: "read_file",
        toolStatus: "requested",
      } satisfies AgentMessage,
    ]);

    expect(shouldDispatchQueuedFollowUp({
      isStreaming,
      awaitingStreamStart: false,
      hasSendNow: true,
      queueLength: 1,
    })).toBe(false);
  });
});
