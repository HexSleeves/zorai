use super::*;

#[tokio::test]
async fn notes_to_child_cap_at_twenty_and_keep_status_unchanged() {
    let (_root, engine) = setup().await;
    let child = spawn_child(&engine).await;

    for index in 0..22 {
        execute_note_to_child(
            &serde_json::json!({
                "child_task_id": child.id,
                "note": format!("note-{index:02}-{}", "x".repeat(30)),
            }),
            &engine,
            "thread-parent",
            None,
        )
        .await
        .expect("note accepted");
    }

    let notes_key = format!("notes_to_child:{}", child.id);
    let stored: Vec<String> = engine
        .history
        .get_consolidation_state(&notes_key)
        .await
        .expect("notes readable")
        .map(|value| serde_json::from_str(&value).expect("valid JSON array"))
        .unwrap_or_default();
    assert_eq!(stored.len(), 20, "cap of 20 enforced with oldest eviction");
    assert!(stored[0].starts_with("note-02-"), "oldest two evicted");
    assert!(stored.last().expect("non-empty").starts_with("note-21-"));
    assert!(stored.iter().all(|note| note.chars().count() <= 2_000));

    let unchanged = task_by_id_for_tool_scope(&engine, &child.id)
        .await
        .expect("child exists");
    assert_ne!(unchanged.status, TaskStatus::Blocked);
    assert!(unchanged.blocked_reason.is_none());

    let delivered = engine
        .build_parent_child_prompt_context(Some(&child.id))
        .await
        .expect("notes injected into next-turn context");
    assert_eq!(
        delivered.matches("[parent note] ").count(),
        20,
        "all undelivered notes injected once"
    );
    assert!(
        engine
            .build_parent_child_prompt_context(Some(&child.id))
            .await
            .is_none(),
        "notes must be delivered exactly once"
    );
}

#[tokio::test]
async fn long_notes_are_truncated_to_two_thousand_chars() {
    let (_root, engine) = setup().await;
    let child = spawn_child(&engine).await;

    execute_note_to_child(
        &serde_json::json!({
            "child_task_id": child.id,
            "note": "y".repeat(5_000),
        }),
        &engine,
        "thread-parent",
        None,
    )
    .await
    .expect("long note accepted");

    let notes_key = format!("notes_to_child:{}", child.id);
    let stored: Vec<String> = engine
        .history
        .get_consolidation_state(&notes_key)
        .await
        .expect("notes readable")
        .map(|value| serde_json::from_str(&value).expect("valid JSON array"))
        .unwrap_or_default();
    assert_eq!(stored.len(), 1);
    assert_eq!(stored[0].chars().count(), 2_000);
}

#[tokio::test]
async fn notes_added_after_the_cap_are_still_injected() {
    let (_root, engine) = setup().await;
    let child = spawn_child(&engine).await;

    for index in 0..20 {
        execute_note_to_child(
            &serde_json::json!({
                "child_task_id": child.id,
                "note": format!("note-{index:02}"),
            }),
            &engine,
            "thread-parent",
            None,
        )
        .await
        .expect("note accepted");
    }
    engine
        .build_parent_child_prompt_context(Some(&child.id))
        .await
        .expect("initial notes injected");

    execute_note_to_child(
        &serde_json::json!({
            "child_task_id": child.id,
            "note": "note-after-cap",
        }),
        &engine,
        "thread-parent",
        None,
    )
    .await
    .expect("post-cap note accepted");

    let injected = engine
        .build_parent_child_prompt_context(Some(&child.id))
        .await
        .expect("evicted-cap note must still be injectable");
    assert!(
        injected.contains("[parent note] note-after-cap"),
        "new guidance after the cap was dropped, got: {injected}"
    );
}
