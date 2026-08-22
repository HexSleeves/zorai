use super::{CapturedValue, MlflowCaptureMode, MlflowContentKind};
use serde_json::Value;

const REDACTED: &str = "***REDACTED***";
const BINARY_OMITTED: &str = "[binary payload omitted]";

pub fn capture_text(
    text: &str,
    mode: MlflowCaptureMode,
    kind: MlflowContentKind,
    max_chars: usize,
) -> Option<CapturedValue> {
    if mode == MlflowCaptureMode::Metadata {
        return None;
    }
    if kind == MlflowContentKind::Reasoning && mode != MlflowCaptureMode::Full {
        return None;
    }
    let original_chars = text.chars().count();
    let scrubbed = crate::scrub::scrub_sensitive(text);
    let (without_binary, binary_redacted) = strip_binary_text(&scrubbed);
    let (value, truncated) = truncate_chars(&without_binary, max_chars);
    Some(CapturedValue {
        redacted: binary_redacted || value != text,
        truncated,
        original_chars,
        value,
    })
}

pub fn capture_tool_value(
    text: &str,
    mode: MlflowCaptureMode,
    kind: MlflowContentKind,
    max_chars: usize,
) -> Option<CapturedValue> {
    if mode == MlflowCaptureMode::Metadata {
        return None;
    }
    let original_chars = text.chars().count();
    let mut redacted = false;
    let normalized = match serde_json::from_str::<Value>(text) {
        Ok(mut value) => {
            scrub_json_value(&mut value, None, &mut redacted);
            serde_json::to_string(&value).unwrap_or_else(|_| REDACTED.to_string())
        }
        Err(_) => {
            let captured = capture_text(text, mode, kind, max_chars)?;
            return Some(captured);
        }
    };
    let scrubbed = crate::scrub::scrub_sensitive(&normalized);
    redacted |= scrubbed != normalized || scrubbed != text;
    let (value, truncated) = truncate_chars(&scrubbed, max_chars);
    Some(CapturedValue {
        value,
        redacted,
        truncated,
        original_chars,
    })
}

fn scrub_json_value(value: &mut Value, key: Option<&str>, redacted: &mut bool) {
    if key.is_some_and(is_sensitive_key) {
        *value = Value::String(REDACTED.to_string());
        *redacted = true;
        return;
    }
    match value {
        Value::Object(map) => {
            for (child_key, child) in map.iter_mut() {
                scrub_json_value(child, Some(child_key), redacted);
            }
        }
        Value::Array(items) => {
            for child in items {
                scrub_json_value(child, None, redacted);
            }
        }
        Value::String(text) => {
            if looks_like_binary(text) {
                *text = BINARY_OMITTED.to_string();
                *redacted = true;
            } else {
                let scrubbed = crate::scrub::scrub_sensitive(text);
                if scrubbed != *text {
                    *text = scrubbed;
                    *redacted = true;
                }
            }
        }
        _ => {}
    }
}

fn is_sensitive_key(key: &str) -> bool {
    let normalized = key
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect::<String>();
    matches!(
        normalized.as_str(),
        "authorization"
            | "cookie"
            | "setcookie"
            | "apikey"
            | "token"
            | "accesstoken"
            | "refreshtoken"
            | "secret"
            | "password"
            | "passwd"
            | "privatekey"
    )
}

fn strip_binary_text(text: &str) -> (String, bool) {
    if looks_like_binary(text) {
        (BINARY_OMITTED.to_string(), true)
    } else {
        (text.to_string(), false)
    }
}

fn looks_like_binary(value: &str) -> bool {
    let trimmed = value.trim();
    if trimmed.starts_with("data:") && trimmed.contains(";base64,") {
        return true;
    }
    trimmed.len() >= 512
        && trimmed.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/' | b'=' | b'\r' | b'\n')
        })
}

fn truncate_chars(value: &str, max_chars: usize) -> (String, bool) {
    let count = value.chars().count();
    if count <= max_chars {
        return (value.to_string(), false);
    }
    let mut output = value.chars().take(max_chars).collect::<String>();
    output.push_str("…[truncated]");
    (output, true)
}
