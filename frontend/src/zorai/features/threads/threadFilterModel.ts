import { isGatewayAgentThread, isInternalAgentThread } from "@/lib/agentStore/history";
import type { AgentThread, SubAgentDefinition } from "@/lib/agentStore";

export type ThreadFilterTab = "svarog" | "rarog" | "weles" | "goals" | "workspace" | "playgrounds" | "internal" | "gateway" | `agent:${string}`;
export type DateFilterId = "all" | "today" | "7d" | "30d" | "custom";
export const DEFAULT_THREAD_DATE_FILTER: DateFilterId = "7d";

export const fixedThreadTabs: Array<{ id: ThreadFilterTab; label: string }> = [
  { id: "svarog", label: "Svarog" },
  { id: "rarog", label: "Rarog" },
  { id: "weles", label: "Weles" },
  { id: "goals", label: "Goals" },
  { id: "workspace", label: "Workspace" },
  { id: "playgrounds", label: "Playgrounds" },
  { id: "internal", label: "Internal" },
  { id: "gateway", label: "Gateway" },
];

export const dateFilters: Array<{ id: DateFilterId; label: string }> = [
  { id: "all", label: "All" },
  { id: "today", label: "Today" },
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "custom", label: "Range" },
];

export function resolveThreadListSource<T>(
  daemonFilteredThreads: T[] | null,
  fallbackThreads: T[],
): T[] {
  return daemonFilteredThreads ?? fallbackThreads;
}

export function filterThreads(
  threads: AgentThread[],
  options: {
    tab: ThreadFilterTab;
    dateFilter: DateFilterId;
    fromDate: string;
    toDate: string;
    goalThreadIds: Set<string>;
    subAgents?: SubAgentDefinition[];
  },
): AgentThread[] {
  return threads.filter((thread) => matchesThreadTab(thread, options.tab, options.goalThreadIds, options.subAgents ?? []))
    .filter((thread) => matchesThreadDate(thread, options.dateFilter, options.fromDate, options.toDate));
}

export function buildThreadFilterTabs(
  threads: AgentThread[],
  subAgents: SubAgentDefinition[],
  goalThreadIds: Set<string>,
): Array<{ id: ThreadFilterTab; label: string }> {
  const dynamic = new Map<string, string>();
  const aliases = new Map<string, string>();

  for (const subAgent of subAgents) {
    if (subAgent.builtin) {
      continue;
    }
    const id = normalizeAgentTabId(subAgent.id);
    if (!id) {
      continue;
    }
    const label = (subAgent.name ?? "").trim() || displayNameForAgentId(id);
    registerDynamicAgentTab(dynamic, aliases, id, label);
    const nameId = normalizeAgentTabId(subAgent.name);
    if (nameId) {
      aliases.set(nameId, aliases.get(id) ?? id);
    }
  }

  for (const thread of threads) {
    if (
      matchesThreadTab(thread, "goals", goalThreadIds)
      || matchesThreadTab(thread, "workspace", goalThreadIds)
      || matchesThreadTab(thread, "weles", goalThreadIds)
      || matchesThreadTab(thread, "rarog", goalThreadIds)
      || matchesThreadTab(thread, "playgrounds", goalThreadIds)
      || matchesThreadTab(thread, "internal", goalThreadIds)
      || matchesThreadTab(thread, "gateway", goalThreadIds)
    ) {
      continue;
    }
    const id = normalizeAgentTabId(thread.agent_name);
    if (id) {
      registerDynamicAgentTab(dynamic, aliases, id, (thread.agent_name ?? "").trim() || displayNameForAgentId(id));
    }
  }

  return [
    ...fixedThreadTabs,
    ...Array.from(dynamic.entries())
      .sort((left, right) => left[1].localeCompare(right[1]))
      .map(([id, label]) => ({ id: `agent:${id}` as const, label })),
  ];
}

function registerDynamicAgentTab(
  dynamic: Map<string, string>,
  aliases: Map<string, string>,
  id: string,
  label: string,
): void {
  const existingId = aliases.get(id);
  if (existingId) {
    if (label && !dynamic.get(existingId)) {
      dynamic.set(existingId, label);
    }
    return;
  }
  const labelKey = label.trim().toLowerCase();
  const existingByLabel = labelKey ? aliases.get(`label:${labelKey}`) : undefined;
  if (existingByLabel) {
    aliases.set(id, existingByLabel);
    return;
  }
  dynamic.set(id, label);
  aliases.set(id, id);
  if (labelKey) {
    aliases.set(`label:${labelKey}`, id);
  }
}

export function daemonAgentFilterForThreadTab(tab: ThreadFilterTab): string | null {
  if (tab === "svarog") return "svarog";
  if (tab === "rarog") return "rarog";
  if (tab === "weles") return "weles";
  if (tab.startsWith("agent:")) return tab.slice("agent:".length) || null;
  return null;
}

