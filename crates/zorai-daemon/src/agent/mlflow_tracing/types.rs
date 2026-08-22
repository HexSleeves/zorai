use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MlflowContentKind {
    User,
    Assistant,
    Reasoning,
    ToolArguments,
    ToolResult,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CapturedValue {
    pub value: String,
    pub redacted: bool,
    pub truncated: bool,
    pub original_chars: usize,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MlflowTraceScope {
    VisibleOperator,
    Gateway,
    GoalTask,
    Subagent,
    Concierge,
    HeartbeatAutonomous,
    Unknown,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct MlflowTraceRelationships {
    pub thread_id: String,
    pub user_message_id: Option<String>,
    pub assistant_message_id: Option<String>,
    pub agent_id: Option<String>,
    pub agent_name: Option<String>,
    pub client_surface: Option<String>,
    pub task_id: Option<String>,
    pub parent_task_id: Option<String>,
    pub goal_run_id: Option<String>,
    pub goal_step_index: Option<usize>,
    pub parent_thread_id: Option<String>,
    pub root_thread_id: Option<String>,
    pub session_id: Option<String>,
    pub workspace_id: Option<String>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub api_transport: Option<String>,
}

impl MlflowTraceRelationships {
    pub fn classify_scope(&self, autonomous: bool) -> MlflowTraceScope {
        if self.parent_task_id.is_some() {
            MlflowTraceScope::Subagent
        } else if self
            .agent_id
            .as_deref()
            .is_some_and(|id| id.eq_ignore_ascii_case("concierge"))
            || self
                .agent_name
                .as_deref()
                .is_some_and(|name| name.eq_ignore_ascii_case("rarog"))
        {
            MlflowTraceScope::Concierge
        } else if self.goal_run_id.is_some() || self.task_id.is_some() {
            MlflowTraceScope::GoalTask
        } else if self
            .client_surface
            .as_deref()
            .is_some_and(|surface| surface.eq_ignore_ascii_case("gateway"))
        {
            MlflowTraceScope::Gateway
        } else if autonomous {
            MlflowTraceScope::HeartbeatAutonomous
        } else if self.client_surface.is_some() {
            MlflowTraceScope::VisibleOperator
        } else {
            MlflowTraceScope::Unknown
        }
    }
}

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
    pub consecutive_failures: u64,
    pub active_partial_turns: usize,
    #[serde(default)]
    pub overrides: std::collections::BTreeMap<String, String>,
    pub last_success_at_ms: Option<u64>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MlflowSpanKind {
    Llm,
    Tool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MlflowTraceOutcome {
    Ok,
    Error,
    Unset,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CompletedTraceSpan {
    pub span_id: [u8; 8],
    pub parent_span_id: [u8; 8],
    pub name: String,
    pub kind: MlflowSpanKind,
    pub started_at_ms: u64,
    pub ended_at_ms: u64,
    pub timing_inferred: bool,
    pub outcome: MlflowTraceOutcome,
    pub input: Option<CapturedValue>,
    pub output: Option<CapturedValue>,
    pub call_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CompletedTurnTrace {
    pub trace_id: [u8; 16],
    pub root_span_id: [u8; 8],
    pub relationships: MlflowTraceRelationships,
    pub scope: MlflowTraceScope,
    pub generation: u64,
    pub started_at_ms: u64,
    pub ended_at_ms: u64,
    pub timing_inferred: bool,
    pub outcome: MlflowTraceOutcome,
    pub partial_reason: Option<String>,
    pub input: Option<CapturedValue>,
    pub output: Option<CapturedValue>,
    pub reasoning: Option<CapturedValue>,
    pub spans: Vec<CompletedTraceSpan>,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_input_tokens: u64,
    pub cache_creation_input_tokens: u64,
    pub cost_usd: Option<f64>,
    pub provider: Option<String>,
    pub model: Option<String>,
}
