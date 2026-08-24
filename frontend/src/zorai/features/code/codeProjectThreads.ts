import type { AgentThread } from "@/lib/agentStore";
import type { ThreadWorkspaceContext } from "@/lib/workspaceContextStore";

export type CodeProjectThreadStatus = "needs_operator_action" | "working" | "done_unread" | "idle";

export type CodeProjectThreadEvidence = {
  needsOperatorAction: boolean;
  working: boolean;
  latestCompletionAt: number | null;
  lastReadAt: number | null;
  /** Deliberately ignored: status never derives from arbitrary prose. */
  ignoredText?: string;
};

export type CodeProjectThreadEntry = {
  /** Local thread object used to open and bind renderer state. */
  localThread: AgentThread;
  /** Best available display/runtime metadata after daemon overlay. */
  thread: AgentThread;
  identity: string;
  responder: { id: string; name: string };
};

export type ProjectThreadsForRootInput = {
  root: string | null;
  localThreads: AgentThread[];
  daemonThreads: AgentThread[];
  contextsByLocalThreadId: Record<string, ThreadWorkspaceContext>;
  /** Explicit project-thread membership for the root (daemon or local ids). */
  projectThreadIds: string[];
};

export function actualThreadResponder(thread: AgentThread): { id: string; name: string } {
  const fallbackName = typeof thread.agent_name === "string" ? thread.agent_name.trim() : "";
  const stack = thread.threadHandoffState?.responderStack ?? [];
  const active = stack[stack.length - 1];
  if (active?.agentId?.trim()) {
    return { id: active.agentId.trim(), name: active.agentName?.trim() || active.agentId.trim() };
  }
  const id = thread.targetAgentId?.trim() || thread.threadHandoffState?.activeAgentId?.trim() || fallbackName || "swarog";
  return { id, name: fallbackName || id };
}

export function authoritativeThreadIdentity(thread: AgentThread): string {
  return thread.daemonThreadId?.trim() || thread.id;
}

function overlayThread(local: AgentThread, daemon: AgentThread | undefined): AgentThread {
  if (!daemon) return local;
  // Keep the local id because all renderer stores are keyed by it; daemon
  // metadata owns title/runtime timestamps and the authoritative daemon id.
  return { ...local, ...daemon, id: local.id, daemonThreadId: daemon.daemonThreadId ?? local.daemonThreadId };
}

export function projectThreadsForRoot({
  root,
  localThreads,
  daemonThreads,
  contextsByLocalThreadId,
  projectThreadIds,
}: ProjectThreadsForRootInput): CodeProjectThreadEntry[] {
  const canonicalRoot = root?.trim();
  if (!canonicalRoot) return [];

  // Membership is explicit (recorded by the Code surface), never inferred
  // from context roots: ordinary threads that merely viewed the same folder
  // must not appear in project history.
  const members = new Set(projectThreadIds.map((id) => id.trim()).filter(Boolean));
  if (members.size === 0) return [];

  const daemonById = new Map<string, AgentThread>();
  for (const thread of daemonThreads) {
    const id = thread.daemonThreadId?.trim() || thread.id.trim();
    if (id) daemonById.set(id, thread);
  }

  return localThreads
    .filter((thread) => members.has(thread.daemonThreadId?.trim() ?? "") || members.has(thread.id))
    .filter((thread) => contextsByLocalThreadId[thread.id]?.root === canonicalRoot)
    .map((localThread) => {
      const daemonId = localThread.daemonThreadId?.trim();
      const thread = overlayThread(localThread, daemonId ? daemonById.get(daemonId) : undefined);
      return {
        localThread,
        thread,
        identity: authoritativeThreadIdentity(thread),
        responder: actualThreadResponder(thread),
      };
    })
    .sort((left, right) => normalizeUpdatedAt(right.thread.updatedAt) - normalizeUpdatedAt(left.thread.updatedAt));
}

function normalizeUpdatedAt(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

export function filterCodeProjectThreads<T extends CodeProjectThreadEntry>(
  entries: T[],
  query: string,
): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return entries;
  return entries.filter(({ thread, responder }) =>
    (typeof thread.title === "string" ? thread.title : "").toLowerCase().includes(needle)
    || (typeof thread.lastMessagePreview === "string" ? thread.lastMessagePreview : "").toLowerCase().includes(needle)
    || responder.name.toLowerCase().includes(needle));
}

export function resolveCodeProjectThreadStatus(
  evidence: CodeProjectThreadEvidence,
): CodeProjectThreadStatus {
  if (evidence.needsOperatorAction) return "needs_operator_action";
  if (evidence.working) return "working";
  if (
    evidence.latestCompletionAt !== null
    && evidence.latestCompletionAt > (evidence.lastReadAt ?? Number.NEGATIVE_INFINITY)
  ) {
    return "done_unread";
  }
  return "idle";
}

export function statusPresentation(
  status: CodeProjectThreadStatus,
): { label: string; dot: "amber" | "blue" | "green" | null } {
  switch (status) {
    case "needs_operator_action":
      return { label: "Needs operator action", dot: "amber" };
    case "working":
      return { label: "Working", dot: "blue" };
    case "done_unread":
      return { label: "Done · unread", dot: "green" };
    default:
      return { label: "Idle", dot: null };
  }
}
