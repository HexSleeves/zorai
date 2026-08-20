import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@/lib/agentStore";
import { finalizeThreadTurnMessages, threadTurnIsActive } from "./threadTurnState";

function message(partial: Partial<AgentMessage> & Pick<AgentMessage, "id" | "role">): AgentMessage {
  return {
    threadId: "thread-1",
    createdAt: 1,
    content: "",
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    isCompactionSummary: false,
    ...partial,
  };
}

describe("threadTurnIsActive", () => {
  it("stays active while a tool call is in flight even if the last assistant is no longer streaming", () => {
    // Why: the composer used to treat tool_call's isStreaming=false gap as "turn
    // finished" and dispatch the next queued follow-up onto a still-running daemon turn.
    expect(threadTurnIsActive([
      message({ id: "user-1", role: "user", content: "do the work" }),
      message({ id: "asst-1", role: "assistant", content: "Calling tools...", isStreaming: false }),
      message({ id: "tool-1", role: "tool", toolCallId: "call-1", toolName: "read_file", toolStatus: "requested" }),
    ])).toBe(true);
  });

  it("clears after the matching tool result arrives and no assistant is streaming", () => {
    expect(threadTurnIsActive([
      message({ id: "asst-1", role: "assistant", content: "Calling tools...", isStreaming: false }),
      message({ id: "tool-1", role: "tool", toolCallId: "call-1", toolName: "read_file", toolStatus: "requested" }),
      message({ id: "tool-1-done", role: "tool", toolCallId: "call-1", toolName: "read_file", toolStatus: "done", content: "ok" }),
    ])).toBe(false);
  });

  it("stays active for a leftover buried streaming assistant after a later message is finalized", () => {
    // Why: a mid-turn queued send can bury the previous streaming placeholder.
    // isStreamingResponse used .some(), so this leftover kept the UI working forever
    // and blocked later queue/send-now dispatch unless every streaming flag is cleared.
    expect(threadTurnIsActive([
      message({ id: "asst-stale", role: "assistant", content: "", isStreaming: true }),
      message({ id: "user-2", role: "user", content: "queued follow-up" }),
      message({ id: "asst-final", role: "assistant", content: "done", isStreaming: false }),
    ])).toBe(true);
  });

  it("clears after stop finalizes leftover in-flight tool rows", () => {
    // Why: abort in the tool_call gap only used to clear assistant isStreaming.
    // requested/executing rows then kept threadTurnIsActive true, so the composer
    // queued instead of sending the next follow-up.
    const messages = [
      message({ id: "asst-1", role: "assistant", content: "Calling tools...", isStreaming: false }),
      message({ id: "tool-1", role: "tool", toolCallId: "call-1", toolName: "read_file", toolStatus: "requested" }),
    ];
    expect(threadTurnIsActive(messages)).toBe(true);
    expect(threadTurnIsActive(finalizeThreadTurnMessages(messages))).toBe(false);
  });
});

describe("finalizeThreadTurnMessages", () => {
  it("closes leftover executing tools as stopped errors without touching completed ones", () => {
    const finalized = finalizeThreadTurnMessages([
      message({ id: "tool-open", role: "tool", toolCallId: "call-1", toolName: "read_file", toolStatus: "executing" }),
      message({ id: "tool-done", role: "tool", toolCallId: "call-2", toolName: "read_file", toolStatus: "done", content: "ok" }),
      message({ id: "asst-stale", role: "assistant", content: "", isStreaming: true }),
    ]);

    expect(finalized[0]).toMatchObject({ toolStatus: "error", content: "(stopped)" });
    expect(finalized[1]).toMatchObject({ toolStatus: "done", content: "ok" });
    expect(finalized[2]?.isStreaming).toBe(false);
  });
});
