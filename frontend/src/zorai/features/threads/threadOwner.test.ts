import { describe, expect, it } from "vitest";
import type { AgentThread, SubAgentDefinition } from "@/lib/agentStore";
import { resolveThreadOwnerAgentId, isSvarogOwner } from "./threadOwner";

function thread(partial: Partial<AgentThread>): AgentThread {
  return {
    id: "t1",
    workspaceId: null,
    surfaceId: null,
    paneId: null,
    agent_name: "Svarog",
    title: "Chat",
    createdAt: 0,
    updatedAt: 0,
    messageCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    compactionCount: 0,
    lastMessagePreview: "",
    ...partial,
  };
}

describe("thread owner resolution", () => {
  it("maps Svarog threads to the protocol swarog id", () => {
    expect(resolveThreadOwnerAgentId(thread({ agent_name: "Svarog" }), [])).toBe("swarog");
    expect(isSvarogOwner("swarog")).toBe(true);
  });

  it("maps concierge and heartbeat threads to rarog", () => {
    expect(resolveThreadOwnerAgentId(thread({ daemonThreadId: "concierge", agent_name: "" }), [])).toBe("rarog");
    expect(resolveThreadOwnerAgentId(thread({ title: "heartbeat: morning" }), [])).toBe("rarog");
    expect(resolveThreadOwnerAgentId(thread({ agent_name: "Rarog" }), [])).toBe("rarog");
  });

  it("resolves named subagents by registry id", () => {
    const subAgents = [{ id: "reviewer_builtin", name: "Code Reviewer" } as SubAgentDefinition];
    expect(resolveThreadOwnerAgentId(thread({ agent_name: "Code Reviewer" }), subAgents)).toBe("reviewer");
  });

  it("prefers the selected target agent over a leftover Svarog name", () => {
    expect(resolveThreadOwnerAgentId(thread({
      agent_name: "Svarog",
      targetAgentId: "mokosh",
    }), [{ id: "mokosh", name: "Mokosh" } as SubAgentDefinition])).toBe("mokosh");
  });
});
