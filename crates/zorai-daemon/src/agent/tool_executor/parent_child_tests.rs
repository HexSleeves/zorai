use super::*;
use crate::agent::types::AgentConfig;
use crate::session_manager::SessionManager;
use std::sync::Arc;
use tempfile::tempdir;

async fn setup() -> (tempfile::TempDir, Arc<AgentEngine>) {
    let root = tempdir().expect("tempdir");
    let manager = SessionManager::new_test(root.path()).await;
    let engine = AgentEngine::new_test(manager, AgentConfig::default(), root.path()).await;
    (root, engine)
}

async fn spawn_child(engine: &AgentEngine) -> AgentTask {
    let parent = engine
        .enqueue_task(
            "Parent".into(),
            "coordination".into(),
            "normal",
            None,
            None,
            Vec::new(),
            None,
            "user",
            None,
            None,
            Some("thread-parent".into()),
            None,
        )
        .await;
    let mut child = engine
        .enqueue_task(
            "Child".into(),
            "work".into(),
            "normal",
            None,
            None,
            Vec::new(),
            None,
            "subagent",
            None,
            Some(parent.id.clone()),
            Some("thread-parent".into()),
            None,
        )
        .await;
    child.thread_id = Some("thread-child".into());
    persist_task_update(engine, &child, None)
        .await
        .expect("persist child");
    child
}

fn ask_args(question: &str) -> serde_json::Value {
    serde_json::json!({ "question": question })
}

#[tokio::test]
async fn ask_parent_rejects_task_without_parent_and_leaves_task_unchanged() {
    let (_root, engine) = setup().await;
    let mut orphan = engine
        .enqueue_task(
            "Orphan".into(),
            "no parent here".into(),
            "normal",
            None,
            None,
            Vec::new(),
            None,
            "subagent",
            None,
            None,
            None,
            None,
        )
        .await;
    orphan.thread_id = Some("thread-orphan".into());
    persist_task_update(&engine, &orphan, None)
        .await
        .expect("persist orphan");

    let error = execute_ask_parent(
        &ask_args("Which schema should I target?"),
        &engine,
        "thread-orphan",
        Some(&orphan.id),
    )
    .await
    .expect_err("orphan ask_parent must be rejected");
    assert!(
        error.to_string().contains("no parent_task_id"),
        "actionable error expected, got: {error}"
    );
    let stored = task_by_id_for_tool_scope(&engine, &orphan.id)
        .await
        .expect("orphan still exists");
    assert_eq!(stored.status, TaskStatus::Queued, "task must be unchanged");
    let records = list_ask_records(&engine, &orphan.id).await.expect("no records read failure");
    assert!(records.is_empty(), "no ask record may be written");
}

#[tokio::test]
async fn ask_parent_blocks_and_answers_unblock_with_verbatim_context_injection() {
    let (_root, engine) = setup().await;
    let child = spawn_child(&engine).await;

    let result = execute_ask_parent(
        &ask_args("Should I use plan A or plan B?"),
        &engine,
        "thread-child",
        Some(&child.id),
    )
    .await
    .expect("ask_parent succeeds for a parented child");

    assert!(result.contains("\"open\""));
    let blocked = task_by_id_for_tool_scope(&engine, &child.id)
        .await
        .expect("child exists");
    assert_eq!(blocked.status, TaskStatus::Blocked);
    assert_eq!(
        blocked.blocked_reason.as_deref(),
        Some("awaiting parent: Should I use plan A or plan B?")
    );
    let open: Vec<_> = list_ask_records(&engine, &child.id)
        .await
        .expect("records readable")
        .into_iter()
        .filter(|(_, record)| record.state == "open")
        .collect();
    assert_eq!(open.len(), 1, "one open ask recorded");
    assert!(blocked
        .logs
        .iter()
        .any(|log| log.phase == "parent_child_messaging"));

    // Non-parent callers must be rejected.
    let forbidden = execute_answer_child(
        &serde_json::json!({ "child_task_id": child.id, "answer": "plan B" }),
        &engine,
        "thread-someone-else",
        None,
    )
    .await
    .expect_err("non-parent answer must be rejected");
    assert!(forbidden.to_string().contains("only the child's parent"));

    // Parent thread answers.
    execute_answer_child(
        &serde_json::json!({ "child_task_id": child.id, "answer": "Use plan B." }),
        &engine,
        "thread-parent",
        None,
    )
    .await
    .expect("parent answers successfully");

    let unblocked = task_by_id_for_tool_scope(&engine, &child.id)
        .await
        .expect("child exists");
    assert_ne!(
        unblocked.status,
        TaskStatus::Blocked,
        "child must be unblocked"
    );
    assert!(unblocked.blocked_reason.is_none());
    let (_, answered) = list_ask_records(&engine, &child.id)
        .await
        .expect("records readable")
        .into_iter()
        .next()
        .expect("record still present");
    assert_eq!(answered.state, "answered");
    assert_eq!(answered.answer.as_deref(), Some("Use plan B."));

    let injected = engine
        .build_parent_child_prompt_context(Some(&child.id))
        .await
        .expect("answer block injected into next-turn context");
    assert!(
        injected.contains("[parent answer] Use plan B."),
        "verbatim answer expected, got: {injected}"
    );
    let replayed = engine.build_parent_child_prompt_context(Some(&child.id)).await;
    assert!(replayed.is_none(), "answer must be delivered exactly once");
}

