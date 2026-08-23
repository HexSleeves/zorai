import { describe, expect, it } from "vitest";
import type { AgentThread } from "@/lib/agentStore";
import type { ThreadWorkspaceContext } from "@/lib/workspaceContextStore";
import {
  actualThreadResponder,
  filterCodeProjectThreads,
  projectThreadsForRoot,
  resolveCodeProjectThreadStatus,
  statusPresentation,
} from "./codeProjectThreads";

function thread(overrides: Partial<AgentThread> & Pick<AgentThread, "id">): AgentThread {
  return {
    id: overrides.id,
    daemonThreadId: null,
    workspaceId: null,
    surfaceId: null,
    paneId: null,
    agent_name: "Svarog",
    title: overrides.id,
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

function context(root: string): ThreadWorkspaceContext {
  return {
    root,
    activeFile: null,
    selection: null,
    attachedFiles: [],
    openFiles: [],
    updatedAt: 1,
    isolateAgentTasks: false,
    isolatedWorktreeStates: {},
    pinnedFiles: [],
  };
}

describe("actualThreadResponder", () => {
  it("prefers the top responder-stack frame", () => {
    const value = thread({
      id: "a",
      agent_name: "Svarog",
      threadHandoffState: {
        originAgentId: "swarog",
        activeAgentId: "perun",
        responderStack: [{ agentId: "perun", agentName: "Perun", enteredAt: 5 }],
      },
    });
    expect(actualThreadResponder(value)).toEqual({ id: "perun", name: "Perun" });
  });

  it("falls back to the persisted thread owner", () => {
    expect(actualThreadResponder(thread({ id: "a", agent_name: "Rarog", targetAgentId: "rarog" })))
      .toEqual({ id: "rarog", name: "Rarog" });
  });
});

describe("projectThreadsForRoot", () => {
  it("includes only exact canonical-root associations", () => {
    const result = projectThreadsForRoot({
      root: "/work/a",
      localThreads: [thread({ id: "a" }), thread({ id: "b" }), thread({ id: "none" })],
      daemonThreads: [],
      contextsByLocalThreadId: { a: context("/work/a"), b: context("/work/b") },
    });
    expect(result.map((entry) => entry.localThread.id)).toEqual(["a"]);
  });

  it("overlays daemon metadata by daemon id and sorts newest first", () => {
    const localA = thread({ id: "a", daemonThreadId: "d1", title: "Local A", updatedAt: 10 });
    const localB = thread({ id: "b", daemonThreadId: "d2", title: "Local B", updatedAt: 20 });
    const daemonA = thread({ id: "remote-a", daemonThreadId: "d1", title: "Remote A", updatedAt: 50 });
    const result = projectThreadsForRoot({
      root: "/work/a",
      localThreads: [localA, localB],
      daemonThreads: [daemonA],
      contextsByLocalThreadId: { a: context("/work/a"), b: context("/work/a") },
    });
    expect(result.map((entry) => entry.thread.title)).toEqual(["Remote A", "Local B"]);
    expect(result[0]?.localThread.id).toBe("a");
  });

  it("keeps local pre-daemon project threads", () => {
    const local = thread({ id: "local", daemonThreadId: null, updatedAt: 5 });
    expect(projectThreadsForRoot({
      root: "/work/a",
      localThreads: [local],
      daemonThreads: [],
      contextsByLocalThreadId: { local: context("/work/a") },
    })).toHaveLength(1);
  });
});

describe("filterCodeProjectThreads", () => {
  it("searches title, responder and preview without changing newest-first order", () => {
    const entries = projectThreadsForRoot({
      root: "/work/a",
      localThreads: [
        thread({ id: "new", title: "New UI", agent_name: "Perun", updatedAt: 30 }),
        thread({ id: "old", title: "Old task", lastMessagePreview: "palette", updatedAt: 10 }),
      ],
      daemonThreads: [],
      contextsByLocalThreadId: { new: context("/work/a"), old: context("/work/a") },
    });
    expect(filterCodeProjectThreads(entries, "perun").map((entry) => entry.localThread.id)).toEqual(["new"]);
    expect(filterCodeProjectThreads(entries, "palette").map((entry) => entry.localThread.id)).toEqual(["old"]);
  });
});

describe("resolveCodeProjectThreadStatus", () => {
  it("uses attention > working > done unread > idle precedence", () => {
    expect(resolveCodeProjectThreadStatus({ needsOperatorAction: true, working: true, latestCompletionAt: 300, lastReadAt: 0 })).toBe("needs_operator_action");
    expect(resolveCodeProjectThreadStatus({ needsOperatorAction: false, working: true, latestCompletionAt: 300, lastReadAt: 0 })).toBe("working");
    expect(resolveCodeProjectThreadStatus({ needsOperatorAction: false, working: false, latestCompletionAt: 300, lastReadAt: 200 })).toBe("done_unread");
    expect(resolveCodeProjectThreadStatus({ needsOperatorAction: false, working: false, latestCompletionAt: 300, lastReadAt: 300 })).toBe("idle");
    expect(resolveCodeProjectThreadStatus({ needsOperatorAction: false, working: false, latestCompletionAt: null, lastReadAt: null })).toBe("idle");
  });

  it("does not inspect arbitrary titles or prose", () => {
    expect(resolveCodeProjectThreadStatus({ needsOperatorAction: false, working: false, latestCompletionAt: null, lastReadAt: null, ignoredText: "URGENT approval working done" })).toBe("idle");
  });

  it("provides accessible labels and one dot", () => {
    expect(statusPresentation("needs_operator_action")).toEqual({ label: "Needs operator action", dot: "amber" });
    expect(statusPresentation("working")).toEqual({ label: "Working", dot: "blue" });
    expect(statusPresentation("done_unread")).toEqual({ label: "Done · unread", dot: "green" });
    expect(statusPresentation("idle")).toEqual({ label: "Idle", dot: null });
  });
});
