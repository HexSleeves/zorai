use super::super::export_diagnostic_to_uri;

#[tokio::test]
#[ignore = "requires ZORAI_TEST_MLFLOW_URI and a running MLflow 3.6+ server"]
async fn exports_content_free_diagnostic_to_real_mlflow() {
    let Ok(uri) = std::env::var("ZORAI_TEST_MLFLOW_URI") else {
        eprintln!("ZORAI_TEST_MLFLOW_URI is unset; skipping real MLflow integration");
        return;
    };
    let experiment_name = format!("zorai-integration-{}", uuid::Uuid::new_v4());
    let info = export_diagnostic_to_uri(uri, experiment_name.clone())
        .await
        .expect("diagnostic trace should export to real MLflow");
    assert_eq!(info.server_version, "3.15.1");
    assert_eq!(info.experiment.name, experiment_name);
    assert!(!info.experiment.experiment_id.is_empty());
}