#[tokio::test]
async fn sixth_open_ask_is_rejected_with_batching_guidance() {
    let (_root, engine) = setup().await;
    let child = spawn_child(&engine).await;

    for index in 0..5 {
        execute_ask_parent(
            &ask_args(&format!("Question number {index}?")),
            &engine,
            "thread-child",
            Some(&child.id),
        )
        .await
        .expect("first five asks are accepted");
    }
    let error = execute_ask_parent(
        &ask_args("One question too many?"),
        &engine,
        "thread-child",
        Some(&child.id),
    )
    .await
    .expect_err("sixth concurrent open ask must be rejected");
    let message = error.to_string();
    assert!(
        message.contains("batch"),
        "batching guidance expected, got: {message}"
    );
}

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
async fn timeout_sweep_defaults_and_unanswers_without_failing_the_child() {
    let (_root, engine) = setup().await;
    let with_default = spawn_child(&engine).await;
    let without_default = spawn_child(&engine).await;

    let now = now_millis();
    let seed = |task_id: &str, default: Option<&str>| AskParentRecord {
        question: "Which endpoint?".to_string(),
        options: Vec::new(),
        asked_at: now.saturating_sub(10 * 60_000),
        timeout_minutes: 1,
        default: default.map(ToOwned::to_owned),
        state: "open".to_string(),
        answer: None,
        answer_delivered: false,
    };
    let defaulted_key = format!("ask_parent:{}:seed-defaulted", with_default.id);
    let unanswered_key = format!("ask_parent:{}:seed-unanswered", without_default.id);
    engine
        .history
        .set_consolidation_state(
            &defaulted_key,
            &serde_json::to_string(&seed(&with_default.id, Some("POST /v2"))).unwrap(),
            now,
        )
        .await
        .expect("seed defaulted ask");
    engine
        .history
        .set_consolidation_state(
            &unanswered_key,
            &serde_json::to_string(&seed(&without_default.id, None)).unwrap(),
            now,
        )
        .await
        .expect("seed unanswered ask");
    // Block both children as if they had called ask_parent.
    for target in [&with_default, &without_default] {
        let mut blocked = task_by_id_for_tool_scope(&engine, &target.id)
            .await
            .expect("child exists");
        blocked.status = TaskStatus::Blocked;
        blocked.blocked_reason =
            Some(format!("{} Which endpoint?", AWAITING_PARENT_BLOCKED_PREFIX));
        persist_task_update(&engine, &blocked, None)
            .await
            .expect("persist blocked child");
    }

    engine
        .sweep_ask_parent_timeouts()
        .await
        .expect("sweep succeeds");

    let (_, defaulted_record) = list_ask_records(&engine, &with_default.id)
        .await
        .expect("readable")
        .into_iter()
        .next()
        .expect("record present");
    assert_eq!(defaulted_record.state, "timeout_defaulted");
    assert_eq!(defaulted_record.answer.as_deref(), Some("POST /v2"));

    let (_, unanswered_record) = list_ask_records(&engine, &without_default.id)
        .await
        .expect("readable")
        .into_iter()
        .next()
        .expect("record present");
    assert_eq!(unanswered_record.state, "timeout_unanswered");

    for target in [&with_default, &without_default] {
        let swept = task_by_id_for_tool_scope(&engine, &target.id)
            .await
            .expect("child exists");
        assert_ne!(
            swept.status,
            TaskStatus::Blocked,
            "timeout must never leave or fail the child as Blocked/Failed"
        );
        assert_ne!(swept.status, TaskStatus::Failed);
        assert!(swept.blocked_reason.is_none());
    }

    let defaulted_context = engine
        .build_parent_child_prompt_context(Some(&with_default.id))
        .await
        .expect("default injected");
    assert!(defaulted_context.contains("[parent answer] POST /v2"));
    let unanswered_context = engine
        .build_parent_child_prompt_context(Some(&without_default.id))
        .await
        .expect("proceed-with-judgment note injected");
    assert!(unanswered_context.contains("[ask timeout] no answer available; proceed with best judgment and state assumptions"));
}

