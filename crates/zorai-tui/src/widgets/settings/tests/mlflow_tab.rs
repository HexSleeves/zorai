use super::*;
use crate::state::settings::{SettingsAction, SettingsState, SettingsTab};
use crate::state::subagents::SubAgentsState;
use crate::theme::ThemeTokens;

#[test]
fn mlflow_tab_is_registered_with_safe_defaults() {
    assert!(SettingsTab::all().contains(&SettingsTab::Mlflow));
    let config = ConfigState::new();
    assert!(!config.mlflow_enabled);
    assert_eq!(config.mlflow_tracking_uri, "http://127.0.0.1:5000");
    assert_eq!(config.mlflow_experiment_name, "zorai-conversations");
    assert_eq!(config.mlflow_capture_mode, "guarded");
    assert!(config.mlflow_visible_operator);
    assert!(!config.mlflow_heartbeat_autonomous);
}

#[test]
fn mlflow_tab_renders_controls_and_runtime_status() {
    let mut settings = SettingsState::default();
    settings.reduce(SettingsAction::Open);
    settings.reduce(SettingsAction::SwitchTab(SettingsTab::Mlflow));
    let mut config = ConfigState::new();
    config.mlflow_runtime_status = Some(serde_json::json!({
        "state": "ready",
        "last_error": null
    }));
    let lines = render_mlflow_tab(&settings, &config, &ThemeTokens::default());
    let text = lines
        .iter()
        .map(|line| line.to_string())
        .collect::<Vec<_>>()
        .join("\n");
    assert!(text.contains("MLflow Tracing"));
    assert!(text.contains("Tracking URI"));
    assert!(text.contains("Send test trace"));
    assert!(text.contains("ready"));
}

#[test]
fn mlflow_tab_keeps_runtime_status_when_a_test_result_arrives() {
    let mut settings = SettingsState::default();
    settings.reduce(SettingsAction::Open);
    settings.reduce(SettingsAction::SwitchTab(SettingsTab::Mlflow));
    let mut config = ConfigState::new();
    config.mlflow_runtime_status = Some(serde_json::json!({
        "state": "degraded",
        "last_error": "tracking server timeout"
    }));
    config.mlflow_test_result = Some(serde_json::json!({
        "ok": false,
        "error": "connection refused"
    }));
    let text = render_mlflow_tab(&settings, &config, &ThemeTokens::default())
        .iter()
        .map(|line| line.to_string())
        .collect::<Vec<_>>()
        .join("\n");
    assert!(text.contains("degraded"));
    assert!(text.contains("tracking server timeout"));
    assert!(text.contains("connection refused"));
    assert!(!text.contains("unknown"));
}

#[test]
fn mlflow_tab_hit_testing_follows_rendered_field_order() {
    let mut settings = SettingsState::default();
    settings.reduce(SettingsAction::Open);
    settings.reduce(SettingsAction::SwitchTab(SettingsTab::Mlflow));
    let config = ConfigState::new();
    let subagents = SubAgentsState::new();
    let hit = |row| settings_row_hit(&settings, &config, &subagents, row);
    assert_eq!(hit(4), Some((0, None)));
    assert_eq!(hit(5), Some((1, None)));
    assert_eq!(hit(11), Some((7, None)));
    assert_eq!(hit(14), Some((10, None)));
    assert_eq!(hit(15), Some((11, None)));
    assert_eq!(hit(16), Some((12, None)));
}

#[test]
fn mlflow_keyboard_order_matches_rendered_rows() {
    let mut settings = SettingsState::default();
    settings.reduce(SettingsAction::Open);
    settings.reduce(SettingsAction::SwitchTab(SettingsTab::Mlflow));
    let expected = [
        "mlflow_enabled",
        "mlflow_visible_operator",
        "mlflow_gateway",
        "mlflow_goal_task",
        "mlflow_subagent",
        "mlflow_concierge",
        "mlflow_heartbeat_autonomous",
        "mlflow_tracking_uri",
        "mlflow_experiment_name",
        "mlflow_experiment_id",
        "mlflow_capture_mode",
        "mlflow_test_connection",
        "mlflow_send_test_trace",
    ];
    for (index, name) in expected.iter().enumerate() {
        assert_eq!(
            settings.current_field_name(),
            *name,
            "arrow navigation must stop on {name} at index {index}"
        );
        settings.reduce(SettingsAction::NavigateField(1));
    }
}

#[test]
fn mlflow_text_fields_render_the_edit_buffer() {
    let mut settings = SettingsState::default();
    settings.reduce(SettingsAction::Open);
    settings.reduce(SettingsAction::SwitchTab(SettingsTab::Mlflow));
    settings.reduce(SettingsAction::NavigateField(7));
    assert_eq!(settings.current_field_name(), "mlflow_tracking_uri");
    settings.start_editing("mlflow_tracking_uri", "http://mlflow.example:5000");
    let text = render_mlflow_tab(&settings, &ConfigState::new(), &ThemeTokens::default())
        .iter()
        .map(|line| line.to_string())
        .collect::<Vec<_>>()
        .join("\n");
    assert!(
        text.contains("http://mlflow.example:5000"),
        "Enter on Tracking URI must show the editable value, not a static label"
    );
    assert!(
        text.contains('\u{2588}'),
        "inline editing must show a cursor in the Tracking URI row"
    );
}
