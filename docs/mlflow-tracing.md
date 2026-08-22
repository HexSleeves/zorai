# MLflow conversation tracing

Zorai can export agent conversations to an MLflow Tracking Server as OpenTelemetry traces. The exporter lives in `zorai-daemon`, so Desktop, TUI, CLI, gateways, tasks, goals, and subagents share one observability path.

## Requirements

- MLflow **3.6.0 or newer**; tested with **3.15.1**.
- A SQL-backed MLflow server. The default local server is sufficient:

```bash
uvx mlflow server --host 127.0.0.1 --port 5000
```

The default Zorai tracking URI is `http://127.0.0.1:5000`, and the default experiment is `zorai-conversations`. Zorai resolves the experiment by name and creates it if absent. An explicit numeric experiment ID can be configured instead.

## Enable and test

Open **Settings → MLflow** in Desktop or the **MLflow** settings tab in TUI:

1. Set the tracking URI and experiment.
2. Select a capture mode.
3. Select execution scopes.
4. Choose **Test connection**. This checks `/version` and resolves the experiment but sends no trace.
5. Choose **Send test trace** to send a content-free diagnostic trace.
6. Enable tracing and save settings.

Tracing is disabled by default. An unreachable or rejected MLflow export never blocks or fails a Zorai conversation.

## Capture modes

- **metadata**: IDs, agent/provider/model, timing, tokens, cost, tool names/status, relationships, and sanitized errors. No dialogue, reasoning, tool arguments, or tool results.
- **guarded** (default): scrubbed and capped user/assistant dialogue; reasoning omitted; scrubbed and capped tool arguments/results; binary and data-URL bodies omitted.
- **full**: includes capped reasoning and fuller tool content, but credentials, authorization/cookie headers, private keys, known tokens, binary bodies, and data URLs are always removed.

Every trace indicates truncation/redaction and marks inferred turn/LLM timing with `zorai.timing.inferred=true`.

## Scope controls

Independent toggles control:

- visible operator turns;
- gateway turns;
- goal/task turns;
- subagent turns;
- concierge turns;
- heartbeat/autonomous maintenance (off by default).

One trace represents one Zorai turn. `zorai.thread.id`, task/goal IDs, parent IDs, agent/persona, provider/model, and client surface correlate traces across a conversation and multi-agent workflow.

## Encrypted custom headers

Desktop can store custom HTTP headers for authenticated MLflow servers. Values are encrypted with Zorai's AES-256-GCM credential key and stored at:

```text
~/.zorai/agent/mlflow-tracing-headers.enc
```

Only header names are returned to clients. Values are never included in status, logs, or list responses.

## Environment overrides

Deployment-sensitive settings may be overridden with:

```text
ZORAI_MLFLOW_TRACING_ENABLED
ZORAI_MLFLOW_TRACKING_URI
ZORAI_MLFLOW_EXPERIMENT_NAME
ZORAI_MLFLOW_EXPERIMENT_ID
ZORAI_MLFLOW_CAPTURE_MODE
```

Desktop/TUI mark overridden values as effective environment settings. Prefer HTTPS for non-loopback servers.

## Delivery and limits

- Event capture and network export are asynchronous.
- Per-turn state, content, span counts, queue size, batch size, and request time are bounded.
- Transient exports use bounded exponential retry.
- Queue overflow drops the oldest completed trace and increments a visible counter.
- Broadcast lag and stale/incomplete turns are exported as visibly partial traces.
- Shutdown uses a short best-effort flush.
- v1 has no durable disk spool and no historical backfill.

Runtime status reports state, server version, experiment, queue, exported/dropped counts, active partial turns, consecutive failures, last success, and a scrubbed error.

## MLflow mapping

Zorai posts standard OTLP protobuf to:

```text
POST /v1/traces
Content-Type: application/x-protobuf
x-mlflow-experiment-id: <id>
```

The root `zorai.turn` span uses `gen_ai.operation.name=invoke_agent`. Child LLM spans use `response`, and exact tool spans use `execute_tool`. MLflow maps GenAI input/output, tool arguments/results, token usage, provider, and model into its trace UI.

## Troubleshooting

- **Server incompatible**: upgrade MLflow to 3.6+.
- **Degraded**: inspect the last scrubbed error and test the connection.
- **Queue growing**: MLflow is slow/unavailable; increase capacity only after fixing the endpoint.
- **Dropped traces**: completed queue reached its hard bound; conversations were unaffected.
- **No heartbeat traces**: heartbeat/autonomous scope is off by default.
- **No content**: metadata mode intentionally omits it.

MLflow is optional observability. Zorai's local database, WORM telemetry, causal traces, audit, and provenance remain the source of truth.