#[test]
fn ask_timeout_action_covers_open_default_and_unanswered_paths() {
    let now: u64 = 10_000_000;
    let base = |state: &str, default: Option<&str>, asked_at: u64| AskParentRecord {
        question: "q".to_string(),
        options: Vec::new(),
        asked_at,
        timeout_minutes: 60,
        default: default.map(ToOwned::to_owned),
        state: state.to_string(),
        answer: None,
        answer_delivered: false,
    };

    assert_eq!(
        ask_timeout_action(&base("open", Some("d"), now), now),
        AskTimeoutAction::None,
        "before the deadline nothing fires"
    );
    assert_eq!(
        ask_timeout_action(&base("open", Some("d"), now - 3_600_000), now + 1),
        AskTimeoutAction::TimeoutDefaulted,
        "due with default auto-answers"
    );
    assert_eq!(
        ask_timeout_action(&base("open", None, now - 3_600_000), now + 1),
        AskTimeoutAction::TimeoutUnanswered,
        "due without default proceeds with judgment"
    );
    assert_eq!(
        ask_timeout_action(&base("open", Some("  "), now - 3_600_000), now + 1),
        AskTimeoutAction::TimeoutUnanswered,
        "blank default counts as absent"
    );
    assert_eq!(
        ask_timeout_action(&base("answered", Some("d"), now - 3_600_000), now + 1),
        AskTimeoutAction::None,
        "resolved records never re-fire"
    );
}

#[test]
fn awaiting_parent_prefix_exempts_only_awaiting_parent_children_from_stalled_recovery() {
    let base = |blocked_reason: Option<&str>| AgentTask {
        id: "task-x".to_string(),
        title: "t".to_string(),
        description: "d".to_string(),
        status: TaskStatus::Blocked,
        priority: Default::default(),
        progress: 40,
        created_at: 0,
        started_at: None,
        completed_at: None,
        error: None,
        result: None,
        thread_id: None,
        source: "subagent".to_string(),
        notify_on_complete: false,
        notify_channels: Vec::new(),
        dependencies: Vec::new(),
        command: None,
        session_id: None,
        goal_run_id: None,
        goal_run_title: None,
        goal_step_id: None,
        goal_step_title: None,
        parent_task_id: None,
        parent_thread_id: None,
        runtime: "daemon".to_string(),
        retry_count: 0,
        max_retries: 3,
        next_retry_at: None,
        scheduled_at: None,
        blocked_reason: blocked_reason.map(ToOwned::to_owned),
        awaiting_approval_id: None,
        policy_fingerprint: None,
        approval_expires_at: None,
        containment_scope: None,
        compensation_status: None,
        compensation_summary: None,
        lane_id: None,
        last_error: None,
        logs: Vec::new(),
        tool_whitelist: None,
        tool_blacklist: None,
        context_budget_tokens: None,
        context_overflow_action: None,
        termination_conditions: None,
        success_criteria: None,
        max_duration_secs: None,
        supervisor_config: None,
        override_provider: None,
        override_model: None,
        override_api_transport: None,
        override_system_prompt: None,
        sub_agent_def_id: None,
    };

    assert!(task_is_awaiting_parent(&base(Some(
        "awaiting parent: Which schema?"
    ))));
    assert!(!task_is_awaiting_parent(&base(Some("stuck_needs_recovery"))));
    assert!(!task_is_awaiting_parent(&base(Some(
        "waiting for operator approval: cargo"
    ))));
    assert!(!task_is_awaiting_parent(&base(None)));
}
