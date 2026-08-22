use super::idle_tick_does_not_request_redraw_to_first_raw_config_load_triggers::*;
use crate::app::*;
use crate::client::ClientEvent;
use crate::state::settings::SettingsTab;
use zorai_shared::providers::PROVIDER_ID_OPENAI;

#[test]
fn mlflow_test_result_does_not_replace_runtime_status() {
    let (mut model, mut daemon_rx) = make_model_with_daemon_rx();
    model.config.mlflow_runtime_status = Some(serde_json::json!({
        "state": "degraded",
        "last_error": "tracking server timeout"
    }));

    model.handle_client_event(ClientEvent::MlflowTracingTestResult(serde_json::json!({
        "ok": false,
        "error": "connection refused"
    })));

    assert_eq!(
        model
            .config
            .mlflow_runtime_status
            .as_ref()
            .and_then(|value| value.get("state")),
        Some(&serde_json::json!("degraded")),
        "connection tests must not clobber the daemon runtime status used by the MLflow tab"
    );
    assert_eq!(
        model
            .config
            .mlflow_test_result
            .as_ref()
            .and_then(|value| value.get("error")),
        Some(&serde_json::json!("connection refused"))
    );
    assert!(
        matches!(
            daemon_rx.try_recv().expect("test result should refresh runtime status"),
            DaemonCommand::GetMlflowTracingStatus
        ),
        "after a test, the tab should re-read daemon status instead of inferring it from the test payload"
    );
}

#[test]
fn opening_mlflow_settings_tab_requests_runtime_status() {
    let (mut model, mut daemon_rx) = make_model_with_daemon_rx();
    model.open_settings_tab(SettingsTab::Mlflow);
    let mut saw_status = false;
    while let Ok(command) = daemon_rx.try_recv() {
        if matches!(command, DaemonCommand::GetMlflowTracingStatus) {
            saw_status = true;
            break;
        }
    }
    assert!(
        saw_status,
        "the MLflow tab has no status until the TUI asks the daemon for it"
    );
}

#[test]
fn first_raw_config_load_requests_mlflow_tracing_status() {
    let (mut model, mut daemon_rx) = make_model_with_daemon_rx();
    model.connected = true;
    model.agent_config_loaded = false;
    model.handle_agent_config_raw_event(serde_json::json!({
        "provider": PROVIDER_ID_OPENAI,
        "base_url": "https://api.openai.com/v1",
        "model": "gpt-5.4",
    }));
    let mut saw_status = false;
    while let Ok(command) = daemon_rx.try_recv() {
        if matches!(command, DaemonCommand::GetMlflowTracingStatus) {
            saw_status = true;
            break;
        }
    }
    assert!(
        saw_status,
        "startup should populate MLflow runtime status before the settings tab is opened"
    );
}
