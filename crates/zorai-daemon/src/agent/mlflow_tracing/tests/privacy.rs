use super::super::*;

#[test]
fn guarded_tool_json_scrubs_nested_secrets_and_binary_data() {
    let value = serde_json::json!({
        "url": "https://example.test",
        "authorization": "Bearer secret-token",
        "nested": {"api_key": "sk-secret", "ok": 7},
        "image": "data:image/png;base64,AAAA"
    });
    let captured = capture_tool_value(
        &value.to_string(),
        MlflowCaptureMode::Guarded,
        MlflowContentKind::ToolArguments,
        512,
    )
    .unwrap();
    assert!(!captured.value.contains("secret-token"));
    assert!(!captured.value.contains("sk-secret"));
    assert!(!captured.value.contains("AAAA"));
    assert!(captured.value.contains("binary payload omitted"));
    assert!(captured.redacted);
}

#[test]
fn metadata_mode_omits_all_content() {
    assert!(capture_text(
        "hello",
        MlflowCaptureMode::Metadata,
        MlflowContentKind::User,
        32,
    )
    .is_none());
    assert!(capture_tool_value(
        "{\"ok\":true}",
        MlflowCaptureMode::Metadata,
        MlflowContentKind::ToolResult,
        32,
    )
    .is_none());
}

#[test]
fn guarded_omits_reasoning_but_full_keeps_scrubbed_reasoning() {
    assert!(capture_text(
        "private reasoning",
        MlflowCaptureMode::Guarded,
        MlflowContentKind::Reasoning,
        64,
    )
    .is_none());
    let full = capture_text(
        "Authorization: Bearer abc",
        MlflowCaptureMode::Full,
        MlflowContentKind::Reasoning,
        100,
    )
    .unwrap();
    assert_eq!(full.value, "Authorization: Bearer ***REDACTED***");
}

#[test]
fn capture_truncates_by_characters_not_bytes() {
    let captured = capture_text(
        "żółw",
        MlflowCaptureMode::Guarded,
        MlflowContentKind::Assistant,
        2,
    )
    .unwrap();
    assert!(captured.value.starts_with("żó"));
    assert!(captured.truncated);
    assert_eq!(captured.original_chars, 4);
}

#[test]
fn relationship_scope_uses_specific_precedence() {
    let relationships = MlflowTraceRelationships {
        thread_id: "child".into(),
        client_surface: Some("gateway".into()),
        task_id: Some("task".into()),
        parent_task_id: Some("parent".into()),
        goal_run_id: Some("goal".into()),
        ..Default::default()
    };
    assert_eq!(
        relationships.classify_scope(false),
        MlflowTraceScope::Subagent
    );
}

#[test]
fn tui_debug_surface_is_visible_operator_not_gateway() {
    let relationships = MlflowTraceRelationships {
        thread_id: "t".into(),
        client_surface: Some("tui".into()),
        ..Default::default()
    };
    assert_eq!(
        relationships.classify_scope(false),
        MlflowTraceScope::VisibleOperator
    );
}

#[test]
fn gateway_surface_is_exported_when_gateway_scope_is_enabled() {
    let relationships = MlflowTraceRelationships {
        thread_id: "slack-thread".into(),
        client_surface: Some("gateway".into()),
        ..Default::default()
    };
    assert_eq!(
        relationships.classify_scope(false),
        MlflowTraceScope::Gateway
    );
    assert!(scope_enabled(
        MlflowTraceScope::Gateway,
        &MlflowTracingScopes::default()
    ));
}

#[test]
fn missing_surface_without_task_is_unknown_and_dropped() {
    let relationships = MlflowTraceRelationships {
        thread_id: "unlabeled".into(),
        ..Default::default()
    };
    assert_eq!(
        relationships.classify_scope(false),
        MlflowTraceScope::Unknown
    );
    assert!(!scope_enabled(
        MlflowTraceScope::Unknown,
        &MlflowTracingScopes::default()
    ));
}

#[test]
fn gateway_binding_or_title_labels_surface_as_gateway() {
    assert_eq!(
        resolved_client_surface(None, true, "Daily notes"),
        Some("gateway".into())
    );
    assert_eq!(
        resolved_client_surface(None, false, "Slack alice"),
        Some("gateway".into())
    );
    assert_eq!(
        resolved_client_surface(None, false, "Discord bob"),
        Some("gateway".into())
    );
    assert_eq!(
        resolved_client_surface(
            Some(zorai_protocol::ClientSurface::Tui),
            false,
            "Daily notes"
        ),
        Some("tui".into())
    );
}
