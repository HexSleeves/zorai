use super::super::*;
use crate::agent::types::AgentConfig;
use crate::agent::AgentEngine;
use crate::session_manager::SessionManager;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

fn spawn_server(
    responses: Vec<(u16, &'static str, &'static str)>,
) -> (String, Arc<Mutex<Vec<String>>>, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let targets = Arc::new(Mutex::new(Vec::new()));
    let output = Arc::clone(&targets);
    let handle = thread::spawn(move || {
        for (status, content_type, body) in responses {
            let (mut stream, _) = listener.accept().unwrap();
            let mut bytes = Vec::new();
            let mut buffer = [0_u8; 4096];
            loop {
                let count = stream.read(&mut buffer).unwrap();
                if count == 0 {
                    break;
                }
                bytes.extend_from_slice(&buffer[..count]);
                let Some(header_end) = bytes.windows(4).position(|window| window == b"\r\n\r\n")
                else {
                    continue;
                };
                let headers = String::from_utf8_lossy(&bytes[..header_end + 4]);
                let length = headers
                    .lines()
                    .find_map(|line| {
                        line.to_ascii_lowercase()
                            .strip_prefix("content-length:")
                            .map(str::trim)
                            .and_then(|value| value.parse::<usize>().ok())
                    })
                    .unwrap_or(0);
                if bytes.len() >= header_end + 4 + length {
                    break;
                }
            }
            let request = String::from_utf8_lossy(&bytes);
            let target = request
                .lines()
                .next()
                .unwrap()
                .split_whitespace()
                .nth(1)
                .unwrap();
            output.lock().unwrap().push(target.to_string());
            let reason = if status == 200 { "OK" } else { "Error" };
            write!(stream, "HTTP/1.1 {status} {reason}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
        }
    });
    (format!("http://{address}"), targets, handle)
}

async fn engine_with_config(root: &std::path::Path, config: AgentConfig) -> Arc<AgentEngine> {
    AgentEngine::new_test(SessionManager::new_test(root).await, config, root).await
}

#[tokio::test]
async fn disabled_runtime_stays_disabled_without_network_work() {
    let dir = tempfile::tempdir().unwrap();
    let engine = engine_with_config(dir.path(), AgentConfig::default()).await;
    tokio::time::sleep(Duration::from_millis(50)).await;
    let status = engine.mlflow_tracing.status();
    assert_eq!(status.state, MlflowTracingState::Disabled);
    assert!(!status.effective_enabled);
    assert_eq!(status.traces_exported, 0);
}

#[tokio::test]
async fn connection_test_resolves_version_and_explicit_experiment() {
    let (uri, targets, server) = spawn_server(vec![(200, "text/plain", "3.15.1")]);
    let dir = tempfile::tempdir().unwrap();
    let mut config = AgentConfig::default();
    config.mlflow_tracing.enabled = true;
    config.mlflow_tracing.tracking_uri = uri;
    config.mlflow_tracing.experiment_id = Some("7".into());
    let engine = engine_with_config(dir.path(), config).await;
    let info = engine.mlflow_tracing.test_connection().await.unwrap();
    assert_eq!(info.server_version, "3.15.1");
    assert_eq!(info.experiment.experiment_id, "7");
    assert_eq!(
        engine.mlflow_tracing.status().state,
        MlflowTracingState::Ready
    );
    server.join().unwrap();
    assert_eq!(targets.lock().unwrap().as_slice(), ["/version"]);
}

#[tokio::test]
async fn diagnostic_trace_is_explicit_and_reaches_otlp_endpoint() {
    let (uri, targets, server) = spawn_server(vec![
        (200, "text/plain", "3.15.1"),
        (200, "application/json", "{}"),
    ]);
    let dir = tempfile::tempdir().unwrap();
    let mut config = AgentConfig::default();
    config.mlflow_tracing.enabled = true;
    config.mlflow_tracing.tracking_uri = uri;
    config.mlflow_tracing.experiment_id = Some("9".into());
    let engine = engine_with_config(dir.path(), config).await;
    let info = engine.mlflow_tracing.send_diagnostic_trace().await.unwrap();
    assert_eq!(info.experiment.experiment_id, "9");
    assert_eq!(engine.mlflow_tracing.status().traces_exported, 1);
    server.join().unwrap();
    assert_eq!(
        targets.lock().unwrap().as_slice(),
        ["/version", "/v1/traces"]
    );
}

#[tokio::test]
async fn unreachable_endpoint_degrades_without_panicking() {
    let dir = tempfile::tempdir().unwrap();
    let mut config = AgentConfig::default();
    config.mlflow_tracing.enabled = true;
    config.mlflow_tracing.tracking_uri = "http://127.0.0.1:9".into();
    config.mlflow_tracing.request_timeout_ms = 500;
    let engine = engine_with_config(dir.path(), config).await;
    let result = engine.mlflow_tracing.test_connection().await;
    assert!(result.is_err());
    let status = engine.mlflow_tracing.status();
    assert_eq!(status.state, MlflowTracingState::Degraded);
    assert!(status.last_error.is_some());
}

#[tokio::test]
async fn header_refresh_and_shutdown_commands_are_bounded() {
    let dir = tempfile::tempdir().unwrap();
    let engine = engine_with_config(dir.path(), AgentConfig::default()).await;
    let _status_rx = engine.mlflow_tracing.subscribe_status();
    engine
        .mlflow_tracing
        .header_store()
        .set("X-Test", "safe")
        .unwrap();
    engine.mlflow_tracing.refresh_headers().await;
    engine.mlflow_tracing.shutdown().await;
    let result = tokio::time::timeout(
        Duration::from_millis(250),
        engine.mlflow_tracing.test_connection(),
    )
    .await;
    assert!(result.is_ok());
    assert!(result.unwrap().is_err());
}
