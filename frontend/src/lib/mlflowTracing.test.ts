import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_SETTINGS, normalizeAgentSettingsFromSource } from "./agentStore/settings";
import { buildDaemonAgentConfig } from "./agentDaemonConfig";
import { normalizeMlflowTracingStatus } from "./mlflowTracing";

describe("MLflow tracing settings", () => {
  it("defaults to guarded and disabled with heartbeat off", () => {
    const config = DEFAULT_AGENT_SETTINGS.mlflow_tracing;
    expect(config.enabled).toBe(false);
    expect(config.capture_mode).toBe("guarded");
    expect(config.tracking_uri).toBe("http://127.0.0.1:5000");
    expect(config.scopes.visible_operator).toBe(true);
    expect(config.scopes.heartbeat_autonomous).toBe(false);
  });

  it("hydrates partial older daemon settings safely", () => {
    const settings = normalizeAgentSettingsFromSource({
      mlflow_tracing: {
        enabled: true,
        capture_mode: "metadata",
        scopes: { gateway: false },
      },
    });
    expect(settings.mlflow_tracing.enabled).toBe(true);
    expect(settings.mlflow_tracing.capture_mode).toBe("metadata");
    expect(settings.mlflow_tracing.scopes.gateway).toBe(false);
    expect(settings.mlflow_tracing.scopes.visible_operator).toBe(true);
  });

  it("projects the nested settings to daemon config", () => {
    const daemon = buildDaemonAgentConfig({
      ...DEFAULT_AGENT_SETTINGS,
      mlflow_tracing: {
        ...DEFAULT_AGENT_SETTINGS.mlflow_tracing,
        enabled: true,
        experiment_name: "zorai-test",
      },
    });
    expect(daemon.mlflow_tracing.enabled).toBe(true);
    expect(daemon.mlflow_tracing.experiment_name).toBe("zorai-test");
  });
});

describe("MLflow tracing status", () => {
  it("normalizes bounded safe runtime status", () => {
    const status = normalizeMlflowTracingStatus({
      state: "ready",
      traces_exported: 4,
      queue_depth: 2,
      overrides: { tracking_uri: "ZORAI_MLFLOW_TRACKING_URI", bad: 7 },
      last_error: "x".repeat(600),
    });
    expect(status.state).toBe("ready");
    expect(status.traces_exported).toBe(4);
    expect(status.overrides).toEqual({ tracking_uri: "ZORAI_MLFLOW_TRACKING_URI" });
    expect(status.last_error?.length).toBe(512);
  });
});
