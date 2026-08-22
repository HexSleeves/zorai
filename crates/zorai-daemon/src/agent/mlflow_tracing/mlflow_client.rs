use super::MlflowTracingEffectiveConfig;
use anyhow::{Context, Result};
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, CONTENT_TYPE, RETRY_AFTER};
use semver::Version;
use serde::{Deserialize, Serialize};
use std::time::Duration;

const MINIMUM_MLFLOW_OTLP_VERSION: &str = "3.6.0";
const MAX_ERROR_BODY_BYTES: usize = 4096;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MlflowExperiment {
    pub experiment_id: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MlflowConnectionInfo {
    pub server_version: String,
    pub experiment: MlflowExperiment,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MlflowErrorKind {
    Permanent,
    Transient,
}

#[derive(Debug, thiserror::Error)]
#[error("{message}")]
pub struct MlflowClientError {
    pub kind: MlflowErrorKind,
    pub message: String,
    pub retry_after: Option<Duration>,
}

impl MlflowClientError {
    fn permanent(message: impl Into<String>) -> Self {
        Self {
            kind: MlflowErrorKind::Permanent,
            message: message.into(),
            retry_after: None,
        }
    }

    fn transient(message: impl Into<String>, retry_after: Option<Duration>) -> Self {
        Self {
            kind: MlflowErrorKind::Transient,
            message: message.into(),
            retry_after,
        }
    }
}

#[derive(Clone)]
pub struct MlflowClient {
    http: reqwest::Client,
    tracking_uri: String,
    experiment_name: String,
    experiment_id: Option<String>,
    custom_headers: HeaderMap,
}

impl MlflowClient {
    pub fn new(config: &MlflowTracingEffectiveConfig, custom_headers: HeaderMap) -> Result<Self> {
        let http = reqwest::Client::builder()
            .connect_timeout(Duration::from_millis(config.configured.request_timeout_ms))
            .timeout(Duration::from_millis(config.configured.request_timeout_ms))
            .build()
            .context("failed to build MLflow HTTP client")?;
        Ok(Self {
            http,
            tracking_uri: config.tracking_uri.clone(),
            experiment_name: config.experiment_name.clone(),
            experiment_id: config.experiment_id.clone(),
            custom_headers,
        })
    }

    pub async fn test_connection(&self) -> Result<MlflowConnectionInfo, MlflowClientError> {
        let server_version = self.server_version().await?;
        let experiment = self.resolve_experiment().await?;
        Ok(MlflowConnectionInfo {
            server_version,
            experiment,
        })
    }

    pub async fn server_version(&self) -> Result<String, MlflowClientError> {
        let response = self
            .request(reqwest::Method::GET, "/version")?
            .send()
            .await
            .map_err(map_reqwest_error)?;
        let status = response.status();
        let body = read_capped_body(response).await?;
        if !status.is_success() {
            return Err(classify_status(status, &body, None));
        }
        let rendered = body.trim();
        let version = Version::parse(rendered).map_err(|_| {
            MlflowClientError::permanent(format!(
                "MLflow returned an invalid version string: {}",
                safe_excerpt(rendered)
            ))
        })?;
        let minimum = Version::parse(MINIMUM_MLFLOW_OTLP_VERSION)
            .expect("minimum MLflow version must be valid");
        if version < minimum {
            return Err(MlflowClientError::permanent(format!(
                "MLflow {version} does not support OTLP ingestion; version {minimum} or newer is required"
            )));
        }
        Ok(version.to_string())
    }

    pub async fn resolve_experiment(&self) -> Result<MlflowExperiment, MlflowClientError> {
        if let Some(experiment_id) = self.experiment_id.as_deref() {
            return Ok(MlflowExperiment {
                experiment_id: experiment_id.to_string(),
                name: self.experiment_name.clone(),
            });
        }
        if let Some(experiment) = self.find_experiment().await? {
            return Ok(experiment);
        }
        match self.create_experiment().await {
            Ok(experiment) => Ok(experiment),
            Err(error) if error.kind == MlflowErrorKind::Permanent => {
                self.find_experiment().await?.ok_or(error)
            }
            Err(error) => Err(error),
        }
    }

    pub async fn export_otlp(
        &self,
        experiment_id: &str,
        body: Vec<u8>,
    ) -> Result<(), MlflowClientError> {
        let mut request = self.request(reqwest::Method::POST, "/v1/traces")?;
        request = request
            .header(CONTENT_TYPE, "application/x-protobuf")
            .header("x-mlflow-experiment-id", experiment_id)
            .body(body);
        let response = request.send().await.map_err(map_reqwest_error)?;
        if response.status().is_success() {
            return Ok(());
        }
        let status = response.status();
        let retry_after = parse_retry_after(response.headers());
        let body = read_capped_body(response).await?;
        Err(classify_status(status, &body, retry_after))
    }

    async fn find_experiment(&self) -> Result<Option<MlflowExperiment>, MlflowClientError> {
        let mut url = reqwest::Url::parse(&format!(
            "{}/api/2.0/mlflow/experiments/get-by-name",
            self.tracking_uri
        ))
        .map_err(|error| MlflowClientError::permanent(format!("invalid MLflow URL: {error}")))?;
        url.query_pairs_mut()
            .append_pair("experiment_name", &self.experiment_name);
        let response = self
            .request_url(reqwest::Method::GET, url)?
            .send()
            .await
            .map_err(map_reqwest_error)?;
        let status = response.status();
        let body = read_capped_body(response).await?;
        if status == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !status.is_success() {
            if body.contains("RESOURCE_DOES_NOT_EXIST") {
                return Ok(None);
            }
            return Err(classify_status(status, &body, None));
        }
        #[derive(Deserialize)]
        struct Response {
            experiment: Experiment,
        }
        #[derive(Deserialize)]
        struct Experiment {
            experiment_id: String,
            name: String,
        }
        let parsed: Response = serde_json::from_str(&body).map_err(|error| {
            MlflowClientError::permanent(format!("invalid MLflow experiment response: {error}"))
        })?;
        Ok(Some(MlflowExperiment {
            experiment_id: parsed.experiment.experiment_id,
            name: parsed.experiment.name,
        }))
    }

    async fn create_experiment(&self) -> Result<MlflowExperiment, MlflowClientError> {
        let response = self
            .request(reqwest::Method::POST, "/api/2.0/mlflow/experiments/create")?
            .json(&serde_json::json!({ "name": self.experiment_name }))
            .send()
            .await
            .map_err(map_reqwest_error)?;
        let status = response.status();
        let retry_after = parse_retry_after(response.headers());
        let body = read_capped_body(response).await?;
        if !status.is_success() {
            return Err(classify_status(status, &body, retry_after));
        }
        #[derive(Deserialize)]
        struct Response {
            experiment_id: String,
        }
        let parsed: Response = serde_json::from_str(&body).map_err(|error| {
            MlflowClientError::permanent(format!(
                "invalid MLflow experiment creation response: {error}"
            ))
        })?;
        Ok(MlflowExperiment {
            experiment_id: parsed.experiment_id,
            name: self.experiment_name.clone(),
        })
    }

    fn request(
        &self,
        method: reqwest::Method,
        path: &str,
    ) -> Result<reqwest::RequestBuilder, MlflowClientError> {
        let url =
            reqwest::Url::parse(&format!("{}{}", self.tracking_uri, path)).map_err(|error| {
                MlflowClientError::permanent(format!("invalid MLflow URL: {error}"))
            })?;
        self.request_url(method, url)
    }

    fn request_url(
        &self,
        method: reqwest::Method,
        url: reqwest::Url,
    ) -> Result<reqwest::RequestBuilder, MlflowClientError> {
        let mut request = self.http.request(method, url);
        for (name, value) in &self.custom_headers {
            request = request.header(name, value);
        }
        Ok(request)
    }
}

pub fn parse_custom_headers(values: &[(String, String)]) -> Result<HeaderMap> {
    let mut headers = HeaderMap::new();
    for (name, value) in values {
        let name = HeaderName::from_bytes(name.as_bytes())
            .with_context(|| format!("invalid custom header name '{name}'"))?;
        let value = HeaderValue::from_str(value)
            .with_context(|| format!("invalid value for custom header '{name}'"))?;
        headers.insert(name, value);
    }
    Ok(headers)
}

fn map_reqwest_error(error: reqwest::Error) -> MlflowClientError {
    MlflowClientError::transient(
        if error.is_timeout() {
            "MLflow request timed out".to_string()
        } else {
            format!(
                "MLflow request failed: {}",
                safe_excerpt(&error.to_string())
            )
        },
        None,
    )
}

fn classify_status(
    status: reqwest::StatusCode,
    body: &str,
    retry_after: Option<Duration>,
) -> MlflowClientError {
    let message = format!(
        "MLflow returned HTTP {}: {}",
        status.as_u16(),
        safe_excerpt(body)
    );
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS || status.is_server_error() {
        MlflowClientError::transient(message, retry_after)
    } else {
        MlflowClientError::permanent(message)
    }
}

async fn read_capped_body(response: reqwest::Response) -> Result<String, MlflowClientError> {
    let bytes = response.bytes().await.map_err(map_reqwest_error)?;
    let end = bytes.len().min(MAX_ERROR_BODY_BYTES);
    Ok(crate::scrub::scrub_sensitive(&String::from_utf8_lossy(
        &bytes[..end],
    )))
}

fn parse_retry_after(headers: &HeaderMap) -> Option<Duration> {
    let seconds = headers
        .get(RETRY_AFTER)?
        .to_str()
        .ok()?
        .parse::<u64>()
        .ok()?;
    Some(Duration::from_secs(seconds.min(300)))
}

fn safe_excerpt(value: &str) -> String {
    crate::scrub::scrub_sensitive(value)
        .chars()
        .take(512)
        .collect::<String>()
}
