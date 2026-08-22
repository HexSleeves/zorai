use super::super::*;
use crate::agent::types::AgentEvent;

fn context(thread: &str) -> TurnObservationContext {
    TurnObservationContext {
        relationships: MlflowTraceRelationships {
            thread_id: thread.into(),
            client_surface: Some("desktop".into()),
            user_message_id: Some("u1".into()),
            ..Default::default()
        },
        input: capture_text(
            "hello",
            MlflowCaptureMode::Guarded,
            MlflowContentKind::User,
            100,
        ),
        user_message_timestamp_ms: Some(900),
        autonomous: false,
    }
}

fn done(thread: &str, id: &str) -> AgentEvent {
    AgentEvent::Done {
        thread_id: thread.into(),
        input_tokens: 10,
        output_tokens: 4,
        cost: Some(0.01),
        provider: Some("openai".into()),
        model: Some("gpt".into()),
        tps: None,
        generation_ms: Some(100),
        reasoning: None,
        upstream_message: None,
        provider_final_result: None,
        message_id: Some(id.into()),
    }
}

#[test]
fn simple_turn_reconstructs_root_and_inferred_llm_span() {
    let mut assembler = TurnTraceAssembler::new(MlflowTracingConfig::default());
    assembler.observe(
        1_000,
        AgentEvent::Delta {
            thread_id: "t1".into(),
            content: "Hello".into(),
        },
        context("t1"),
    );
    assembler.observe(1_100, done("t1", "a1"), context("t1"));
    let trace = assembler.drain_completed().pop().unwrap();
    assert_eq!(trace.relationships.thread_id, "t1");
    assert_eq!(trace.started_at_ms, 900);
    assert_eq!(trace.ended_at_ms, 1_100);
    assert_eq!(trace.output.as_ref().unwrap().value, "Hello");
    assert_eq!(trace.spans.len(), 1);
    assert_eq!(trace.spans[0].kind, MlflowSpanKind::Llm);
    assert!(trace.spans[0].timing_inferred);
}

#[test]
fn tool_span_uses_exact_call_result_boundaries() {
    let mut assembler = TurnTraceAssembler::new(MlflowTracingConfig::default());
    assembler.observe(
        1_000,
        AgentEvent::ToolCall {
            thread_id: "t1".into(),
            call_id: "c1".into(),
            name: "read_file".into(),
            arguments: "{\"path\":\"a\"}".into(),
            weles_review: None,
            message_id: None,
        },
        context("t1"),
    );
    assembler.observe(
        1_250,
        AgentEvent::ToolResult {
            thread_id: "t1".into(),
            call_id: "c1".into(),
            name: "read_file".into(),
            content: "ok".into(),
            is_error: false,
            weles_review: None,
            message_id: None,
        },
        context("t1"),
    );
    assembler.observe(1_300, done("t1", "a1"), context("t1"));
    let trace = assembler.drain_completed().pop().unwrap();
    let tool = trace
        .spans
        .iter()
        .find(|span| span.kind == MlflowSpanKind::Tool)
        .unwrap();
    assert_eq!(tool.ended_at_ms - tool.started_at_ms, 250);
    assert!(!tool.timing_inferred);
    assert_eq!(tool.call_id.as_deref(), Some("c1"));
}

#[test]
fn stale_and_interleaved_turns_are_isolated() {
    let mut config = MlflowTracingConfig::default();
    config.stale_turn_timeout_ms = 10_000;
    let mut assembler = TurnTraceAssembler::new(config);
    assembler.observe(
        1_000,
        AgentEvent::Delta {
            thread_id: "a".into(),
            content: "A".into(),
        },
        context("a"),
    );
    assembler.observe(
        2_000,
        AgentEvent::Delta {
            thread_id: "b".into(),
            content: "B".into(),
        },
        context("b"),
    );
    assembler.observe(2_100, done("b", "b1"), context("b"));
    assembler.expire_stale(11_000);
    let traces = assembler.drain_completed();
    assert_eq!(traces.len(), 2);
    assert!(traces
        .iter()
        .any(|trace| trace.relationships.thread_id == "a"
            && trace.partial_reason.as_deref() == Some("stale_timeout")));
    assert!(traces.iter().any(
        |trace| trace.relationships.thread_id == "b" && trace.outcome == MlflowTraceOutcome::Ok
    ));
}

#[test]
fn broadcast_lag_closes_active_turn_as_partial() {
    let mut assembler = TurnTraceAssembler::new(MlflowTracingConfig::default());
    assembler.observe(
        1_000,
        AgentEvent::Delta {
            thread_id: "t".into(),
            content: "x".into(),
        },
        context("t"),
    );
    assembler.mark_broadcast_lag(1_050);
    assert_eq!(assembler.active_len(), 0);
    let trace = assembler.drain_completed().pop().unwrap();
    assert_eq!(trace.partial_reason.as_deref(), Some("broadcast_lag"));
}

#[test]
fn configured_span_limit_is_hard() {
    let mut config = MlflowTracingConfig::default();
    config.max_spans_per_trace = 1;
    let mut assembler = TurnTraceAssembler::new(config);
    assembler.observe(
        1_000,
        AgentEvent::Delta {
            thread_id: "t".into(),
            content: "thinking".into(),
        },
        context("t"),
    );
    assembler.observe(
        1_050,
        AgentEvent::ToolCall {
            thread_id: "t".into(),
            call_id: "c1".into(),
            name: "read_file".into(),
            arguments: "{}".into(),
            weles_review: None,
            message_id: None,
        },
        context("t"),
    );
    assembler.observe(1_100, done("t", "a1"), context("t"));
    let trace = assembler.drain_completed().pop().unwrap();
    assert_eq!(trace.spans.len(), 1);
}
