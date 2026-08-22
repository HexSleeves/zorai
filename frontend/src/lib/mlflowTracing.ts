import { getBridge } from "./bridge";

export type MlflowTracingState = "disabled" | "connecting" | "ready" | "degraded" | "error";

export interface MlflowTracingStatus {
  state: MlflowTracingState;
  configured_enabled: boolean;
  effective_enabled: boolean;
  server_version: string | null;
  experiment_id: string | null;
  experiment_name: string | null;
  queue_depth: number;
  queue_capacity: number;
  traces_exported: number;
  traces_dropped: number;
  consecutive_failures: number;
  active_partial_turns: number;
  overrides: Record<string, string>;
  last_success_at_ms: number | null;
  last_error: string | null;
}

export interface MlflowTracingTestResult {
  ok: boolean;
  connection?: {
    server_version: string;
    experiment: { experiment_id: string; name: string };
  };
  error?: string;
}

export const EMPTY_MLFLOW_STATUS: MlflowTracingStatus = {
  state: "disabled",
  configured_enabled: false,
  effective_enabled: false,
  server_version: null,
  experiment_id: null,
  experiment_name: null,
  queue_depth: 0,
  queue_capacity: 0,
  traces_exported: 0,
  traces_dropped: 0,
  consecutive_failures: 0,
  active_partial_turns: 0,
  overrides: {},
  last_success_at_ms: null,
  last_error: null,
};

export function normalizeMlflowTracingStatus(value: unknown): MlflowTracingStatus {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const state = ["disabled", "connecting", "ready", "degraded", "error"].includes(String(record.state))
    ? record.state as MlflowTracingState
    : "error";
  const numeric = (key: string) => Number.isFinite(Number(record[key])) ? Math.max(0, Number(record[key])) : 0;
  return {
    ...EMPTY_MLFLOW_STATUS,
    state,
    configured_enabled: record.configured_enabled === true,
    effective_enabled: record.effective_enabled === true,
    server_version: typeof record.server_version === "string" ? record.server_version : null,
    experiment_id: typeof record.experiment_id === "string" ? record.experiment_id : null,
    experiment_name: typeof record.experiment_name === "string" ? record.experiment_name : null,
    queue_depth: numeric("queue_depth"),
    queue_capacity: numeric("queue_capacity"),
    traces_exported: numeric("traces_exported"),
    traces_dropped: numeric("traces_dropped"),
    consecutive_failures: numeric("consecutive_failures"),
    active_partial_turns: numeric("active_partial_turns"),
    overrides: record.overrides && typeof record.overrides === "object"
      ? Object.fromEntries(Object.entries(record.overrides as Record<string, unknown>).filter(([, item]) => typeof item === "string")) as Record<string, string>
      : {},
    last_success_at_ms: Number.isFinite(Number(record.last_success_at_ms)) ? Number(record.last_success_at_ms) : null,
    last_error: typeof record.last_error === "string" ? record.last_error.slice(0, 512) : null,
  };
}

export async function getMlflowTracingStatus(): Promise<MlflowTracingStatus> {
  const raw = await getBridge()?.agentGetMlflowTracingStatus?.();
  return normalizeMlflowTracingStatus(raw);
}

export async function testMlflowTracingConnection(): Promise<MlflowTracingTestResult> {
  return await getBridge()?.agentTestMlflowTracingConnection?.() as MlflowTracingTestResult
    ?? { ok: false, error: "MLflow tracing bridge is unavailable" };
}

export async function sendMlflowTracingTestTrace(): Promise<MlflowTracingTestResult> {
  return await getBridge()?.agentSendMlflowTracingTestTrace?.() as MlflowTracingTestResult
    ?? { ok: false, error: "MLflow tracing bridge is unavailable" };
}
