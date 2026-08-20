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
