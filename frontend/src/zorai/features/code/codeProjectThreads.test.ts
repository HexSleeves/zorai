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

  it("defensively handles malformed remote owner strings", () => {
    const malformed = thread({ id: "a", agent_name: undefined as unknown as string });
    expect(actualThreadResponder(malformed)).toEqual({ id: "swarog", name: "swarog" });
  });

  it("falls back to the persisted thread owner", () => {
    expect(actualThreadResponder(thread({ id: "a", agent_name: "Rarog", targetAgentId: "rarog" })))
      .toEqual({ id: "rarog", name: "Rarog" });
  });
});

describe("projectThreadsForRoot", () => {
  it("includes only recorded project threads with an exact canonical-root association", () => {
    const result = projectThreadsForRoot({
      root: "/work/a",
      localThreads: [thread({ id: "a" }), thread({ id: "b" }), thread({ id: "none" })],
      daemonThreads: [],
      contextsByLocalThreadId: { a: context("/work/a"), b: context("/work/b") },
      projectThreadIds: ["a"],
    });
    expect(result.map((entry) => entry.localThread.id)).toEqual(["a"]);
  });

  it("excludes ordinary threads that merely viewed the same root", () => {
    // Regression guard: every thread the daemon listed used to appear in the
    // Code project-thread history because context-root equality alone was
    // treated as membership.
    const result = projectThreadsForRoot({
      root: "/work/a",
      localThreads: [thread({ id: "project" }), thread({ id: "unrelated" })],
      daemonThreads: [],
      contextsByLocalThreadId: { project: context("/work/a"), unrelated: context("/work/a") },
      projectThreadIds: ["project"],
    });
    expect(result.map((entry) => entry.localThread.id)).toEqual(["project"]);
  });

  it("matches recorded daemon ids to local threads", () => {
    const result = projectThreadsForRoot({
      root: "/work/a",
      localThreads: [thread({ id: "local", daemonThreadId: "daemon-1" }), thread({ id: "other" })],
      daemonThreads: [],
      contextsByLocalThreadId: { local: context("/work/a"), other: context("/work/a") },
      projectThreadIds: ["daemon-1"],
    });
    expect(result.map((entry) => entry.localThread.id)).toEqual(["local"]);
  });

  it("returns nothing when no project threads are recorded for the root", () => {
    expect(projectThreadsForRoot({
      root: "/work/a",
      localThreads: [thread({ id: "a" })],
      daemonThreads: [],
      contextsByLocalThreadId: { a: context("/work/a") },
      projectThreadIds: [],
    })).toEqual([]);
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
      projectThreadIds: ["d1", "d2"],
    });
    expect(result.map((entry) => entry.thread.title)).toEqual(["Remote A", "Local B"]);
    expect(result[0]?.localThread.id).toBe("a");
  });

  it("sorts parseable timestamps ahead of invalid updatedAt values", () => {
    const result = projectThreadsForRoot({
      root: "/work/a",
      localThreads: [
        thread({ id: "invalid", updatedAt: "not-a-date" as unknown as number }),
        thread({ id: "dated", updatedAt: "2026-08-24T12:00:00Z" as unknown as number }),
        thread({ id: "numeric", updatedAt: "100" as unknown as number }),
      ],
      daemonThreads: [],
      contextsByLocalThreadId: { invalid: context("/work/a"), dated: context("/work/a"), numeric: context("/work/a") },
      projectThreadIds: ["invalid", "dated", "numeric"],
    });

    expect(result.map((entry) => entry.localThread.id)).toEqual(["dated", "numeric", "invalid"]);
  });

  it("keeps local pre-daemon project threads", () => {
    const local = thread({ id: "local", daemonThreadId: null, updatedAt: 5 });
    expect(projectThreadsForRoot({
      root: "/work/a",
      localThreads: [local],
      daemonThreads: [],
      contextsByLocalThreadId: { local: context("/work/a") },
      projectThreadIds: ["local"],
    })).toHaveLength(1);
  });
});

describe("filterCodeProjectThreads", () => {
  it("defensively searches entries with malformed remote display fields", () => {
    const entries = projectThreadsForRoot({
      root: "/work/a",
      localThreads: [thread({ id: "a", title: undefined as unknown as string, lastMessagePreview: undefined as unknown as string })],
      daemonThreads: [],
      contextsByLocalThreadId: { a: context("/work/a") },
      projectThreadIds: ["a"],
    });
    expect(filterCodeProjectThreads(entries, "missing")).toEqual([]);
  });

  it("searches title, responder and preview without changing newest-first order", () => {
    const entries = projectThreadsForRoot({
      root: "/work/a",
      localThreads: [
        thread({ id: "new", title: "New UI", agent_name: "Perun", updatedAt: 30 }),
        thread({ id: "old", title: "Old task", lastMessagePreview: "palette", updatedAt: 10 }),
      ],
      daemonThreads: [],
      contextsByLocalThreadId: { new: context("/work/a"), old: context("/work/a") },
      projectThreadIds: ["new", "old"],
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
