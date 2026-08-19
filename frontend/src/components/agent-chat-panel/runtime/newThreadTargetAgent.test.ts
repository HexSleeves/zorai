import { describe, expect, it } from "vitest";
import type { AgentThread } from "@/lib/agentStore";
import { resolveNewThreadTargetAgent } from "./newThreadTargetAgent";

function thread(overrides: Partial<AgentThread> = {}): AgentThread {
  return {
    id: "thread-1",
    daemonThreadId: null,
    workspaceId: null,
    surfaceId: null,
    paneId: null,
    agent_name: "Code Reviewer",
    targetAgentId: "reviewer",
    title: "Review",
    createdAt: 1,
    updatedAt: 1,
    messageCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    compactionCount: 0,
    lastMessagePreview: "",
    ...overrides,
  };
}

describe("new thread target agent routing", () => {
  it("routes the first message to the selected owner", () => {
    expect(resolveNewThreadTargetAgent(thread(), null)).toBe("reviewer");
  });

  it("does not retarget an existing daemon-linked thread", () => {
    expect(resolveNewThreadTargetAgent(thread({ daemonThreadId: "daemon-1" }), "daemon-1")).toBeNull();
  });

  it("leaves ordinary unscoped threads on the daemon default", () => {
    expect(resolveNewThreadTargetAgent(thread({ targetAgentId: null }), null)).toBeNull();
  });
});
