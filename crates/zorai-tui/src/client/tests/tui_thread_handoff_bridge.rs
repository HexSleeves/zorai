use super::drain_request;
use crate::client::{ClientEvent, DaemonClient};
use tokio::sync::mpsc;
use zorai_protocol::{ClientMessage, ClientSurface, DaemonMessage, ThreadHandoffResult};

#[test]
fn tui_thread_handoff_bridge_emits_exact_push_and_return_requests() {
    let (event_tx, _event_rx) = mpsc::channel(8);
    let client = DaemonClient::new(event_tx);
    let mut request_rx = client.request_rx.lock().unwrap().take().unwrap();

    client
        .send_thread_handoff(
            "thread-1".to_string(),
            "push_handoff".to_string(),
            Some("weles".to_string()),
            "Operator requested handoff to Weles".to_string(),
            "Continue this thread as Weles".to_string(),
        )
        .expect("queue push handoff request");

    match drain_request(&mut request_rx) {
        ClientMessage::AgentHandoffThread {
            thread_id,
            action,
            target_agent_id,
            reason,
            summary,
            requested_by,
            session_id,
            client_surface,
        } => {
            assert_eq!(thread_id, "thread-1");
            assert_eq!(action, "push_handoff");
            assert_eq!(target_agent_id.as_deref(), Some("weles"));
            assert_eq!(reason, "Operator requested handoff to Weles");
            assert_eq!(summary, "Continue this thread as Weles");
            assert_eq!(requested_by, "user");
            assert_eq!(session_id, None);
            assert_eq!(client_surface, Some(ClientSurface::Tui));
        }
        other => panic!("expected AgentHandoffThread, got {other:?}"),
    }

    client
        .send_thread_handoff(
            "thread-1".to_string(),
            "return_handoff".to_string(),
            None,
            "Resume original responder".to_string(),
            "Return this thread".to_string(),
        )
        .expect("queue return handoff request");

    match drain_request(&mut request_rx) {
        ClientMessage::AgentHandoffThread {
            action,
            target_agent_id,
            ..
        } => {
            assert_eq!(action, "return_handoff");
            assert_eq!(target_agent_id, None);
        }
        other => panic!("expected AgentHandoffThread, got {other:?}"),
    }
}

#[tokio::test]
async fn tui_thread_handoff_bridge_maps_daemon_result_to_typed_client_event() {
    let (event_tx, mut event_rx) = mpsc::channel(8);
    let result = ThreadHandoffResult {
        ok: false,
        thread_id: "thread-1".to_string(),
        active_agent_id: Some("weles".to_string()),
        stack_depth: Some(2),
        error: Some("handoff approval required".to_string()),
    };

    let should_continue = super::dispatch_for_test(
        DaemonMessage::AgentThreadHandoffResult {
            result: result.clone(),
        },
        &event_tx,
    )
    .await;

    assert!(should_continue);
    match event_rx
        .recv()
        .await
        .expect("expected handoff result event")
    {
        ClientEvent::ThreadHandoffResult(actual) => assert_eq!(actual, result),
        other => panic!("expected ThreadHandoffResult, got {other:?}"),
    }
}
