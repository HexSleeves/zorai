use super::super::*;
use crate::agent::types::AgentMessage;

#[test]
fn select_turn_user_prefers_anchor_over_latest_user() {
    let first = AgentMessage::user("first question", 1_000);
    let second = AgentMessage::user("second question", 2_000);
    let anchor = MlflowTurnAnchor {
        user_message_id: first.id.clone(),
        content: first.content.clone(),
        timestamp_ms: first.timestamp,
    };
    let selected = select_turn_user(&[first, second], Some(&anchor)).unwrap();
    assert_eq!(
        selected.content, "first question",
        "a lagged worker must not attribute an earlier turn to the latest user message"
    );
}

#[test]
fn select_turn_user_falls_back_to_latest_without_anchor() {
    let first = AgentMessage::user("first question", 1_000);
    let second = AgentMessage::user("second question", 2_000);
    let selected = select_turn_user(&[first, second], None).unwrap();
    assert_eq!(selected.content, "second question");
}
