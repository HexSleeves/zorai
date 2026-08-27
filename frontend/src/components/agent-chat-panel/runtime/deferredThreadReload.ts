import type { AgentMessage } from "@/lib/agentStore";

const pendingThreadReloads = new Set<string>();

export function deferThreadReload(localThreadId: string): void {
  pendingThreadReloads.add(localThreadId);
}

export function consumeDeferredThreadReload(localThreadId: string): boolean {
  return pendingThreadReloads.delete(localThreadId);
}

export function hasDeferredThreadReload(localThreadId: string): boolean {
  return pendingThreadReloads.has(localThreadId);
}

export function shouldDeferThreadReload(messages: readonly AgentMessage[]): boolean {
  return messages.some((message) =>
    message.isStreaming === true
    || (message.role === "tool"
      && (message.toolStatus === "requested" || message.toolStatus === "executing"))
  );
}

export function clearDeferredThreadReloads(): void {
  pendingThreadReloads.clear();
}
