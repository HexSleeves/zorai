mod assembler;
mod config;
mod enrichment;
mod mlflow_client;
mod otlp;
mod privacy;
mod secrets;
mod turn_anchors;
#[allow(dead_code)]
mod types;

mod worker;

pub(crate) use assembler::*;
pub(crate) use config::*;
pub(crate) use enrichment::*;
pub(crate) use mlflow_client::*;
pub(crate) use otlp::*;
pub(crate) use privacy::*;
pub(crate) use secrets::*;
pub(crate) use turn_anchors::MlflowTurnAnchor;
#[allow(unused_imports)]
pub(crate) use types::*;
pub(crate) use worker::*;

#[cfg(test)]
mod tests;

#[cfg(test)]
pub(crate) async fn export_diagnostic_to_uri(
    tracking_uri: String,
    experiment_name: String,
) -> anyhow::Result<MlflowConnectionInfo> {
    let configured = MlflowTracingConfig {
        enabled: true,
        tracking_uri,
        experiment_name,
        ..Default::default()
    };
    let effective = MlflowTracingEffectiveConfig::resolve(&configured)?;
    let client = MlflowClient::new(&effective, reqwest::header::HeaderMap::new())?;
    let info = client.test_connection().await?;
    let body = encode_otlp_batch(&[worker::diagnostic_trace()])?;
    client
        .export_otlp(&info.experiment.experiment_id, body)
        .await?;
    Ok(info)
}
