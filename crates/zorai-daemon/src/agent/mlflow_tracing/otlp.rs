use super::*;
use anyhow::Result;
use prost::Message;

#[derive(Clone, PartialEq, Message)]
pub struct ExportTraceServiceRequest {
    #[prost(message, repeated, tag = "1")]
    pub resource_spans: Vec<ResourceSpans>,
}

#[derive(Clone, PartialEq, Message)]
pub struct ResourceSpans {
    #[prost(message, optional, tag = "1")]
    pub resource: Option<Resource>,
    #[prost(message, repeated, tag = "2")]
    pub scope_spans: Vec<ScopeSpans>,
    #[prost(string, tag = "3")]
    pub schema_url: String,
}

#[derive(Clone, PartialEq, Message)]
pub struct Resource {
    #[prost(message, repeated, tag = "1")]
    pub attributes: Vec<KeyValue>,
    #[prost(uint32, tag = "2")]
    pub dropped_attributes_count: u32,
}

#[derive(Clone, PartialEq, Message)]
pub struct ScopeSpans {
    #[prost(message, optional, tag = "1")]
    pub scope: Option<InstrumentationScope>,
    #[prost(message, repeated, tag = "2")]
    pub spans: Vec<OtlpSpan>,
    #[prost(string, tag = "3")]
    pub schema_url: String,
}

#[derive(Clone, PartialEq, Message)]
pub struct InstrumentationScope {
    #[prost(string, tag = "1")]
    pub name: String,
    #[prost(string, tag = "2")]
    pub version: String,
    #[prost(message, repeated, tag = "3")]
    pub attributes: Vec<KeyValue>,
    #[prost(uint32, tag = "4")]
    pub dropped_attributes_count: u32,
}

#[derive(Clone, PartialEq, Message)]
pub struct OtlpSpan {
    #[prost(bytes = "vec", tag = "1")]
    pub trace_id: Vec<u8>,
    #[prost(bytes = "vec", tag = "2")]
    pub span_id: Vec<u8>,
    #[prost(string, tag = "3")]
    pub trace_state: String,
    #[prost(bytes = "vec", tag = "4")]
    pub parent_span_id: Vec<u8>,
    #[prost(string, tag = "5")]
    pub name: String,
    #[prost(enumeration = "SpanKind", tag = "6")]
    pub kind: i32,
    #[prost(fixed64, tag = "7")]
    pub start_time_unix_nano: u64,
    #[prost(fixed64, tag = "8")]
    pub end_time_unix_nano: u64,
    #[prost(message, repeated, tag = "9")]
    pub attributes: Vec<KeyValue>,
    #[prost(uint32, tag = "10")]
    pub dropped_attributes_count: u32,
    #[prost(message, repeated, tag = "11")]
    pub events: Vec<SpanEvent>,
    #[prost(uint32, tag = "12")]
    pub dropped_events_count: u32,
    #[prost(message, repeated, tag = "13")]
    pub links: Vec<SpanLink>,
    #[prost(uint32, tag = "14")]
    pub dropped_links_count: u32,
    #[prost(message, optional, tag = "15")]
    pub status: Option<Status>,
    #[prost(fixed32, tag = "16")]
    pub flags: u32,
}

#[derive(Clone, PartialEq, Message)]
pub struct SpanEvent {
    #[prost(fixed64, tag = "1")]
    pub time_unix_nano: u64,
    #[prost(string, tag = "2")]
    pub name: String,
    #[prost(message, repeated, tag = "3")]
    pub attributes: Vec<KeyValue>,
    #[prost(uint32, tag = "4")]
    pub dropped_attributes_count: u32,
}

#[derive(Clone, PartialEq, Message)]
pub struct SpanLink {
    #[prost(bytes = "vec", tag = "1")]
    pub trace_id: Vec<u8>,
    #[prost(bytes = "vec", tag = "2")]
    pub span_id: Vec<u8>,
    #[prost(string, tag = "3")]
    pub trace_state: String,
    #[prost(message, repeated, tag = "4")]
    pub attributes: Vec<KeyValue>,
    #[prost(uint32, tag = "5")]
    pub dropped_attributes_count: u32,
    #[prost(fixed32, tag = "6")]
    pub flags: u32,
}

#[derive(Clone, PartialEq, Message)]
pub struct Status {
    #[prost(string, tag = "2")]
    pub message: String,
    #[prost(enumeration = "StatusCode", tag = "3")]
    pub code: i32,
}

