use super::*;

#[test]
fn thread_handoff_result_success_refreshes_without_optimistic_state_change() {
    let (mut model, mut daemon_rx) = make_model();
    seed_thread_with_state(&mut model, 2);
    if let Some(thread) = model.chat.active_thread_mut() {
        thread.agent_name = Some("Svarog".to_string());
    }
    model.open_thread_handoff_modal();
    let before_name = model
        .chat
        .active_thread()
        .and_then(|thread| thread.agent_name.clone());
    let before_state = model
        .chat
        .active_thread()
        .and_then(|thread| thread.thread_handoff_state.clone());

    model.handle_client_event(crate::client::ClientEvent::ThreadHandoffResult(
        zorai_protocol::ThreadHandoffResult {
            ok: true,
            thread_id: "thread-modal".to_string(),
            active_agent_id: Some("weles".to_string()),
            stack_depth: Some(2),
            error: None,
        },
    ));

    assert_eq!(
        model.status_line,
        "Thread handed off to weles (stack depth 2)"
    );
    assert_ne!(
        model.modal.top(),
        Some(crate::state::modal::ModalKind::ThreadHandoff)
    );
    assert_eq!(
        model
            .chat
            .active_thread()
            .and_then(|thread| thread.agent_name.clone()),
        before_name
    );
    assert_eq!(
        model
            .chat
            .active_thread()
            .and_then(|thread| thread.thread_handoff_state.clone()),
        before_state
    );
    assert!(matches!(
        daemon_rx.try_recv(),
        Ok(DaemonCommand::RequestThread { thread_id, .. }) if thread_id == "thread-modal"
    ));
}

#[test]
fn thread_handoff_result_success_defaults_missing_fields() {
    let (mut model, mut daemon_rx) = make_model();
    seed_thread_with_state(&mut model, 1);

    model.handle_client_event(crate::client::ClientEvent::ThreadHandoffResult(
        zorai_protocol::ThreadHandoffResult {
            ok: true,
            thread_id: "thread-modal".to_string(),
            active_agent_id: None,
            stack_depth: None,
            error: None,
        },
    ));

    assert_eq!(
        model.status_line,
        "Thread handed off to updated responder (stack depth 0)"
    );
    assert!(matches!(
        daemon_rx.try_recv(),
        Ok(DaemonCommand::RequestThread { thread_id, .. }) if thread_id == "thread-modal"
    ));
}

#[test]
fn thread_handoff_result_failure_keeps_modal_and_state_and_does_not_refresh() {
    let (mut model, mut daemon_rx) = make_model();
    seed_thread_with_state(&mut model, 2);
    model.open_thread_handoff_modal();
    let before_name = model
        .chat
        .active_thread()
        .and_then(|thread| thread.agent_name.clone());
    let before_state = model
        .chat
        .active_thread()
        .and_then(|thread| thread.thread_handoff_state.clone());

    model.handle_client_event(crate::client::ClientEvent::ThreadHandoffResult(
        zorai_protocol::ThreadHandoffResult {
            ok: false,
            thread_id: "thread-modal".to_string(),
            active_agent_id: None,
            stack_depth: None,
            error: Some("target inactive".to_string()),
        },
    ));

    assert_eq!(model.status_line, "target inactive");
    assert_eq!(
        model.modal.top(),
        Some(crate::state::modal::ModalKind::ThreadHandoff)
    );
    assert_eq!(
        model
            .chat
            .active_thread()
            .and_then(|thread| thread.agent_name.clone()),
        before_name
    );
    assert_eq!(
        model
            .chat
            .active_thread()
            .and_then(|thread| thread.thread_handoff_state.clone()),
        before_state
    );
    assert!(daemon_rx.try_recv().is_err());
}

#[test]
fn thread_handoff_result_failure_without_error_uses_fallback() {
    let (mut model, mut daemon_rx) = make_model();
    seed_thread_with_state(&mut model, 1);

    model.handle_client_event(crate::client::ClientEvent::ThreadHandoffResult(
        zorai_protocol::ThreadHandoffResult {
            ok: false,
            thread_id: "thread-modal".to_string(),
            active_agent_id: None,
            stack_depth: None,
            error: None,
        },
    ));

    assert_eq!(model.status_line, "Thread handoff failed");
    assert!(daemon_rx.try_recv().is_err());
}
