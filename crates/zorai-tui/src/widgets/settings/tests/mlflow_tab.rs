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
    assert_eq!(hit(5), Some((5, None)));
    assert_eq!(hit(11), Some((1, None)));
    assert_eq!(hit(14), Some((4, None)));
    assert_eq!(hit(15), Some((11, None)));
    assert_eq!(hit(16), Some((12, None)));
}
