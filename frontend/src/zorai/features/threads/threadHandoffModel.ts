import type { ThreadHandoffState } from "@/lib/agentStore/types";

export type ThreadAgentOption = {
  id: string;
  name: string;
};

export function buildHandoffDefaults(targetAgentName: string): {
  reason: string;
  summary: string;
} {
  const name = targetAgentName.trim() || "selected agent";
  return {
    reason: `Operator requested handoff to ${name}`,
    summary: `Continue this thread as ${name}`,
  };
}

export function canReturnHandoff(
  handoffState: Pick<ThreadHandoffState, "responderStack"> | null | undefined,
): boolean {
  return (handoffState?.responderStack.length ?? 0) > 1;
}

export function buildThreadAgentOptions(
  builtins: readonly ThreadAgentOption[],
  subAgents: readonly ThreadAgentOption[],
  activeAgentId: string | null | undefined,
): ThreadAgentOption[] {
  const active = canonicalAgentId(activeAgentId ?? "");
  const seen = new Set<string>();
  return [...builtins, ...subAgents].flatMap((option) => {
    const id = canonicalAgentId(option.id);
    if (!id || id === active || seen.has(id)) return [];
    seen.add(id);
    return [{ id, name: option.name.trim() || option.id }];
  });
}

function canonicalAgentId(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/_builtin$/, "");
  if (normalized === "svarog" || normalized === "main") return "swarog";
  return normalized;
}
