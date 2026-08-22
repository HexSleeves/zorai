use super::super::*;
use crate::agent::types::AgentEvent;

fn runtime() -> (tempfile::TempDir, std::sync::Arc<MlflowTracingRuntime>) {
    let dir = tempfile::tempdir().unwrap();
    let runtime = MlflowTracingRuntime::new(dir.path(), &MlflowTracingConfig::default());
    (dir, runtime)
}

fn push(runtime: &MlflowTracingRuntime, thread: &str, content: &str, timestamp_ms: u64) {
    runtime.push_turn_anchor(
        thread,
        MlflowTurnAnchor {
            user_message_id: format!("{content}-id"),
            content: content.to_string(),
            timestamp_ms,
        },
    );
}

fn done(thread: &str) -> AgentEvent {
    AgentEvent::Done {
        thread_id: thread.into(),
        input_tokens: 1,
        output_tokens: 1,
        cost: None,
        provider: None,
        model: None,
        tps: None,
        generation_ms: None,
        reasoning: None,
        upstream_message: None,
        provider_final_result: None,
        message_id: Some("a1".into()),
    }
}

fn delta(thread: &str) -> AgentEvent {
    AgentEvent::Delta {
        thread_id: thread.into(),
        content: "x".into(),
    }
}

fn observation_context(thread: &str) -> TurnObservationContext {
    TurnObservationContext {
        relationships: MlflowTraceRelationships {
            thread_id: thread.into(),
            client_surface: Some("desktop".into()),
            user_message_id: Some("u1".into()),
            ..Default::default()
        },
        input: None,
        user_message_timestamp_ms: Some(1),
        autonomous: false,
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
    }
}

#[test]
fn untraced_done_releases_front_anchor_so_later_turn_keeps_its_prompt() {
    // Why this matters: send_message always queued a FIFO anchor, but the worker
    // only popped after an exported trace. Filtered scopes and failed enrichment
    // skipped observe(), so the oldest prompt stayed in front and later exported
    // turns were labeled with the wrong user input.
    let (_dir, runtime) = runtime();
    let assembler = TurnTraceAssembler::new(MlflowTracingConfig::default());
    push(&runtime, "t1", "first", 1);
    push(&runtime, "t1", "second", 2);

    release_anchor_for_closed_untraced_turn(&runtime, &assembler, &done("t1"));

    let front = runtime
        .front_turn_anchor("t1")
        .expect("second prompt remains");
    assert_eq!(
        front.content, "second",
        "a skipped/filtered turn must consume its own anchor"
    );
}

#[test]
fn untraced_error_and_interrupt_also_release_the_front_anchor() {
    let (_dir, runtime) = runtime();
    let assembler = TurnTraceAssembler::new(MlflowTracingConfig::default());
    push(&runtime, "t1", "first", 1);
    push(&runtime, "t1", "second", 2);
    push(&runtime, "t1", "third", 3);

    release_anchor_for_closed_untraced_turn(
        &runtime,
        &assembler,
        &AgentEvent::Error {
            thread_id: "t1".into(),
            message: "fail".into(),
        },
    );
    release_anchor_for_closed_untraced_turn(
        &runtime,
        &assembler,
        &AgentEvent::TurnInterrupted {
            thread_id: "t1".into(),
        },
    );

    assert_eq!(runtime.front_turn_anchor("t1").unwrap().content, "third");
}

#[test]
fn non_closing_events_do_not_release_anchors() {
    let (_dir, runtime) = runtime();
    let assembler = TurnTraceAssembler::new(MlflowTracingConfig::default());
    push(&runtime, "t1", "first", 1);

    release_anchor_for_closed_untraced_turn(&runtime, &assembler, &delta("t1"));

    assert_eq!(
        runtime.front_turn_anchor("t1").unwrap().content,
        "first",
        "deltas are not a turn close; popping here would steal the in-flight prompt"
    );
}

#[test]
fn filtered_done_does_not_double_pop_when_the_assembler_already_owns_the_turn() {
    let (_dir, runtime) = runtime();
    let mut assembler = TurnTraceAssembler::new(MlflowTracingConfig::default());
    push(&runtime, "t1", "first", 1);
    push(&runtime, "t1", "second", 2);
    assembler.observe(1_000, delta("t1"), observation_context("t1"));

    release_anchor_for_closed_untraced_turn(&runtime, &assembler, &done("t1"));

    assert_eq!(
        runtime.front_turn_anchor("t1").unwrap().content,
        "first",
        "an in-flight traced turn still pops from enqueue_completed, not this fallback"
    );
}

#[test]
fn disabled_tracing_abandons_in_flight_turn_and_releases_its_anchor() {
    let (_dir, runtime) = runtime();
    let mut assembler = TurnTraceAssembler::new(MlflowTracingConfig::default());
    push(&runtime, "t1", "first", 1);
    push(&runtime, "t1", "second", 2);
    assembler.observe(1_000, delta("t1"), observation_context("t1"));

    release_anchor_if_tracing_disabled(&runtime, &mut assembler, &done("t1"));

    assert!(
        !assembler.has_active_turn("t1"),
        "disabled tracing must not keep a partial turn that would export after re-enable"
    );
    assert!(assembler.drain_completed().is_empty());
    assert_eq!(runtime.front_turn_anchor("t1").unwrap().content, "second");
}

#[test]
fn select_turn_user_follows_released_queue_front() {
    let (_dir, runtime) = runtime();
    let assembler = TurnTraceAssembler::new(MlflowTracingConfig::default());
    let first = crate::agent::types::AgentMessage::user("first question", 1_000);
    let second = crate::agent::types::AgentMessage::user("second question", 2_000);
    push(&runtime, "t1", "first question", 1_000);
    push(&runtime, "t1", "second question", 2_000);
    release_anchor_for_closed_untraced_turn(&runtime, &assembler, &done("t1"));

    let selected =
        select_turn_user(&[first, second], runtime.front_turn_anchor("t1").as_ref()).unwrap();
    assert_eq!(selected.content, "second question");
}