#[derive(Clone, PartialEq, Message)]
pub struct KeyValue {
    #[prost(string, tag = "1")]
    pub key: String,
    #[prost(message, optional, tag = "2")]
    pub value: Option<AnyValue>,
}

#[derive(Clone, PartialEq, Message)]
pub struct AnyValue {
    #[prost(oneof = "any_value::Value", tags = "1, 2, 3, 4, 5, 6, 7")]
    pub value: Option<any_value::Value>,
}

pub mod any_value {
    use super::{ArrayValue, KeyValueList};
    use prost::Oneof;

    #[derive(Clone, PartialEq, Oneof)]
    pub enum Value {
        #[prost(string, tag = "1")]
        StringValue(String),
        #[prost(bool, tag = "2")]
        BoolValue(bool),
        #[prost(int64, tag = "3")]
        IntValue(i64),
        #[prost(double, tag = "4")]
        DoubleValue(f64),
        #[prost(message, tag = "5")]
        ArrayValue(ArrayValue),
        #[prost(message, tag = "6")]
        KvlistValue(KeyValueList),
        #[prost(bytes, tag = "7")]
        BytesValue(Vec<u8>),
    }
}

#[derive(Clone, PartialEq, Message)]
pub struct ArrayValue {
    #[prost(message, repeated, tag = "1")]
    pub values: Vec<AnyValue>,
}

#[derive(Clone, PartialEq, Message)]
pub struct KeyValueList {
    #[prost(message, repeated, tag = "1")]
    pub values: Vec<KeyValue>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, prost::Enumeration)]
#[repr(i32)]
pub enum SpanKind {
    Unspecified = 0,
    Internal = 1,
    Server = 2,
    Client = 3,
    Producer = 4,
    Consumer = 5,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, prost::Enumeration)]
#[repr(i32)]
pub enum StatusCode {
    Unset = 0,
    Ok = 1,
    Error = 2,
}

pub fn encode_otlp_batch(traces: &[CompletedTurnTrace]) -> Result<Vec<u8>> {
    let mut spans = Vec::new();
    for trace in traces {
        spans.push(root_span(trace));
        let last_llm = trace
            .spans
            .iter()
            .rposition(|span| span.kind == MlflowSpanKind::Llm);
        spans.extend(
            trace
                .spans
                .iter()
                .enumerate()
                .map(|(index, span)| child_span(trace, span, last_llm == Some(index))),
        );
    }
    let request = ExportTraceServiceRequest {
        resource_spans: vec![ResourceSpans {
            resource: Some(Resource {
                attributes: vec![
                    kv_string("service.name", "zorai-daemon"),
                    kv_string("service.version", env!("CARGO_PKG_VERSION")),
                    kv_string("telemetry.sdk.language", "rust"),
                ],
                dropped_attributes_count: 0,
            }),
            scope_spans: vec![ScopeSpans {
                scope: Some(InstrumentationScope {
                    name: "zorai.mlflow_tracing".into(),
                    version: env!("CARGO_PKG_VERSION").into(),
                    attributes: Vec::new(),
                    dropped_attributes_count: 0,
                }),
                spans,
                schema_url: String::new(),
            }],
            schema_url: String::new(),
        }],
    };
    let mut output = Vec::with_capacity(request.encoded_len());
    request.encode(&mut output)?;
    Ok(output)
}

