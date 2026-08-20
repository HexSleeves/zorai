import { beforeEach, describe, expect, it } from "vitest";

import { useAgentStore } from "./store.ts";
import type { AgentThread } from "./types.ts";

function makeThread(id: string): AgentThread {
  const now = 1_000_000;
  return {
    id,
    daemonThreadId: null,
    workspaceId: null,
    surfaceId: null,
    paneId: null,
    agent_name: "zorai",
    title: id,
    createdAt: now,
    updatedAt: now,
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

function resetStoreState(threads: AgentThread[], activeThreadId: string | null, threadHistoryStack: string[]) {
  useAgentStore.setState({
    threads,
    messages: {},
    todos: {},
    activeThreadId,
    threadHistoryStack,
  } as any);
}

describe("agentStore spawned thread navigation", () => {
  beforeEach(() => {
    resetStoreState([makeThread("thread-a"), makeThread("thread-b"), makeThread("thread-c")], "thread-a", []);
  });

  it("pushes the current thread before opening a child", () => {
    const store = useAgentStore.getState() as any;

    store.openSpawnedThread("thread-a", "thread-b");

    expect(useAgentStore.getState().activeThreadId).toBe("thread-b");
    expect((useAgentStore.getState() as any).threadHistoryStack).toEqual(["thread-a"]);
  });

  it("does not duplicate consecutive history entries", () => {
    const store = useAgentStore.getState() as any;

    store.openSpawnedThread("thread-a", "thread-b");
    store.openSpawnedThread("thread-a", "thread-b");

    expect((useAgentStore.getState() as any).threadHistoryStack).toEqual(["thread-a"]);
  });

  it("ignores same-thread navigation requests", () => {
    const store = useAgentStore.getState() as any;

    store.openSpawnedThread("thread-a", "thread-a");

    expect(useAgentStore.getState().activeThreadId).toBe("thread-a");
    expect((useAgentStore.getState() as any).threadHistoryStack).toEqual([]);
  });

  it("pops back to the previous thread", () => {
    resetStoreState([makeThread("thread-a"), makeThread("thread-b"), makeThread("thread-c")], "thread-c", [
      "thread-a",
      "thread-b",
    ]);

    const store = useAgentStore.getState() as any;
    store.goBackThread();

    expect(useAgentStore.getState().activeThreadId).toBe("thread-b");
    expect((useAgentStore.getState() as any).threadHistoryStack).toEqual(["thread-a"]);
  });

  it("skips missing threads while popping history", () => {
    resetStoreState([makeThread("thread-a"), makeThread("thread-c")], "thread-c", [
      "thread-a",
      "thread-missing",
      "thread-b",
    ]);

    const store = useAgentStore.getState() as any;
    store.goBackThread();

    expect(useAgentStore.getState().activeThreadId).toBe("thread-a");
    expect((useAgentStore.getState() as any).threadHistoryStack).toEqual([]);
  });

  it("clears spawned-thread history on ordinary thread switches", () => {
    resetStoreState([makeThread("thread-a"), makeThread("thread-b"), makeThread("thread-c")], "thread-b", [
      "thread-a",
    ]);

    const store = useAgentStore.getState() as any;
    store.setActiveThread("thread-c");

    expect(useAgentStore.getState().activeThreadId).toBe("thread-c");
    expect((useAgentStore.getState() as any).threadHistoryStack).toEqual([]);
  });

  it("keeps the current thread when back history is empty", () => {
    const store = useAgentStore.getState() as any;

    store.goBackThread();

    expect(useAgentStore.getState().activeThreadId).toBe("thread-a");
    expect((useAgentStore.getState() as any).threadHistoryStack).toEqual([]);
  });

  it("creates a thread owned by an explicitly selected agent", () => {
    resetStoreState([], null, []);

    const store = useAgentStore.getState();
    const createdThreadId = store.createThread({
      title: "review-thread",
      agentId: "reviewer",
      agentName: "Code Reviewer",
    });
    const createdThread = useAgentStore.getState().threads.find((thread) => thread.id === createdThreadId);

    expect(createdThread?.agent_name).toBe("Code Reviewer");
    expect(createdThread?.targetAgentId).toBe("reviewer");
  });

  it("clears spawned-thread history when creating a new thread", () => {
    resetStoreState([makeThread("thread-a"), makeThread("thread-b")], "thread-b", ["thread-a"]);

    const store = useAgentStore.getState() as any;
    const createdThreadId = store.createThread({ title: "new-thread" });

    expect(useAgentStore.getState().activeThreadId).toBe(createdThreadId);
    expect((useAgentStore.getState() as any).threadHistoryStack).toEqual([]);
  });
});

describe("agentStore generated thread titles", () => {
  it("replaces titles for local and daemon thread ids", () => {
    const local = makeThread("local-1");
    local.title = "Please review the billing invoice parser";
    local.daemonThreadId = "daemon-1";
    resetStoreState([local, makeThread("thread-b")], "local-1", []);

    useAgentStore.getState().updateThreadTitle("daemon-1", "Billing invoice parser");

    expect(useAgentStore.getState().threads.find((thread) => thread.id === "local-1")?.title).toBe(
      "Billing invoice parser",
    );
    expect(useAgentStore.getState().threads.find((thread) => thread.id === "thread-b")?.title).toBe(
      "thread-b",
    );
  });

  it("ignores empty generated titles", () => {
    resetStoreState([makeThread("thread-a")], "thread-a", []);
    useAgentStore.getState().updateThreadTitle("thread-a", "   ");
    expect(useAgentStore.getState().threads[0]?.title).toBe("thread-a");
  });
});
