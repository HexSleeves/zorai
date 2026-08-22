use super::super::*;
use prost::Message;

fn fixture_trace() -> CompletedTurnTrace {
    let root = [2; 8];
    CompletedTurnTrace {
        trace_id: [1; 16],
        root_span_id: root,
        relationships: MlflowTraceRelationships {
            thread_id: "thread-1".into(),
            user_message_id: Some("u1".into()),
            agent_id: Some("svarog".into()),
            client_surface: Some("desktop".into()),
            ..Default::default()
        },
        scope: MlflowTraceScope::VisibleOperator,
        generation: 1,
        started_at_ms: 1_000,
        ended_at_ms: 2_000,
        timing_inferred: true,
        outcome: MlflowTraceOutcome::Ok,
        partial_reason: None,
        input: Some(CapturedValue {
            value: "hello".into(),
            redacted: false,
            truncated: false,
            original_chars: 5,
        }),
        output: Some(CapturedValue {
            value: "world".into(),
            redacted: false,
            truncated: false,
            original_chars: 5,
        }),
        reasoning: None,
        spans: vec![
            CompletedTraceSpan {
                span_id: [3; 8],
                parent_span_id: root,
                name: "gen_ai.response".into(),
                kind: MlflowSpanKind::Llm,
                started_at_ms: 1_100,
                ended_at_ms: 1_400,
                timing_inferred: true,
                outcome: MlflowTraceOutcome::Ok,
                input: None,
                output: None,
                call_id: None,
            },
            CompletedTraceSpan {
                span_id: [4; 8],
                parent_span_id: root,
                name: "zorai.tool read_file".into(),
                kind: MlflowSpanKind::Tool,
                started_at_ms: 1_400,
                ended_at_ms: 1_600,
                timing_inferred: false,
                outcome: MlflowTraceOutcome::Ok,
                input: Some(CapturedValue {
                    value: "{\"path\":\"a\"}".into(),
                    redacted: false,
                    truncated: false,
                    original_chars: 12,
                }),
                output: Some(CapturedValue {
                    value: "ok".into(),
                    redacted: false,
                    truncated: false,
                    original_chars: 2,
                }),
                call_id: Some("c1".into()),
            },
        ],
        input_tokens: 10,
        output_tokens: 4,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        cost_usd: Some(0.01),
        provider: Some("openai".into()),
        model: Some("gpt-test".into()),
    }
}

fn string_attr<'a>(span: &'a OtlpSpan, key: &str) -> Option<&'a str> {
    span.attributes
        .iter()
        .find(|entry| entry.key == key)
        .and_then(|entry| match entry.value.as_ref()?.value.as_ref()? {
            any_value::Value::StringValue(value) => Some(value.as_str()),
            _ => None,
        })
}

fn i64_attr(span: &OtlpSpan, key: &str) -> Option<i64> {
    span.attributes
        .iter()
        .find(|entry| entry.key == key)
        .and_then(|entry| match entry.value.as_ref()?.value.as_ref()? {
            any_value::Value::IntValue(value) => Some(*value),
            _ => None,
        })
}

