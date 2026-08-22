use super::super::*;
use crate::agent::types::AgentConfig;

#[test]
fn mlflow_tracing_defaults_are_safe_and_disabled() {
    let config: AgentConfig = serde_json::from_str("{}").unwrap();
    assert!(!config.mlflow_tracing.enabled);
    assert_eq!(config.mlflow_tracing.tracking_uri, "http://127.0.0.1:5000");
    assert_eq!(config.mlflow_tracing.experiment_name, "zorai-conversations");
    assert_eq!(
        config.mlflow_tracing.capture_mode,
        MlflowCaptureMode::Guarded
    );
    assert!(config.mlflow_tracing.scopes.visible_operator);
    assert!(!config.mlflow_tracing.scopes.heartbeat_autonomous);
}

#[test]
fn environment_overrides_report_provenance() {
    let _guard = crate::test_support::env_test_lock();
    std::env::set_var("ZORAI_MLFLOW_TRACKING_URI", "http://127.0.0.1:5050/");
    std::env::set_var("ZORAI_MLFLOW_CAPTURE_MODE", "metadata");
    let effective = MlflowTracingEffectiveConfig::resolve(&MlflowTracingConfig::default()).unwrap();
    assert_eq!(effective.tracking_uri, "http://127.0.0.1:5050");
    assert_eq!(effective.capture_mode, MlflowCaptureMode::Metadata);
    assert!(effective.overrides.contains_key("tracking_uri"));
    std::env::remove_var("ZORAI_MLFLOW_TRACKING_URI");
    std::env::remove_var("ZORAI_MLFLOW_CAPTURE_MODE");
}

#[test]
fn invalid_tracking_uri_is_rejected() {
    let _guard = crate::test_support::env_test_lock();
    std::env::remove_var("ZORAI_MLFLOW_TRACKING_URI");
    let config = MlflowTracingConfig {
        tracking_uri: "file:///tmp/mlruns".into(),
        ..Default::default()
    };
    assert!(MlflowTracingEffectiveConfig::resolve(&config).is_err());
}
