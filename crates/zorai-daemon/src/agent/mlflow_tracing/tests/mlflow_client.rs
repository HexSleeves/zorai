use super::super::*;
use reqwest::header::HeaderMap;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::{Arc, Mutex};
use std::thread;

struct RequestRecord {
    method: String,
    target: String,
    headers: String,
    body: Vec<u8>,
}

fn spawn_server(
    responses: Vec<(u16, &'static str, &'static str)>,
) -> (
    String,
    Arc<Mutex<Vec<RequestRecord>>>,
    thread::JoinHandle<()>,
) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let records = Arc::new(Mutex::new(Vec::new()));
    let output = Arc::clone(&records);
    let handle = thread::spawn(move || {
        for (status, content_type, response_body) in responses {
            let (mut stream, _) = listener.accept().unwrap();
            let mut bytes = Vec::new();
            let mut buffer = [0_u8; 4096];
            loop {
                let count = stream.read(&mut buffer).unwrap();
                if count == 0 {
                    break;
                }
                bytes.extend_from_slice(&buffer[..count]);
                let header_end = bytes.windows(4).position(|window| window == b"\r\n\r\n");
                if let Some(header_end) = header_end {
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
            }
            let header_end = bytes
                .windows(4)
                .position(|window| window == b"\r\n\r\n")
                .unwrap();
            let headers = String::from_utf8_lossy(&bytes[..header_end]).to_string();
            let request_line = headers.lines().next().unwrap();
            let mut request_parts = request_line.split_whitespace();
            output.lock().unwrap().push(RequestRecord {
                method: request_parts.next().unwrap().into(),
                target: request_parts.next().unwrap().into(),
                headers,
                body: bytes[header_end + 4..].to_vec(),
            });
            let reason = if status == 200 {
                "OK"
            } else if status == 404 {
                "Not Found"
            } else {
                "Error"
            };
            write!(stream, "HTTP/1.1 {status} {reason}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{response_body}", response_body.len()).unwrap();
        }
    });
    (format!("http://{address}"), records, handle)
}

fn effective(uri: String, experiment_id: Option<String>) -> MlflowTracingEffectiveConfig {
    let config = MlflowTracingConfig {
        tracking_uri: uri,
        experiment_id,
        ..Default::default()
    };
    MlflowTracingEffectiveConfig::resolve(&config).unwrap()
}

#[tokio::test]
async fn connection_checks_version_and_creates_missing_experiment() {
    let (uri, records, server) = spawn_server(vec![
        (200, "text/plain", "3.15.1"),
        (
            404,
            "application/json",
            r#"{"error_code":"RESOURCE_DOES_NOT_EXIST"}"#,
        ),
        (200, "application/json", r#"{"experiment_id":"42"}"#),
    ]);
    let client = MlflowClient::new(&effective(uri, None), HeaderMap::new()).unwrap();
    let info = client.test_connection().await.unwrap();
    assert_eq!(info.server_version, "3.15.1");
    assert_eq!(info.experiment.experiment_id, "42");
    server.join().unwrap();
    let records = records.lock().unwrap();
    assert_eq!(records[0].target, "/version");
    assert!(records[1]
        .target
        .starts_with("/api/2.0/mlflow/experiments/get-by-name?"));
    assert_eq!(records[2].method, "POST");
    assert!(String::from_utf8_lossy(&records[2].body).contains("zorai-conversations"));
}

#[tokio::test]
async fn old_server_version_is_a_permanent_error() {
    let (uri, _, server) = spawn_server(vec![(200, "text/plain", "3.5.9")]);
    let client = MlflowClient::new(&effective(uri, Some("1".into())), HeaderMap::new()).unwrap();
    let error = client.test_connection().await.unwrap_err();
    assert_eq!(error.kind, MlflowErrorKind::Permanent);
    assert!(error.to_string().contains("3.6.0"));
    server.join().unwrap();
}

#[tokio::test]
async fn explicit_experiment_id_bypasses_experiment_lookup() {
    let (uri, records, server) = spawn_server(vec![(200, "text/plain", "3.15.1")]);
    let client = MlflowClient::new(&effective(uri, Some("7".into())), HeaderMap::new()).unwrap();
    let info = client.test_connection().await.unwrap();
    assert_eq!(info.experiment.experiment_id, "7");
    server.join().unwrap();
    assert_eq!(records.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn otlp_export_sets_required_headers_and_binary_body() {
    let (uri, records, server) = spawn_server(vec![(200, "application/json", "{}")]);
    let client = MlflowClient::new(&effective(uri, Some("7".into())), HeaderMap::new()).unwrap();
    client.export_otlp("7", vec![1, 2, 3]).await.unwrap();
    server.join().unwrap();
    let records = records.lock().unwrap();
    assert_eq!(records[0].target, "/v1/traces");
    assert!(records[0]
        .headers
        .to_ascii_lowercase()
        .contains("content-type: application/x-protobuf"));
    assert!(records[0]
        .headers
        .to_ascii_lowercase()
        .contains("x-mlflow-experiment-id: 7"));
    assert_eq!(records[0].body, vec![1, 2, 3]);
}

#[tokio::test]
async fn server_errors_are_transient_and_client_errors_are_permanent() {
    let (uri, _, server) = spawn_server(vec![(500, "text/plain", "Bearer secret")]);
    let client = MlflowClient::new(&effective(uri, Some("7".into())), HeaderMap::new()).unwrap();
    let error = client.export_otlp("7", vec![]).await.unwrap_err();
    assert_eq!(error.kind, MlflowErrorKind::Transient);
    assert!(!error.to_string().contains("secret"));
    server.join().unwrap();
}

#[test]
fn custom_header_parser_rejects_control_characters() {
    assert!(parse_custom_headers(&[("X-Test".into(), "safe".into())]).is_ok());
    assert!(parse_custom_headers(&[("Bad Header".into(), "safe".into())]).is_err());
    assert!(parse_custom_headers(&[("X-Test".into(), "unsafe\nvalue".into())]).is_err());
}
