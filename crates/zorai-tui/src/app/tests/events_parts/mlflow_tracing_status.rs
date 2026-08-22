use super::idle_tick_does_not_request_redraw_to_first_raw_config_load_triggers::*;
use crate::app::*;
use crate::client::ClientEvent;
use crate::state::settings::SettingsTab;
use crate::state::SettingsAction;
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

fn select_mlflow_field(model: &mut TuiModel, field: &str) {
    model
        .settings
        .reduce(SettingsAction::SwitchTab(SettingsTab::Mlflow));
    for _ in 0..model.settings_field_count() {
        if model.current_settings_field_name() == field {
            return;
        }
        model.settings.reduce(SettingsAction::NavigateField(1));
    }
    panic!("MLflow settings field {field} not found");
}

fn activate_or_toggle_current_settings_field(model: &mut TuiModel) {
    if model.settings_field_click_uses_toggle() {
        model.toggle_settings_field();
    } else {
        model.activate_settings_field();
    }
}

#[test]
fn enter_on_mlflow_test_connection_sends_daemon_command() {
    let (mut model, mut daemon_rx) = make_model_with_daemon_rx();
    select_mlflow_field(&mut model, "mlflow_test_connection");

    activate_or_toggle_current_settings_field(&mut model);

    assert!(
        matches!(
            daemon_rx
                .try_recv()
                .expect("Enter on Test connection must ask the daemon"),
            DaemonCommand::TestMlflowTracingConnection
        ),
        "Enter and click use activate/toggle, not a silent no-op"
    );
    assert_eq!(model.status_line, "Testing MLflow connection…");
}

#[test]
fn enter_on_mlflow_send_test_trace_sends_daemon_command() {
    let (mut model, mut daemon_rx) = make_model_with_daemon_rx();
    select_mlflow_field(&mut model, "mlflow_send_test_trace");

    activate_or_toggle_current_settings_field(&mut model);

    assert!(
        matches!(
            daemon_rx
                .try_recv()
                .expect("Enter on Send test trace must ask the daemon"),
            DaemonCommand::SendMlflowTracingTestTrace
        ),
        "Enter and click use activate/toggle, not a silent no-op"
    );
    assert_eq!(model.status_line, "Sending MLflow test trace…");
}

#[test]
fn enter_on_mlflow_tracking_uri_starts_inline_edit() {
    let (mut model, _daemon_rx) = make_model_with_daemon_rx();
    select_mlflow_field(&mut model, "mlflow_tracking_uri");

    activate_or_toggle_current_settings_field(&mut model);

    assert_eq!(
        model.settings.editing_field(),
        Some("mlflow_tracking_uri"),
        "Enter on Tracking URI must open inline edit, not skip the field"
    );
    assert!(!model.settings_field_click_uses_toggle());
}
