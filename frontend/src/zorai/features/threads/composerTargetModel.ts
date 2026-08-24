export type ComposerTarget =
  | { kind: "current"; id: "current"; label: string }
  | { kind: "agent"; id: string; label: string }
  | { kind: "subagent"; id: string; label: string };

export type ComposerSendRoute =
  | { action: "send" }
  | { action: "assign-owner"; agentId: string; agentName: string }
  | { action: "spawn-subagent" }
  | { action: "handoff-agent" };

export function composerTargetValue(target: ComposerTarget): string {
  return `${target.kind}:${target.id}`;
}

export function canAssignComposerOwnerDirectly(
  thread: { daemonThreadId?: string | null; messageCount?: number } | null | undefined,
  loadedMessageCount = 0,
): boolean {
  if (!thread) return false;
  if (thread.daemonThreadId?.trim()) return false;
  return Math.max(thread.messageCount ?? 0, loadedMessageCount) === 0;
}

export function resolveComposerSendRoute(
  target: ComposerTarget,
  canAssignOwner: boolean,
): ComposerSendRoute {
  if (target.kind === "current") return { action: "send" };
  if (canAssignOwner) {
    return { action: "assign-owner", agentId: target.id, agentName: target.label };
  }
  if (target.kind === "subagent") return { action: "spawn-subagent" };
  return { action: "handoff-agent" };
}

export function parseComposerTarget(
  value: string,
  options: ComposerTarget[],
): ComposerTarget {
  return options.find((target) => composerTargetValue(target) === value) ?? options[0];
}

export function targetAfterAcceptedDispatch(target: ComposerTarget): ComposerTarget {
  return target.kind === "subagent"
    ? { kind: "current", id: "current", label: "Current responder" }
    : target;
}

export function shouldPreserveTargetAfterFailure(target: ComposerTarget): boolean {
  return target.kind === "subagent";
}
