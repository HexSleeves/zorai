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
  /** Optional durable daemon id map used to heal stale local-thread ids. */
  localToDaemonMap?: Record<string, string>;
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

function normalizeMembers(projectThreadIds: string[], localToDaemonMap?: Record<string, string>): Set<string> {
  const members = new Set<string>();
  for (const raw of projectThreadIds) {
    const id = raw?.trim();
    if (!id) continue;
    members.add(id);
    // Stale local ids like thread_5 from a previous session point at a daemon
    // thread after hydrate. If we have a durable local→daemon map (or can
    // infer from daemonThreads later), also seed the daemon id.
    const mapped = localToDaemonMap?.[id]?.trim();
    if (mapped) members.add(mapped);
  }
  return members;
}

export function projectThreadsForRoot({
  root,
  localThreads,
  daemonThreads,
  contextsByLocalThreadId,
  projectThreadIds,
  localToDaemonMap,
}: ProjectThreadsForRootInput): CodeProjectThreadEntry[] {
  const canonicalRoot = root?.trim();
  if (!canonicalRoot) return [];

  // Membership is explicit (recorded by the Code surface), never inferred
  // from context roots: ordinary threads that merely viewed the same folder
  // must not appear in project history.
  const members = normalizeMembers(projectThreadIds, localToDaemonMap);
  if (members.size === 0) return [];

  const daemonById = new Map<string, AgentThread>();
  for (const thread of daemonThreads) {
    const id = thread.daemonThreadId?.trim() || thread.id.trim();
    if (id) daemonById.set(id, thread);
  }

  const matched: CodeProjectThreadEntry[] = [];
  const seenIdentities = new Set<string>();
  for (const localThread of localThreads) {
    const daemonId = localThread.daemonThreadId?.trim() ?? "";
    const isMember = (daemonId && members.has(daemonId)) || members.has(localThread.id);
    if (!isMember) continue;
    // After app reload contexts are hydrated separately. A stale local id
    // like thread_5 is kept as a member but no context entry exists for
    // the *new* local id (thread_1). In that case relax the root gate and
    // rely on membership — the root binding is the membership itself.
    // As soon as a context is present we still enforce the canonical root.
    const contextForThisLocal = contextsByLocalThreadId[localThread.id];
    const hasContextForThisLocal = Boolean(contextForThisLocal);
    if (hasContextForThisLocal && contextForThisLocal!.root !== canonicalRoot) continue;
    // No context yet (pre-hydrate or locally-created thread before bindRoot)
    // is tolerated: project history is allowed to render until contexts
    // arrive; entries will self-correct after hydrate without disappearing.
    const daemon = daemonId ? daemonById.get(daemonId) : undefined;
    const thread = overlayThread(localThread, daemon);
    const identity = authoritativeThreadIdentity(thread);
    if (seenIdentities.has(identity)) continue;
    seenIdentities.add(identity);
    matched.push({
      localThread,
      thread,
      identity,
      responder: actualThreadResponder(thread),
    });
  }
  // Backfill: members that reference a daemon thread with no local hydrator
  // (stale local id → daemon mapping, or daemon-only history imported after
  // reload). Synthesize a localThread from the daemon record so history does
  // not drop to "only the last one" when hydrate remints local ids.
  for (const member of members) {
    if (seenIdentities.has(member)) continue;
    const daemon = daemonById.get(member);
    if (!daemon) continue;
    // If any matched local already wraps this daemon, skip.
    if (matched.some(entry => entry.thread.daemonThreadId === daemon.daemonThreadId || entry.identity === member)) continue;
    const synthLocal: AgentThread = {
      ...daemon,
      id: daemon.daemonThreadId ?? daemon.id,
      daemonThreadId: daemon.daemonThreadId ?? daemon.id,
    } as AgentThread;
    const identity = authoritativeThreadIdentity(synthLocal);
    if (seenIdentities.has(identity)) continue;
    seenIdentities.add(identity);
    matched.push({
      localThread: synthLocal,
      thread: synthLocal,
      identity,
      responder: actualThreadResponder(synthLocal),
    });
  }
  return matched.sort((left, right) => normalizeUpdatedAt(right.thread.updatedAt) - normalizeUpdatedAt(left.thread.updatedAt));
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
