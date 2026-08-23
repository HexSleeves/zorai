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
};

export function actualThreadResponder(thread: AgentThread): { id: string; name: string } {
  const stack = thread.threadHandoffState?.responderStack ?? [];
  const active = stack[stack.length - 1];
  if (active?.agentId?.trim()) {
    return { id: active.agentId.trim(), name: active.agentName?.trim() || active.agentId.trim() };
  }
  const id = thread.targetAgentId?.trim() || thread.threadHandoffState?.activeAgentId?.trim() || thread.agent_name.trim();
  return { id, name: thread.agent_name.trim() || id };
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
}: ProjectThreadsForRootInput): CodeProjectThreadEntry[] {
  const canonicalRoot = root?.trim();
  if (!canonicalRoot) return [];
  const daemonById = new Map<string, AgentThread>();
  for (const thread of daemonThreads) {
    const id = thread.daemonThreadId?.trim() || thread.id.trim();
    if (id) daemonById.set(id, thread);
  }

  return localThreads
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
    .sort((left, right) => right.thread.updatedAt - left.thread.updatedAt);
}

export function filterCodeProjectThreads(
  entries: CodeProjectThreadEntry[],
  query: string,
): CodeProjectThreadEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return entries;
  return entries.filter(({ thread, responder }) =>
    thread.title.toLowerCase().includes(needle)
    || thread.lastMessagePreview.toLowerCase().includes(needle)
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
