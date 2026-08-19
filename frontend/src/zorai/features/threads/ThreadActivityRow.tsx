import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  OperationStatusView,
  ThreadMutationResult,
} from "@/components/agent-chat-panel/runtime/types";
import type {
  OperationActivityItem,
  ThreadActivity,
} from "./threadActivityModel";

const POLL_DELAYS_MS = [1_000, 2_000, 4_000, 8_000] as const;

export function ThreadActivityRow({
  activity,
  createdAt,
  onRefreshOperation,
  onCancelOperation,
}: {
  activity: ThreadActivity;
  createdAt: number;
  onRefreshOperation: (operationId: string) => Promise<OperationStatusView | null>;
  onCancelOperation: (operationId: string) => Promise<ThreadMutationResult>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, OperationStatusView>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generationRef = useRef(0);
  const pollStepRef = useRef(0);
  const operations = useMemo(
    () => activity.kind === "operation" ? activity.operations : [],
    [activity],
  );
  const activityKey = useMemo(
    () => `${activity.kind}:${activity.rawText}`,
    [activity.kind, activity.rawText],
  );

  useEffect(() => {
    generationRef.current += 1;
    pollStepRef.current = 0;
    setStatuses({});
    setBusyId(null);
    setError(null);
    return () => {
      generationRef.current += 1;
    };
  }, [activityKey]);

  const operationState = useCallback((operation: OperationActivityItem) => (
    statuses[operation.operationId]?.state ?? operation.state
  ), [statuses]);

  const refresh = useCallback(async (operationId: string) => {
    if (!operationId || operationId === "unknown") return null;
    const generation = generationRef.current;
    setBusyId(operationId);
    setError(null);
    try {
      const next = await onRefreshOperation(operationId);
      if (generation !== generationRef.current) return null;
      if (next) {
        setStatuses((current) => ({ ...current, [operationId]: next }));
      }
      return next;
    } catch (reason) {
      if (generation === generationRef.current) {
        setError(reason instanceof Error ? reason.message : "Operation refresh failed.");
      }
      return null;
    } finally {
      if (generation === generationRef.current) setBusyId(null);
    }
  }, [onRefreshOperation]);

  useEffect(() => {
    const pollable = operations.filter((operation) => {
      const state = operationState(operation);
      return operation.operationId !== "unknown" && (state === "accepted" || state === "started");
    });
    if (pollable.length === 0 || typeof document === "undefined" || document.visibilityState === "hidden") {
      return;
    }

    const delay = POLL_DELAYS_MS[Math.min(pollStepRef.current, POLL_DELAYS_MS.length - 1)];
    const timer = window.setTimeout(() => {
      pollStepRef.current += 1;
      void Promise.all(pollable.map((operation) => refresh(operation.operationId)));
    }, delay);
    return () => window.clearTimeout(timer);
  }, [operationState, operations, refresh, statuses]);

  const cancel = async (operationId: string) => {
    setBusyId(operationId);
    setError(null);
    const generation = generationRef.current;
    try {
      const result = await onCancelOperation(operationId);
      if (generation !== generationRef.current) return;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      pollStepRef.current = 0;
      await refresh(operationId);
    } catch (reason) {
      if (generation === generationRef.current) {
        setError(reason instanceof Error ? reason.message : "Operation cancellation failed.");
      }
    } finally {
      if (generation === generationRef.current) setBusyId(null);
    }
  };

  const title = activity.kind === "handoff"
    ? `Handoff${activity.fromAgentName || activity.toAgentName
      ? `: ${activity.fromAgentName ?? "unknown"} → ${activity.toAgentName ?? "unknown"}`
      : ""}`
    : activity.title;

  return (
    <article
      className={`zorai-thread-activity zorai-thread-activity--${activity.kind}`}
      data-activity-kind={activity.kind}
    >
      <button
        type="button"
        className="zorai-thread-activity__summary"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>
        <strong>{title}</strong>
        <time>{formatActivityTime(createdAt)}</time>
      </button>

      {activity.kind === "operation" ? (
        <div className="zorai-thread-activity__operations">
          {activity.operations.map((operation, index) => {
            const status = statuses[operation.operationId];
            const state = status?.state ?? operation.state;
            const terminal = state === "completed" || state === "failed";
            const actionable = operation.operationId !== "unknown";
            return (
              <div
                key={`${operation.operationId}:${index}`}
                id={`zorai-operation-${operation.operationId}`}
                className="zorai-operation-row"
              >
                <span className={`zorai-status-pill zorai-status-pill--${state}`}>{state}</span>
                <code>{operation.operationId}</code>
                {operation.tool ? <span>{operation.tool}</span> : null}
                {actionable ? (
                  <div className="zorai-card-actions">
                    <button
                      type="button"
                      className="zorai-ghost-button"
                      disabled={busyId === operation.operationId}
                      onClick={() => {
                        pollStepRef.current = 0;
                        void refresh(operation.operationId);
                      }}
                    >
                      Refresh
                    </button>
                    {!terminal ? (
                      <button
                        type="button"
                        className="zorai-ghost-button"
                        disabled={busyId === operation.operationId}
                        onClick={() => void cancel(operation.operationId)}
                      >
                        {busyId === operation.operationId ? "Cancelling…" : "Cancel"}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {error ? <p className="zorai-inline-error" role="alert">{error}</p> : null}
      {expanded ? <pre className="zorai-thread-activity__raw">{activity.rawText}</pre> : null}
    </article>
  );
}

function formatActivityTime(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return "pending";
  const milliseconds = timestamp < 10_000_000_000 ? timestamp * 1_000 : timestamp;
  return new Date(milliseconds).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}
