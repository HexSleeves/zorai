use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MlflowTracingState {
    #[default]
    Disabled,
    Connecting,
    Ready,
    Degraded,
    Error,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct MlflowTracingStatus {
    pub state: MlflowTracingState,
    pub configured_enabled: bool,
    pub effective_enabled: bool,
    pub server_version: Option<String>,
    pub experiment_id: Option<String>,
    pub experiment_name: Option<String>,
    pub queue_depth: usize,
    pub queue_capacity: usize,
    pub traces_exported: u64,
    pub traces_dropped: u64,
    pub last_success_at_ms: Option<u64>,
    pub last_error: Option<String>,
}
