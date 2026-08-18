import type { AgentThread, SubAgentDefinition } from "@/lib/agentStore";
import { canonicalThreadAgentId } from "./threadFilterModel";

export const SWAROG_AGENT_ID = "swarog";
export const RAROG_AGENT_ID = "rarog";

export function isSvarogOwner(agentId: string): boolean {
  const normalized = agentId.trim().toLowerCase();
  return normalized === SWAROG_AGENT_ID || normalized === "svarog" || normalized === "main";
}

export function resolveThreadOwnerAgentId(
  thread: AgentThread,
  subAgents: SubAgentDefinition[],
): string {
  const identities = [thread.daemonThreadId, thread.id]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase());
  if (identities.includes("concierge")) {
    return RAROG_AGENT_ID;
  }

  const title = (thread.title ?? "").trim().toLowerCase();
  if (title === "concierge" || title.startsWith("heartbeat")) {
    return RAROG_AGENT_ID;
  }

  const agentName = (thread.agent_name ?? "").trim();
  const canonical = canonicalThreadAgentId(agentName);
  if (canonical === "svarog") {
    return SWAROG_AGENT_ID;
  }
  if (canonical === "rarog" || canonical === "concierge") {
    return RAROG_AGENT_ID;
  }
  if (canonical === "weles") {
    return "weles";
  }

  const wantedName = agentName.toLowerCase();
  const matched = subAgents.find((entry) => {
    const entryId = (entry.id ?? "").trim().toLowerCase().replace(/_builtin$/, "");
    const entryName = (entry.name ?? "").trim().toLowerCase();
    return entryId === canonical || entryName === wantedName;
  });
  if (matched) {
    return matched.id.replace(/_builtin$/i, "").toLowerCase();
  }

  return canonical || SWAROG_AGENT_ID;
}
