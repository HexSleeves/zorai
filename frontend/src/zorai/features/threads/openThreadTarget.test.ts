import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentChatPanelRuntimeValue } from "@/components/agent-chat-panel/runtime/types";
import { useAgentStore } from "@/lib/agentStore";
import type { AgentThread } from "@/lib/agentStore";
import { openThreadTarget } from "./openThreadTarget";

const agentGetThread = vi.fn();

vi.mock("@/lib/agentDaemonConfig", () => ({
  getAgentBridge: () => ({ agentGetThread }),
}));

function makeThread(id: string, daemonThreadId: string | null): AgentThread {
  return {
    id,
    daemonThreadId,
    workspaceId: null,
    surfaceId: null,
    paneId: null,
    agent_name: "Svarog",
    title: id,
    createdAt: 1,
    updatedAt: 1,
    messageCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    compactionCount: 0,
    lastMessagePreview: "",
    upstreamThreadId: null,
    upstreamTransport: undefined,
    upstreamProvider: null,
    upstreamModel: null,
    upstreamAssistantId: null,
  };
}

function makeRuntime(overrides: Partial<AgentChatPanelRuntimeValue> = {}): AgentChatPanelRuntimeValue {
  return {
    threads: useAgentStore.getState().threads,
    openThread: vi.fn(),
    refreshThreadList: vi.fn(async () => undefined),
    ...overrides,
  } as AgentChatPanelRuntimeValue;
}

describe("openThreadTarget", () => {
  beforeEach(() => {
    agentGetThread.mockReset();
    useAgentStore.setState({
      threads: [makeThread("local-main", "daemon-main")],
      messages: { "local-main": [] },
      todos: { "local-main": [] },
      activeThreadId: "local-main",
      threadHistoryStack: [],
    } as any);
  });

  it("opens a locally known thread without listing every other thread", async () => {
    const runtime = makeRuntime();

    await expect(openThreadTarget(runtime, "daemon-main")).resolves.toBe(true);

    expect(runtime.openThread).toHaveBeenCalledWith("local-main");
    expect(runtime.refreshThreadList).not.toHaveBeenCalled();
    expect(agentGetThread).not.toHaveBeenCalled();
  });

  it("fetches the requested daemon thread by id when it is missing from the local list", async () => {
    agentGetThread.mockResolvedValue({
      id: "daemon-goal",
      title: "Goal execution",
      messages: [{ id: "message-1", role: "assistant", content: "working", timestamp: 10 }],
      total_message_count: 1,
      loaded_message_start: 0,
      loaded_message_end: 1,
    });
    const runtime = makeRuntime();

    await expect(openThreadTarget(runtime, "daemon-goal")).resolves.toBe(true);

    expect(runtime.refreshThreadList).not.toHaveBeenCalled();
    expect(agentGetThread).toHaveBeenCalledWith("daemon-goal", {
      messageLimit: expect.any(Number),
      messageOffset: 0,
    });
    const hydrated = useAgentStore.getState().threads.find((thread) => thread.daemonThreadId === "daemon-goal");
    expect(hydrated?.title).toBe("Goal execution");
    expect(runtime.openThread).toHaveBeenCalledWith(hydrated?.id);
  });

  it("fails closed when the daemon does not have that thread", async () => {
    agentGetThread.mockResolvedValue(null);
    const runtime = makeRuntime();

    await expect(openThreadTarget(runtime, "daemon-missing")).resolves.toBe(false);

    expect(runtime.openThread).not.toHaveBeenCalled();
    expect(useAgentStore.getState().threads).toHaveLength(1);
  });
});
