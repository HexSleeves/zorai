import type { AgentThread } from "@/lib/agentStore";

export function resolveNewThreadTargetAgent(
  thread: AgentThread | undefined,
  daemonThreadId: string | null,
): string | null {
  if (daemonThreadId || thread?.daemonThreadId) {
    return null;
  }
  return thread?.targetAgentId?.trim() || null;
}

let pendingUnboundThreadBindId: string | null = null;

export function notePendingUnboundThreadBind(localThreadId: string | null | undefined): void {
  const id = localThreadId?.trim() || "";
  pendingUnboundThreadBindId = id || null;
}

export function isPendingUnboundThreadBind(localThreadId: string | null | undefined): boolean {
  const id = localThreadId?.trim() || "";
  return Boolean(id) && pendingUnboundThreadBindId === id;
}

export function clearPendingUnboundThreadBind(): void {
  pendingUnboundThreadBindId = null;
}