#[test]
fn otlp_batch_preserves_hierarchy_and_mlflow_genai_attributes() {
    let bytes = encode_otlp_batch(&[fixture_trace()]).unwrap();
    let request = ExportTraceServiceRequest::decode(bytes.as_slice()).unwrap();
    let resource = &request.resource_spans[0];
    assert_eq!(resource.scope_spans[0].spans.len(), 3);
    let spans = &resource.scope_spans[0].spans;
    let root = spans
        .iter()
        .find(|span| span.parent_span_id.is_empty())
        .unwrap();
    assert_eq!(root.name, "zorai.turn");
    assert_eq!(
        string_attr(root, "gen_ai.operation.name"),
        Some("invoke_agent")
    );
    assert_eq!(string_attr(root, "gen_ai.provider.name"), Some("openai"));
    assert_eq!(string_attr(root, "gen_ai.response.model"), Some("gpt-test"));
    assert!(string_attr(root, "gen_ai.input.messages")
        .unwrap()
        .contains("hello"));
    let tool = spans
        .iter()
        .find(|span| span.name.contains("read_file"))
        .unwrap();
    assert_eq!(tool.parent_span_id, root.span_id);
    assert_eq!(
        string_attr(tool, "gen_ai.operation.name"),
        Some("execute_tool")
    );
    assert_eq!(string_attr(tool, "gen_ai.tool.call.id"), Some("c1"));
    assert_eq!(root.start_time_unix_nano, 1_000_000_000);
    assert_eq!(root.end_time_unix_nano, 2_000_000_000);
    assert_eq!(i64_attr(root, "gen_ai.usage.input_tokens"), Some(10));
    assert_eq!(i64_attr(root, "gen_ai.usage.output_tokens"), Some(4));
    assert_eq!(i64_attr(root, "gen_ai.usage.total_tokens"), Some(14));
    assert_eq!(
        i64_attr(root, "gen_ai.usage.cache_read.input_tokens"),
        None,
        "omit cache-read when the provider did not report it so MLflow stays n/a"
    );
    assert_eq!(
        i64_attr(root, "gen_ai.usage.cache_creation.input_tokens"),
        None
    );
    let token_usage = string_attr(root, "mlflow.chat.tokenUsage").unwrap();
    assert!(token_usage.contains("\"input_tokens\":10"));
    assert!(
        !token_usage.contains("cache_read_input_tokens"),
        "zero cache read must not appear in mlflow.chat.tokenUsage"
    );
    assert!(!token_usage.contains("cache_creation_input_tokens"));
    let llm = spans
        .iter()
        .find(|span| span.name == "gen_ai.response")
        .unwrap();
    assert_eq!(i64_attr(llm, "gen_ai.usage.input_tokens"), Some(10));
    assert_eq!(i64_attr(llm, "gen_ai.usage.output_tokens"), Some(4));
    assert_eq!(i64_attr(tool, "gen_ai.usage.input_tokens"), None);
}

#[test]
fn otlp_usage_includes_cache_tokens_when_present() {
    let mut trace = fixture_trace();
    trace.cache_read_input_tokens = 40;
    trace.cache_creation_input_tokens = 8;
    let request =
        ExportTraceServiceRequest::decode(encode_otlp_batch(&[trace]).unwrap().as_slice()).unwrap();
    let root = request.resource_spans[0].scope_spans[0]
        .spans
        .iter()
        .find(|span| span.parent_span_id.is_empty())
        .unwrap();
    assert_eq!(
        i64_attr(root, "gen_ai.usage.cache_read.input_tokens"),
        Some(40)
    );
    assert_eq!(
        i64_attr(root, "gen_ai.usage.cache_creation.input_tokens"),
        Some(8)
    );
    let token_usage = string_attr(root, "mlflow.chat.tokenUsage").unwrap();
    assert!(token_usage.contains("\"cache_read_input_tokens\":40"));
    assert!(token_usage.contains("\"cache_creation_input_tokens\":8"));
}

#[test]
fn otlp_root_span_exports_full_capture_reasoning() {
    let mut trace = fixture_trace();
    trace.reasoning = Some(CapturedValue {
        value: "private plan".into(),
        redacted: false,
        truncated: false,
        original_chars: 12,
    });
    let request =
        ExportTraceServiceRequest::decode(encode_otlp_batch(&[trace]).unwrap().as_slice()).unwrap();
    let root = request.resource_spans[0].scope_spans[0]
        .spans
        .iter()
        .find(|span| span.parent_span_id.is_empty())
        .unwrap();
    assert_eq!(string_attr(root, "gen_ai.reasoning"), Some("private plan"));
}

#[test]
fn otlp_batch_uses_standard_resource_identity() {
    let request = ExportTraceServiceRequest::decode(
        encode_otlp_batch(&[fixture_trace()]).unwrap().as_slice(),
    )
    .unwrap();
    let attributes = &request.resource_spans[0]
        .resource
        .as_ref()
        .unwrap()
        .attributes;
    assert!(attributes.iter().any(|entry| entry.key == "service.name"));
    assert!(attributes
        .iter()
        .any(|entry| entry.key == "service.version"));
}
