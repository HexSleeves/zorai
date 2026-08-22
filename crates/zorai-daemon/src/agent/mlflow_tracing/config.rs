use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

const ENV_ENABLED: &str = "ZORAI_MLFLOW_TRACING_ENABLED";
const ENV_URI: &str = "ZORAI_MLFLOW_TRACKING_URI";
const ENV_EXPERIMENT: &str = "ZORAI_MLFLOW_EXPERIMENT_NAME";
const ENV_EXPERIMENT_ID: &str = "ZORAI_MLFLOW_EXPERIMENT_ID";
const ENV_CAPTURE_MODE: &str = "ZORAI_MLFLOW_CAPTURE_MODE";

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MlflowCaptureMode {
    Metadata,
    #[default]
    Guarded,
    Full,
}

impl MlflowCaptureMode {
    fn parse(value: &str) -> Result<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "metadata" => Ok(Self::Metadata),
            "guarded" => Ok(Self::Guarded),
            "full" => Ok(Self::Full),
            other => bail!("invalid MLflow capture mode '{other}'"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MlflowTracingScopes {
    #[serde(default = "bool_true")]
    pub visible_operator: bool,
    #[serde(default = "bool_true")]
    pub gateway: bool,
    #[serde(default = "bool_true")]
    pub goal_task: bool,
    #[serde(default = "bool_true")]
    pub subagent: bool,
    #[serde(default = "bool_true")]
    pub concierge: bool,
    #[serde(default)]
    pub heartbeat_autonomous: bool,
}

impl Default for MlflowTracingScopes {
    fn default() -> Self {
        Self {
            visible_operator: true,
            gateway: true,
            goal_task: true,
            subagent: true,
            concierge: true,
            heartbeat_autonomous: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MlflowTracingConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_tracking_uri")]
    pub tracking_uri: String,
    #[serde(default = "default_experiment_name")]
    pub experiment_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub experiment_id: Option<String>,
    #[serde(default)]
    pub capture_mode: MlflowCaptureMode,
    #[serde(default)]
    pub scopes: MlflowTracingScopes,
    #[serde(default = "default_32_kib")]
    pub max_user_chars: usize,
    #[serde(default = "default_32_kib")]
    pub max_assistant_chars: usize,
    #[serde(default = "default_8_kib")]
    pub max_reasoning_chars: usize,
    #[serde(default = "default_16_kib")]
    pub max_tool_argument_chars: usize,
    #[serde(default = "default_64_kib")]
    pub max_tool_result_chars: usize,
    #[serde(default = "default_max_spans")]
    pub max_spans_per_trace: usize,
    #[serde(default = "default_max_events")]
    pub max_events_per_span: usize,
    #[serde(default = "default_trace_bytes")]
    pub max_trace_bytes: usize,
    #[serde(default = "default_batch_size")]
    pub batch_size: usize,
    #[serde(default = "default_flush_ms")]
    pub flush_interval_ms: u64,
    #[serde(default = "default_queue_capacity")]
    pub queue_capacity: usize,
    #[serde(default = "default_request_timeout_ms")]
    pub request_timeout_ms: u64,
    #[serde(default = "default_retries")]
    pub max_retries: u32,
    #[serde(default = "default_retry_initial_ms")]
    pub retry_initial_ms: u64,
    #[serde(default = "default_retry_max_ms")]
    pub retry_max_ms: u64,
    #[serde(default = "default_stale_turn_ms")]
    pub stale_turn_timeout_ms: u64,
}

impl Default for MlflowTracingConfig {
    fn default() -> Self {
        serde_json::from_value(serde_json::json!({}))
            .expect("default tracing config must deserialize")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct MlflowTracingEffectiveConfig {
    pub configured: MlflowTracingConfig,
    pub enabled: bool,
    pub tracking_uri: String,
    pub experiment_name: String,
    pub experiment_id: Option<String>,
    pub capture_mode: MlflowCaptureMode,
    pub overrides: BTreeMap<String, String>,
}

impl MlflowTracingEffectiveConfig {
    pub fn resolve(config: &MlflowTracingConfig) -> Result<Self> {
        let mut overrides = BTreeMap::new();
        let enabled = env_bool(ENV_ENABLED)?.unwrap_or(config.enabled);
        if std::env::var_os(ENV_ENABLED).is_some() {
            overrides.insert("enabled".into(), ENV_ENABLED.into());
        }
        let tracking_uri = env_string(ENV_URI).unwrap_or_else(|| config.tracking_uri.clone());
        if std::env::var_os(ENV_URI).is_some() {
            overrides.insert("tracking_uri".into(), ENV_URI.into());
        }
        let experiment_name =
            env_string(ENV_EXPERIMENT).unwrap_or_else(|| config.experiment_name.clone());
        if std::env::var_os(ENV_EXPERIMENT).is_some() {
            overrides.insert("experiment_name".into(), ENV_EXPERIMENT.into());
        }
        let experiment_id = env_string(ENV_EXPERIMENT_ID).or_else(|| config.experiment_id.clone());
        if std::env::var_os(ENV_EXPERIMENT_ID).is_some() {
            overrides.insert("experiment_id".into(), ENV_EXPERIMENT_ID.into());
        }
        let capture_mode = if let Some(value) = env_string(ENV_CAPTURE_MODE) {
            overrides.insert("capture_mode".into(), ENV_CAPTURE_MODE.into());
            MlflowCaptureMode::parse(&value)?
        } else {
            config.capture_mode
        };
        let tracking_uri = normalize_tracking_uri(&tracking_uri)?;
        if experiment_id.is_none() && experiment_name.trim().is_empty() {
            bail!("MLflow experiment name must not be empty when no experiment ID is set");
        }
        Ok(Self {
            configured: clamp_config(config.clone()),
            enabled,
            tracking_uri,
            experiment_name,
            experiment_id,
            capture_mode,
            overrides,
        })
    }

    pub fn observation_config(&self) -> MlflowTracingConfig {
        let mut config = self.configured.clone();
        config.enabled = self.enabled;
        config.tracking_uri = self.tracking_uri.clone();
        config.experiment_name = self.experiment_name.clone();
        config.experiment_id = self.experiment_id.clone();
        config.capture_mode = self.capture_mode;
        config
    }
}

fn normalize_tracking_uri(value: &str) -> Result<String> {
    let normalized = value.trim().trim_end_matches('/');
    let parsed = url::Url::parse(normalized).context("invalid MLflow tracking URI")?;
    if !matches!(parsed.scheme(), "http" | "https") {
        bail!("MLflow tracking URI must use http or https");
    }
    if parsed.host_str().is_none() {
        bail!("MLflow tracking URI must include a host");
    }
    Ok(normalized.to_string())
}

fn clamp_config(mut value: MlflowTracingConfig) -> MlflowTracingConfig {
    value.max_user_chars = value.max_user_chars.clamp(256, 1_000_000);
    value.max_assistant_chars = value.max_assistant_chars.clamp(256, 1_000_000);
    value.max_reasoning_chars = value.max_reasoning_chars.clamp(0, 1_000_000);
    value.max_tool_argument_chars = value.max_tool_argument_chars.clamp(256, 1_000_000);
    value.max_tool_result_chars = value.max_tool_result_chars.clamp(256, 4_000_000);
    value.max_spans_per_trace = value.max_spans_per_trace.clamp(1, 1024);
    value.max_events_per_span = value.max_events_per_span.clamp(1, 1024);
    value.max_trace_bytes = value.max_trace_bytes.clamp(16 * 1024, 16 * 1024 * 1024);
    value.batch_size = value.batch_size.clamp(1, 256);
    value.flush_interval_ms = value.flush_interval_ms.clamp(100, 60_000);
    value.queue_capacity = value.queue_capacity.clamp(1, 10_000);
    value.request_timeout_ms = value.request_timeout_ms.clamp(500, 120_000);
    value.max_retries = value.max_retries.min(10);
    value.retry_initial_ms = value.retry_initial_ms.clamp(50, 60_000);
    value.retry_max_ms = value.retry_max_ms.clamp(value.retry_initial_ms, 300_000);
    value.stale_turn_timeout_ms = value
        .stale_turn_timeout_ms
        .clamp(10_000, 24 * 60 * 60 * 1000);
    value
}

fn env_string(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}
fn env_bool(name: &str) -> Result<Option<bool>> {
    match env_string(name).as_deref() {
        None => Ok(None),
        Some("1" | "true" | "yes" | "on") => Ok(Some(true)),
        Some("0" | "false" | "no" | "off") => Ok(Some(false)),
        Some(value) => bail!("invalid boolean value '{value}' for {name}"),
    }
}
fn bool_true() -> bool {
    true
}
fn default_tracking_uri() -> String {
    "http://127.0.0.1:5000".into()
}
fn default_experiment_name() -> String {
    "zorai-conversations".into()
}
fn default_32_kib() -> usize {
    32 * 1024
}
fn default_8_kib() -> usize {
    8 * 1024
}
fn default_16_kib() -> usize {
    16 * 1024
}
fn default_64_kib() -> usize {
    64 * 1024
}
fn default_max_spans() -> usize {
    128
}
fn default_max_events() -> usize {
    64
}
fn default_trace_bytes() -> usize {
    1024 * 1024
}
fn default_batch_size() -> usize {
    16
}
fn default_flush_ms() -> u64 {
    1000
}
fn default_queue_capacity() -> usize {
    256
}
fn default_request_timeout_ms() -> u64 {
    5000
}
fn default_retries() -> u32 {
    3
}
fn default_retry_initial_ms() -> u64 {
    250
}
fn default_retry_max_ms() -> u64 {
    5000
}
fn default_stale_turn_ms() -> u64 {
    15 * 60 * 1000
}
