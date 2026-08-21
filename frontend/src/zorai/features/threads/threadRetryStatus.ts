import { useEffect, useState, useSyncExternalStore } from "react";

export type ThreadRetryPhase = "retrying" | "waiting";

export type ThreadRetryStatus = {
  daemonThreadId: string;
  phase: ThreadRetryPhase;
  attempt: number;
  maxRetries: number;
  delayMs: number;
  failureClass: string;
  message: string;
  receivedAt: number;
};

const statuses = new Map<string, ThreadRetryStatus>();
const listeners = new Set<() => void>();
let statusVersion = 0;

function emit(): void {
  statusVersion += 1;
  for (const listener of listeners) listener();
}

export function subscribeThreadRetryStatuses(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getThreadRetryStatusVersion(): number {
  return statusVersion;
}

export function getThreadRetryStatus(daemonThreadId: string | null | undefined): ThreadRetryStatus | null {
  if (!daemonThreadId) return null;
  return statuses.get(daemonThreadId) ?? null;
}

export function setThreadRetryStatus(status: ThreadRetryStatus): void {
  statuses.set(status.daemonThreadId, status);
  emit();
}

export function clearThreadRetryStatus(daemonThreadId: string | null | undefined): void {
  if (!daemonThreadId) return;
  if (!statuses.delete(daemonThreadId)) return;
  emit();
}

export function retryWaitRemainingMs(status: ThreadRetryStatus, now = Date.now()): number {
  return Math.max(0, status.receivedAt + status.delayMs - now);
}

export function formatThreadRetrySummary(status: ThreadRetryStatus, now = Date.now()): string {
  const seconds = Math.max(1, Math.ceil(retryWaitRemainingMs(status, now) / 1000));
  const failure = status.failureClass.replace(/_/g, " ");
  if (status.phase === "waiting") {
    return `retrying automatically in ${seconds}s · ${failure}`;
  }
  const max = status.maxRetries === 0 ? "∞" : String(status.maxRetries);
  return `retry ${status.attempt}/${max} in ${seconds}s · ${failure}`;
}

export function parseRetryStatusEvent(event: {
  thread_id?: unknown;
  phase?: unknown;
  attempt?: unknown;
  max_retries?: unknown;
  delay_ms?: unknown;
  failure_class?: unknown;
  message?: unknown;
} | null | undefined): ThreadRetryStatus | { daemonThreadId: string; phase: "cleared" } | null {
  const daemonThreadId = typeof event?.thread_id === "string" ? event.thread_id : "";
  if (!daemonThreadId) return null;
  const phase = typeof event?.phase === "string" ? event.phase : "retrying";
  if (phase === "cleared") {
    return { daemonThreadId, phase: "cleared" };
  }
  return {
    daemonThreadId,
    phase: phase === "waiting" ? "waiting" : "retrying",
    attempt: Number(event?.attempt ?? 0) || 0,
    maxRetries: Number(event?.max_retries ?? 0) || 0,
    delayMs: Number(event?.delay_ms ?? 0) || 0,
    failureClass: typeof event?.failure_class === "string" && event.failure_class.trim()
      ? event.failure_class
      : "transient",
    message: typeof event?.message === "string" ? event.message : "",
    receivedAt: Date.now(),
  };
}

export function applyDaemonRetryStatusEvent(event: unknown): void {
  const parsed = parseRetryStatusEvent(event as { thread_id?: unknown });
  if (!parsed) return;
  if (parsed.phase === "cleared") {
    clearThreadRetryStatus(parsed.daemonThreadId);
    return;
  }
  setThreadRetryStatus(parsed);
}

export function useThreadRetryStatus(
  daemonThreadId: string | null | undefined,
  fallbackThreadId?: string | null,
): ThreadRetryStatus | null {
  useSyncExternalStore(
    subscribeThreadRetryStatuses,
    getThreadRetryStatusVersion,
    getThreadRetryStatusVersion,
  );
  const status = getThreadRetryStatus(daemonThreadId) ?? getThreadRetryStatus(fallbackThreadId);
  const [, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!status) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [status?.receivedAt, status?.delayMs, status?.phase]);
  return status;
}