function matchesThreadTab(
  thread: AgentThread,
  tab: ThreadFilterTab,
  goalThreadIds: Set<string>,
  subAgents: SubAgentDefinition[] = [],
): boolean {
  const flags = threadTabFlags(thread, goalThreadIds);
  if (tab === "goals") return flags.isGoal;
  if (tab === "workspace") return flags.isWorkspace;
  if (tab === "weles") return flags.isWeles;
  if (tab === "rarog") return flags.isRarog;
  if (tab === "playgrounds") return flags.isPlayground;
  if (tab === "internal") return flags.isInternal;
  if (tab === "gateway") return flags.isGateway;
  if (tab.startsWith("agent:")) return threadMatchesAgentTab(thread, tab.slice("agent:".length), subAgents, goalThreadIds);
  return flags.agentId === "svarog" && matchesSvarogTabExclusions(thread, goalThreadIds);
}

function threadMatchesAgentTab(
  thread: AgentThread,
  agentTabId: string,
  subAgents: SubAgentDefinition[],
  goalThreadIds: Set<string>,
): boolean {
  if (!matchesSvarogTabExclusions(thread, goalThreadIds)) {
    return false;
  }
  const flags = threadTabFlags(thread, goalThreadIds);
  if (flags.agentId === agentTabId) {
    return true;
  }
  const wantedName = (thread.agent_name ?? "").trim().toLowerCase();
  if (!wantedName) {
    return false;
  }
  return subAgents.some((entry) => (
    normalizeAgentTabId(entry.id) === agentTabId
    && (entry.name ?? "").trim().toLowerCase() === wantedName
  ));
}

function matchesSvarogTabExclusions(thread: AgentThread, goalThreadIds: Set<string>): boolean {
  const flags = threadTabFlags(thread, goalThreadIds);
  return !flags.isGoal && !flags.isWorkspace && !flags.isWeles && !flags.isRarog && !flags.isPlayground && !flags.isInternal && !flags.isGateway;
}

function threadTabFlags(thread: AgentThread, goalThreadIds: Set<string>): {
  agentId: string | null;
  isGoal: boolean;
  isWorkspace: boolean;
  isWeles: boolean;
  isRarog: boolean;
  isPlayground: boolean;
  isInternal: boolean;
  isGateway: boolean;
} {
  const identities = [thread.daemonThreadId, thread.id].filter((value): value is string => Boolean(value)).map((value) => value.toLowerCase());
  const title = (thread.title ?? "").trim().toLowerCase();
  const agentId = canonicalThreadAgentId(thread.agent_name);
  return {
    agentId,
    isGoal: Boolean((thread.daemonThreadId && goalThreadIds.has(thread.daemonThreadId)) || goalThreadIds.has(thread.id) || identities.some((id) => id.startsWith("goal:"))),
    isWorkspace: Boolean(thread.workspaceId) || identities.some((id) => id.startsWith("workspace-thread:")),
    isWeles: agentId === "weles" || title.includes("weles"),
    isRarog: agentId === "rarog" || agentId === "concierge" || title === "concierge" || title.startsWith("heartbeat"),
    isPlayground: identities.some((id) => id.startsWith("playground:")) || title.startsWith("participant playground"),
    isInternal: isInternalAgentThread(thread),
    isGateway: isGatewayAgentThread(thread),
  };
}

export function canonicalThreadAgentId(value: string | null | undefined): string | null {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) return null;
  if (["svarog", "swarog", "main", "main-agent", "zorai"].includes(normalized)) return "svarog";
  if (normalized === "weles") return "weles";
  if (normalized === "rarog") return "rarog";
  if (normalized === "concierge") return "concierge";
  return normalized.replace(/_builtin$/, "");
}

function normalizeAgentTabId(value: string | null | undefined): string | null {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized || ["svarog", "swarog", "main", "zorai", "zorai", "rarog", "concierge", "weles"].includes(normalized)) {
    return null;
  }
  return normalized.replace(/_builtin$/, "");
}

function displayNameForAgentId(agentId: string): string {
  return agentId.split(/[-_\s]+/).filter(Boolean).map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(" ") || agentId;
}

export function normalizeEpochMs(value: number | null | undefined): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = n < 1_000_000_000_000 ? n * 1000 : n;
  if (ms < 1_000_000_000_000) return null;
  return ms;
}

function matchesThreadDate(thread: AgentThread, dateFilter: DateFilterId, fromDate: string, toDate: string): boolean {
  if (dateFilter === "all") return true;
  const updatedMs = normalizeEpochMs(thread.updatedAt);
  if (updatedMs == null) return true;
  const now = Date.now();
  if (dateFilter === "today") return new Date(updatedMs).toDateString() === new Date(now).toDateString();
  if (dateFilter === "7d") return updatedMs >= now - 7 * 24 * 60 * 60 * 1000;
  if (dateFilter === "30d") return updatedMs >= now - 30 * 24 * 60 * 60 * 1000;
  const from = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : Number.NEGATIVE_INFINITY;
  const to = toDate ? new Date(`${toDate}T23:59:59`).getTime() : Number.POSITIVE_INFINITY;
  return updatedMs >= from && updatedMs <= to;
}
