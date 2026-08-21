use super::*;
use crate::state::settings::{SettingsAction, SettingsState, SettingsTab};
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
