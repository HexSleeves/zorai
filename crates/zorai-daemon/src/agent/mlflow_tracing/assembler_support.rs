use super::CompletedSpanEvent;
use crate::agent::types::AgentEvent;

pub(super) fn opens_turn(event: &AgentEvent) -> bool {
    matches!(
        event,
        AgentEvent::Delta { .. } | AgentEvent::Reasoning { .. } | AgentEvent::ToolCall { .. }
    )
}

pub(super) fn is_traceable(event: &AgentEvent) -> bool {
    matches!(
        event,
        AgentEvent::Delta { .. }
            | AgentEvent::Reasoning { .. }
            | AgentEvent::ToolCall { .. }
            | AgentEvent::ToolResult { .. }
            | AgentEvent::Done { .. }
            | AgentEvent::Error { .. }
            | AgentEvent::ApprovalRequired { .. }
            | AgentEvent::RetryStatus { .. }
    )
}

pub(super) fn event_thread_id(event: &AgentEvent) -> Option<&str> {
    match event {
        AgentEvent::Delta { thread_id, .. }
        | AgentEvent::Reasoning { thread_id, .. }
        | AgentEvent::ToolCall { thread_id, .. }
        | AgentEvent::ToolResult { thread_id, .. }
        | AgentEvent::Done { thread_id, .. }
        | AgentEvent::Error { thread_id, .. }
        | AgentEvent::TurnInterrupted { thread_id }
        | AgentEvent::ApprovalRequired { thread_id, .. }
        | AgentEvent::RetryStatus { thread_id, .. } => Some(thread_id),
        _ => None,
    }
}

pub(super) fn record_span_event(
    events: &mut Vec<CompletedSpanEvent>,
    dropped_events: &mut u32,
    at_ms: u64,
    name: &str,
    attributes: Vec<(String, String)>,
    max_events: usize,
) {
    if events.len() >= max_events {
        *dropped_events = dropped_events.saturating_add(1);
        return;
    }
    events.push(CompletedSpanEvent {
        name: name.into(),
        at_ms,
        attributes,
    });
}

pub(super) fn append_capped(target: &mut String, value: &str, max_chars: usize) {
    let remaining = max_chars.saturating_sub(target.chars().count());
    target.extend(value.chars().take(remaining));
}

pub(super) fn random_trace_id() -> [u8; 16] {
    *uuid::Uuid::new_v4().as_bytes()
}

pub(super) fn random_span_id() -> [u8; 8] {
    let bytes = uuid::Uuid::new_v4();
    let mut id = [0; 8];
    id.copy_from_slice(&bytes.as_bytes()[..8]);
    id
}

fn attr_text(value: &str) -> String {
    value.chars().take(256).collect()
}

pub(super) fn approval_event_attributes(
    approval_id: &str,
    command: &str,
    risk_level: &str,
) -> Vec<(String, String)> {
    vec![
        ("approval_id".into(), attr_text(approval_id)),
        ("risk_level".into(), attr_text(risk_level)),
        ("command".into(), attr_text(command)),
    ]
}

pub(super) fn retry_event_attributes(
    phase: &str,
    attempt: u32,
    max_retries: u32,
    delay_ms: u64,
    failure_class: &str,
    message: &str,
) -> Vec<(String, String)> {
    vec![
        ("phase".into(), attr_text(phase)),
        ("attempt".into(), attempt.to_string()),
        ("max_retries".into(), max_retries.to_string()),
        ("delay_ms".into(), delay_ms.to_string()),
        ("failure_class".into(), attr_text(failure_class)),
        ("message".into(), attr_text(message)),
    ]
}