fn root_span(trace: &CompletedTurnTrace) -> OtlpSpan {
    let mut attributes = relationship_attributes(trace);
    attributes.extend([
        kv_string("gen_ai.operation.name", "invoke_agent"),
        kv_bool("zorai.timing.inferred", trace.timing_inferred),
        kv_string("zorai.scope", scope_name(trace.scope)),
        kv_string("zorai.capture.redacted", capture_flags(trace).0),
        kv_string("zorai.capture.truncated", capture_flags(trace).1),
    ]);
    attributes.extend(usage_attributes(
        trace.input_tokens,
        trace.output_tokens,
        trace.cache_read_input_tokens,
        trace.cache_creation_input_tokens,
    ));
    if let Some(provider) = trace.provider.as_deref() {
        attributes.push(kv_string("gen_ai.provider.name", provider));
    }
    if let Some(model) = trace.model.as_deref() {
        attributes.push(kv_string("gen_ai.response.model", model));
    }
    if let Some(cost) = trace.cost_usd {
        attributes.push(kv_double("zorai.cost.usd", cost));
    }
    if let Some(reason) = trace.partial_reason.as_deref() {
        attributes.push(kv_bool("zorai.trace.partial", true));
        attributes.push(kv_string("zorai.trace.partial_reason", reason));
    }
    if let Some(input) = trace.input.as_ref() {
        attributes.push(kv_string(
            "gen_ai.input.messages",
            &message_json("user", &input.value),
        ));
    }
    if let Some(output) = trace.output.as_ref() {
        attributes.push(kv_string(
            "gen_ai.output.messages",
            &message_json("assistant", &output.value),
        ));
    }
    if let Some(reasoning) = trace.reasoning.as_ref() {
        attributes.push(kv_string("gen_ai.reasoning", &reasoning.value));
    }
    OtlpSpan {
        trace_id: trace.trace_id.to_vec(),
        span_id: trace.root_span_id.to_vec(),
        trace_state: String::new(),
        parent_span_id: Vec::new(),
        name: "zorai.turn".into(),
        kind: SpanKind::Internal as i32,
        start_time_unix_nano: millis_to_nanos(trace.started_at_ms),
        end_time_unix_nano: millis_to_nanos(trace.ended_at_ms),
        attributes,
        dropped_attributes_count: 0,
        events: Vec::new(),
        dropped_events_count: 0,
        links: Vec::new(),
        dropped_links_count: 0,
        status: Some(status(trace.outcome, trace.partial_reason.as_deref())),
        flags: 1,
    }
}

fn child_span(
    trace: &CompletedTurnTrace,
    span: &CompletedTraceSpan,
    include_usage: bool,
) -> OtlpSpan {
    let operation = match span.kind {
        MlflowSpanKind::Llm => "response",
        MlflowSpanKind::Tool => "execute_tool",
    };
    let mut attributes = vec![
        kv_string("gen_ai.operation.name", operation),
        kv_bool("zorai.timing.inferred", span.timing_inferred),
    ];
    if include_usage {
        attributes.extend(usage_attributes(
            trace.input_tokens,
            trace.output_tokens,
            trace.cache_read_input_tokens,
            trace.cache_creation_input_tokens,
        ));
        if let Some(provider) = trace.provider.as_deref() {
            attributes.push(kv_string("gen_ai.provider.name", provider));
        }
        if let Some(model) = trace.model.as_deref() {
            attributes.push(kv_string("gen_ai.response.model", model));
        }
    }
    if let Some(call_id) = span.call_id.as_deref() {
        attributes.push(kv_string("gen_ai.tool.call.id", call_id));
    }
    if let Some(input) = span.input.as_ref() {
        let key = if span.kind == MlflowSpanKind::Tool {
            "gen_ai.tool.call.arguments"
        } else {
            "gen_ai.input.messages"
        };
        attributes.push(kv_string(key, &input.value));
    }
    if let Some(output) = span.output.as_ref() {
        let key = if span.kind == MlflowSpanKind::Tool {
            "gen_ai.tool.call.result"
        } else {
            "gen_ai.output.messages"
        };
        attributes.push(kv_string(key, &output.value));
    }
    OtlpSpan {
        trace_id: trace.trace_id.to_vec(),
        span_id: span.span_id.to_vec(),
        trace_state: String::new(),
        parent_span_id: span.parent_span_id.to_vec(),
        name: span.name.clone(),
        kind: SpanKind::Internal as i32,
        start_time_unix_nano: millis_to_nanos(span.started_at_ms),
        end_time_unix_nano: millis_to_nanos(span.ended_at_ms),
        attributes,
        dropped_attributes_count: 0,
        events: Vec::new(),
        dropped_events_count: 0,
        links: Vec::new(),
        dropped_links_count: 0,
        status: Some(status(span.outcome, None)),
        flags: 1,
    }
}

fn relationship_attributes(trace: &CompletedTurnTrace) -> Vec<KeyValue> {
    let relationships = &trace.relationships;
    let mut values = vec![
        kv_string("zorai.thread.id", &relationships.thread_id),
        kv_i64("zorai.turn.generation", trace.generation as i64),
    ];
    for (key, value) in [
        (
            "zorai.message.user_id",
            relationships.user_message_id.as_deref(),
        ),
        (
            "zorai.message.assistant_id",
            relationships.assistant_message_id.as_deref(),
        ),
        ("zorai.agent.id", relationships.agent_id.as_deref()),
        ("zorai.agent.name", relationships.agent_name.as_deref()),
        (
            "zorai.client.surface",
            relationships.client_surface.as_deref(),
        ),
        ("zorai.task.id", relationships.task_id.as_deref()),
        (
            "zorai.task.parent_id",
            relationships.parent_task_id.as_deref(),
        ),
        ("zorai.goal_run.id", relationships.goal_run_id.as_deref()),
        (
            "zorai.thread.parent_id",
            relationships.parent_thread_id.as_deref(),
        ),
        (
            "zorai.thread.root_id",
            relationships.root_thread_id.as_deref(),
        ),
        ("zorai.session.id", relationships.session_id.as_deref()),
        ("zorai.workspace.id", relationships.workspace_id.as_deref()),
    ] {
        if let Some(value) = value {
            values.push(kv_string(key, value));
        }
    }
    values
}

