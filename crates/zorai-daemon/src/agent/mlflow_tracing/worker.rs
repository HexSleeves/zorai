use super::*;
use crate::agent::types::AgentEvent;
use crate::agent::AgentEngine;
use anyhow::Result;
use std::sync::{Arc, Weak};
use std::time::Duration;
use tokio::sync::{broadcast, mpsc, oneshot, watch};

const COMMAND_CAPACITY: usize = 32;
const STATUS_ERROR_CHARS: usize = 512;

pub enum MlflowRuntimeCommand {
    Reconfigure(MlflowTracingConfig),
    TestConnection {
        reply: oneshot::Sender<Result<MlflowConnectionInfo, String>>,
    },
    SendDiagnosticTrace {
        reply: oneshot::Sender<Result<MlflowConnectionInfo, String>>,
    },
    RefreshHeaders,
    Shutdown {
        reply: oneshot::Sender<()>,
    },
}

pub struct MlflowTracingRuntime {
    command_tx: mpsc::Sender<MlflowRuntimeCommand>,
    command_rx: std::sync::Mutex<Option<mpsc::Receiver<MlflowRuntimeCommand>>>,
    status_tx: watch::Sender<MlflowTracingStatus>,
    header_store: MlflowHeaderSecretStore,
}

impl MlflowTracingRuntime {
    pub fn new(data_dir: &std::path::Path, config: &MlflowTracingConfig) -> Arc<Self> {
        let (command_tx, command_rx) = mpsc::channel(COMMAND_CAPACITY);
        let (status_tx, _) = watch::channel(MlflowTracingStatus {
            state: MlflowTracingState::Disabled,
            configured_enabled: config.enabled,
            effective_enabled: false,
            queue_capacity: config.queue_capacity,
            ..Default::default()
        });
        Arc::new(Self {
            command_tx,
            command_rx: std::sync::Mutex::new(Some(command_rx)),
            status_tx,
            header_store: MlflowHeaderSecretStore::new(data_dir),
        })
    }

    pub fn start(
        self: &Arc<Self>,
        engine: Weak<AgentEngine>,
        event_rx: broadcast::Receiver<AgentEvent>,
        initial_config: MlflowTracingConfig,
    ) {
        let Some(command_rx) = self
            .command_rx
            .lock()
            .expect("MLflow runtime command mutex poisoned")
            .take()
        else {
            return;
        };
        let runtime = Arc::clone(self);
        tokio::spawn(async move {
            run_worker(runtime, engine, event_rx, command_rx, initial_config).await;
        });
    }

    pub async fn reconfigure(&self, config: MlflowTracingConfig) {
        let _ = self
            .command_tx
            .send(MlflowRuntimeCommand::Reconfigure(config))
            .await;
    }

    pub async fn test_connection(&self) -> Result<MlflowConnectionInfo, String> {
        let (reply, response) = oneshot::channel();
        self.command_tx
            .send(MlflowRuntimeCommand::TestConnection { reply })
            .await
            .map_err(|_| "MLflow tracing runtime is unavailable".to_string())?;
        response
            .await
            .map_err(|_| "MLflow tracing runtime stopped".to_string())?
    }

    pub async fn send_diagnostic_trace(&self) -> Result<MlflowConnectionInfo, String> {
        let (reply, response) = oneshot::channel();
        self.command_tx
            .send(MlflowRuntimeCommand::SendDiagnosticTrace { reply })
            .await
            .map_err(|_| "MLflow tracing runtime is unavailable".to_string())?;
        response
            .await
            .map_err(|_| "MLflow tracing runtime stopped".to_string())?
    }

    pub fn status(&self) -> MlflowTracingStatus {
        self.status_tx.borrow().clone()
    }

    pub fn subscribe_status(&self) -> watch::Receiver<MlflowTracingStatus> {
        self.status_tx.subscribe()
    }

    pub fn header_store(&self) -> &MlflowHeaderSecretStore {
        &self.header_store
    }

    pub async fn refresh_headers(&self) {
        let _ = self
            .command_tx
            .send(MlflowRuntimeCommand::RefreshHeaders)
            .await;
    }

    pub async fn shutdown(&self) {
        let (reply, response) = oneshot::channel();
        if self
            .command_tx
            .send(MlflowRuntimeCommand::Shutdown { reply })
            .await
            .is_ok()
        {
            let _ = response.await;
        }
    }
}