fn capture_flags(trace: &CompletedTurnTrace) -> (&'static str, &'static str) {
    let values = [
        trace.input.as_ref(),
        trace.output.as_ref(),
        trace.reasoning.as_ref(),
    ];
    let redacted = values.iter().flatten().any(|value| value.redacted);
    let truncated = values.iter().flatten().any(|value| value.truncated);
    (
        if redacted { "true" } else { "false" },
        if truncated { "true" } else { "false" },
    )
}

fn message_json(role: &str, content: &str) -> String {
    serde_json::json!([{ "role": role, "parts": [{ "type": "text", "content": content }] }])
        .to_string()
}

fn status(outcome: MlflowTraceOutcome, message: Option<&str>) -> Status {
    Status {
        message: message.unwrap_or_default().to_string(),
        code: match outcome {
            MlflowTraceOutcome::Ok => StatusCode::Ok,
            MlflowTraceOutcome::Error => StatusCode::Error,
            MlflowTraceOutcome::Unset => StatusCode::Unset,
        } as i32,
    }
}

fn scope_name(scope: MlflowTraceScope) -> &'static str {
    match scope {
        MlflowTraceScope::VisibleOperator => "visible_operator",
        MlflowTraceScope::Gateway => "gateway",
        MlflowTraceScope::GoalTask => "goal_task",
        MlflowTraceScope::Subagent => "subagent",
        MlflowTraceScope::Concierge => "concierge",
        MlflowTraceScope::HeartbeatAutonomous => "heartbeat_autonomous",
        MlflowTraceScope::Unknown => "unknown",
    }
}

fn usage_attributes(
    input_tokens: u64,
    output_tokens: u64,
    cache_read_input_tokens: u64,
    cache_creation_input_tokens: u64,
) -> Vec<KeyValue> {
    let total = input_tokens.saturating_add(output_tokens);
    let mut token_usage = serde_json::json!({
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": total,
    });
    if cache_read_input_tokens > 0 {
        token_usage["cache_read_input_tokens"] = cache_read_input_tokens.into();
    }
    if cache_creation_input_tokens > 0 {
        token_usage["cache_creation_input_tokens"] = cache_creation_input_tokens.into();
    }
    let mut attributes = vec![
        kv_i64("gen_ai.usage.input_tokens", input_tokens as i64),
        kv_i64("gen_ai.usage.output_tokens", output_tokens as i64),
        kv_i64("gen_ai.usage.total_tokens", total as i64),
        kv_string("mlflow.chat.tokenUsage", &token_usage.to_string()),
    ];
    if cache_read_input_tokens > 0 {
        attributes.push(kv_i64(
            "gen_ai.usage.cache_read.input_tokens",
            cache_read_input_tokens as i64,
        ));
    }
    if cache_creation_input_tokens > 0 {
        attributes.push(kv_i64(
            "gen_ai.usage.cache_creation.input_tokens",
            cache_creation_input_tokens as i64,
        ));
    }
    attributes
}

fn millis_to_nanos(value: u64) -> u64 {
    value.saturating_mul(1_000_000)
}

fn kv_string(key: &str, value: &str) -> KeyValue {
    KeyValue {
        key: key.into(),
        value: Some(AnyValue {
            value: Some(any_value::Value::StringValue(value.into())),
        }),
    }
}

fn kv_bool(key: &str, value: bool) -> KeyValue {
    KeyValue {
        key: key.into(),
        value: Some(AnyValue {
            value: Some(any_value::Value::BoolValue(value)),
        }),
    }
}

fn kv_i64(key: &str, value: i64) -> KeyValue {
    KeyValue {
        key: key.into(),
        value: Some(AnyValue {
            value: Some(any_value::Value::IntValue(value)),
        }),
    }
}

fn kv_double(key: &str, value: f64) -> KeyValue {
    KeyValue {
        key: key.into(),
        value: Some(AnyValue {
            value: Some(any_value::Value::DoubleValue(value)),
        }),
    }
}