async fn run_worker(
    runtime: Arc<MlflowTracingRuntime>,
    engine: Weak<AgentEngine>,
    mut event_rx: broadcast::Receiver<AgentEvent>,
    mut command_rx: mpsc::Receiver<MlflowRuntimeCommand>,
    initial_config: MlflowTracingConfig,
) {
    let mut config = initial_config;
    let mut effective = MlflowTracingEffectiveConfig::resolve(&config).ok();
    let mut observation = effective
        .as_ref()
        .map(MlflowTracingEffectiveConfig::observation_config)
        .unwrap_or_else(|| config.clone());
    let mut assembler = TurnTraceAssembler::new(observation.clone());
    let mut pending = Vec::new();
    let mut client = build_client(&runtime, effective.as_ref()).ok();
    let mut experiment: Option<MlflowExperiment> = None;
    let mut server_version: Option<String> = None;
    let mut flush = tokio::time::interval(Duration::from_millis(config.flush_interval_ms));
    flush.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    publish_config_status(&runtime, &config, effective.as_ref());

    loop {
        tokio::select! {
            biased;
            Some(command) = command_rx.recv() => {
                match command {
                    MlflowRuntimeCommand::Reconfigure(next) => {
                        let _ = flush_pending(&runtime, client.as_ref(), experiment.as_ref(), &mut pending).await;
                        config = next;
                        effective = MlflowTracingEffectiveConfig::resolve(&config).ok();
                        observation = effective
                            .as_ref()
                            .map(MlflowTracingEffectiveConfig::observation_config)
                            .unwrap_or_else(|| config.clone());
                        assembler = TurnTraceAssembler::new(observation.clone());
                        client = build_client(&runtime, effective.as_ref()).ok();
                        experiment = None;
                        server_version = None;
                        flush = tokio::time::interval(Duration::from_millis(config.flush_interval_ms));
                        publish_config_status(&runtime, &config, effective.as_ref());
                    }
                    MlflowRuntimeCommand::RefreshHeaders => {
                        client = build_client(&runtime, effective.as_ref()).ok();
                    }
                    MlflowRuntimeCommand::TestConnection { reply } => {
                        let result = test_connection(client.as_ref()).await;
                        if let Ok(info) = &result {
                            server_version = Some(info.server_version.clone());
                            experiment = Some(info.experiment.clone());
                            publish_ready(&runtime, &config, info, pending.len(), assembler.active_len());
                        } else if let Err(error) = &result {
                            publish_error(&runtime, &config, error, pending.len(), assembler.active_len());
                        }
                        let _ = reply.send(result);
                    }
                    MlflowRuntimeCommand::SendDiagnosticTrace { reply } => {
                        let result = send_diagnostic(client.as_ref()).await;
                        if let Ok(info) = &result {
                            server_version = Some(info.server_version.clone());
                            experiment = Some(info.experiment.clone());
                            increment_exported(&runtime, 1);
                            publish_ready(&runtime, &config, info, pending.len(), assembler.active_len());
                        } else if let Err(error) = &result {
                            publish_error(&runtime, &config, error, pending.len(), assembler.active_len());
                        }
                        let _ = reply.send(result);
                    }
                    MlflowRuntimeCommand::Shutdown { reply } => {
                        let _ = tokio::time::timeout(Duration::from_secs(2), flush_pending(&runtime, client.as_ref(), experiment.as_ref(), &mut pending)).await;
                        let _ = reply.send(());
                        break;
                    }
                }
            }
            event = event_rx.recv() => {
                let enabled = effective.as_ref().is_some_and(|value| value.enabled);
                if !enabled { continue; }
                match event {
                    Ok(event) => {
                        if let Some(engine) = engine.upgrade() {
                            if let Some(context) = enrich_event(&engine, &event, &observation).await {
                                assembler.observe(now_millis(), event, context);
                                enqueue_completed(&runtime, &config, &mut assembler, &mut pending);
                            }
                        } else { break; }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => {
                        assembler.mark_broadcast_lag(now_millis());
                        enqueue_completed(&runtime, &config, &mut assembler, &mut pending);
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
            _ = flush.tick() => {
                if !effective.as_ref().is_some_and(|value| value.enabled) { continue; }
                assembler.expire_stale(now_millis());
                enqueue_completed(&runtime, &config, &mut assembler, &mut pending);
                if experiment.is_none() {
                    if let Some(client) = client.as_ref() {
                        match client.test_connection().await {
                            Ok(info) => {
                                server_version = Some(info.server_version.clone());
                                experiment = Some(info.experiment.clone());
                                publish_ready(&runtime, &config, &info, pending.len(), assembler.active_len());
                            }
                            Err(error) => {
                                publish_error(&runtime, &config, &error.to_string(), pending.len(), assembler.active_len());
                                continue;
                            }
                        }
                    }
                }
                if let Err(error) = flush_pending_with_retry(&runtime, client.as_ref(), experiment.as_ref(), &mut pending, &config).await {
                    publish_error(&runtime, &config, &error, pending.len(), assembler.active_len());
                } else if let (Some(version), Some(experiment)) = (server_version.as_ref(), experiment.as_ref()) {
                    publish_ready(&runtime, &config, &MlflowConnectionInfo { server_version: version.clone(), experiment: experiment.clone() }, pending.len(), assembler.active_len());
                }
            }
        }
    }
}

fn build_client(
    runtime: &MlflowTracingRuntime,
    effective: Option<&MlflowTracingEffectiveConfig>,
) -> Result<MlflowClient> {
    let effective =
        effective.ok_or_else(|| anyhow::anyhow!("invalid MLflow tracing configuration"))?;
    let headers = runtime.header_store.load_all()?;
    let pairs = headers.into_iter().collect::<Vec<_>>();
    MlflowClient::new(effective, parse_custom_headers(&pairs)?)
}

async fn test_connection(client: Option<&MlflowClient>) -> Result<MlflowConnectionInfo, String> {
    let client = client.ok_or_else(|| "MLflow tracing configuration is invalid".to_string())?;
    client
        .test_connection()
        .await
        .map_err(|error| error.to_string())
}

async fn send_diagnostic(client: Option<&MlflowClient>) -> Result<MlflowConnectionInfo, String> {
    let client = client.ok_or_else(|| "MLflow tracing configuration is invalid".to_string())?;
    let info = client
        .test_connection()
        .await
        .map_err(|error| error.to_string())?;
    let trace = diagnostic_trace();
    let body = encode_otlp_batch(&[trace]).map_err(|error| error.to_string())?;
    client
        .export_otlp(&info.experiment.experiment_id, body)
        .await
        .map_err(|error| error.to_string())?;
    Ok(info)
}

fn enqueue_completed(
    runtime: &MlflowTracingRuntime,
    config: &MlflowTracingConfig,
    assembler: &mut TurnTraceAssembler,
    pending: &mut Vec<CompletedTurnTrace>,
) {
    for trace in assembler.drain_completed() {
        if pending.len() >= config.queue_capacity {
            pending.remove(0);
            let mut status = runtime.status();
            status.traces_dropped = status.traces_dropped.saturating_add(1);
            runtime.status_tx.send_replace(status);
        }
        pending.push(trace);
    }
    let mut status = runtime.status();
    status.queue_depth = pending.len();
    status.active_partial_turns = assembler.active_len();
    runtime.status_tx.send_replace(status);
}

async fn flush_pending_with_retry(
    runtime: &MlflowTracingRuntime,
    client: Option<&MlflowClient>,
    experiment: Option<&MlflowExperiment>,
    pending: &mut Vec<CompletedTurnTrace>,
    config: &MlflowTracingConfig,
) -> Result<(), String> {
    let mut attempt = 0_u32;
    loop {
        match flush_pending(runtime, client, experiment, pending).await {
            Ok(()) => return Ok(()),
            Err(error) => {
                attempt = attempt.saturating_add(1);
                if attempt > config.max_retries {
                    return Err(error);
                }
                let exponent = attempt.saturating_sub(1).min(20);
                let multiplier = 1_u64 << exponent;
                let delay = config
                    .retry_initial_ms
                    .saturating_mul(multiplier)
                    .min(config.retry_max_ms);
                tokio::time::sleep(Duration::from_millis(delay)).await;
            }
        }
    }
}

async fn flush_pending(
    runtime: &MlflowTracingRuntime,
    client: Option<&MlflowClient>,
    experiment: Option<&MlflowExperiment>,
    pending: &mut Vec<CompletedTurnTrace>,
) -> Result<(), String> {
    if pending.is_empty() {
        return Ok(());
    }
    let client = client.ok_or_else(|| "MLflow client is unavailable".to_string())?;
    let experiment = experiment.ok_or_else(|| "MLflow experiment is unresolved".to_string())?;
    let body = encode_otlp_batch(pending).map_err(|error| error.to_string())?;
    client
        .export_otlp(&experiment.experiment_id, body)
        .await
        .map_err(|error| error.to_string())?;
    let count = pending.len() as u64;
    pending.clear();
    increment_exported(runtime, count);
    let mut status = runtime.status();
    status.queue_depth = 0;
    status.last_success_at_ms = Some(now_millis());
    status.last_error = None;
    runtime.status_tx.send_replace(status);
    Ok(())
}

fn publish_config_status(
    runtime: &MlflowTracingRuntime,
    config: &MlflowTracingConfig,
    effective: Option<&MlflowTracingEffectiveConfig>,
) {
    let enabled = effective.is_some_and(|value| value.enabled);
    let mut status = runtime.status();
    status.configured_enabled = config.enabled;
    status.effective_enabled = enabled;
    status.state = if enabled {
        MlflowTracingState::Connecting
    } else {
        MlflowTracingState::Disabled
    };
    status.queue_capacity = config.queue_capacity;
    status.overrides = effective
        .map(|value| value.overrides.clone())
        .unwrap_or_default();
    runtime.status_tx.send_replace(status);
}

fn publish_ready(
    runtime: &MlflowTracingRuntime,
    config: &MlflowTracingConfig,
    info: &MlflowConnectionInfo,
    queue_depth: usize,
    active_partial_turns: usize,
) {
    let mut status = runtime.status();
    status.state = MlflowTracingState::Ready;
    status.configured_enabled = config.enabled;
    status.effective_enabled = true;
    status.server_version = Some(info.server_version.clone());
    status.experiment_id = Some(info.experiment.experiment_id.clone());
    status.experiment_name = Some(info.experiment.name.clone());
    status.queue_depth = queue_depth;
    status.active_partial_turns = active_partial_turns;
    status.last_error = None;
    runtime.status_tx.send_replace(status);
}

fn publish_error(
    runtime: &MlflowTracingRuntime,
    config: &MlflowTracingConfig,
    error: &str,
    queue_depth: usize,
    active_partial_turns: usize,
) {
    let mut status = runtime.status();
    status.state = MlflowTracingState::Degraded;
    status.configured_enabled = config.enabled;
    status.effective_enabled = true;
    status.queue_depth = queue_depth;
    status.active_partial_turns = active_partial_turns;
    status.consecutive_failures = status.consecutive_failures.saturating_add(1);
    status.last_error = Some(
        crate::scrub::scrub_sensitive(error)
            .chars()
            .take(STATUS_ERROR_CHARS)
            .collect(),
    );
    runtime.status_tx.send_replace(status);
}

fn increment_exported(runtime: &MlflowTracingRuntime, count: u64) {
    let mut status = runtime.status();
    status.traces_exported = status.traces_exported.saturating_add(count);
    status.consecutive_failures = 0;
    status.last_success_at_ms = Some(now_millis());
    runtime.status_tx.send_replace(status);
}

pub(super) fn diagnostic_trace() -> CompletedTurnTrace {
    let now = now_millis();
    CompletedTurnTrace {
        trace_id: *uuid::Uuid::new_v4().as_bytes(),
        root_span_id: random_span_id(),
        relationships: MlflowTraceRelationships {
            thread_id: "diagnostic".into(),
            client_surface: Some("diagnostic".into()),
            ..Default::default()
        },
        scope: MlflowTraceScope::VisibleOperator,
        generation: 1,
        started_at_ms: now,
        ended_at_ms: now.saturating_add(1),
        timing_inferred: false,
        outcome: MlflowTraceOutcome::Ok,
        partial_reason: None,
        input: None,
        output: None,
        reasoning: None,
        spans: Vec::new(),
        input_tokens: 0,
        output_tokens: 0,
        cost_usd: None,
        provider: None,
        model: None,
    }
}

fn random_span_id() -> [u8; 8] {
    let id = uuid::Uuid::new_v4();
    let mut output = [0; 8];
    output.copy_from_slice(&id.as_bytes()[..8]);
    output
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
