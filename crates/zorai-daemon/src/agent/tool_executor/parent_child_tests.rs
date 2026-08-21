use super::*;
use crate::agent::task_scheduler::refresh_task_queue_state;
use crate::agent::types::AgentConfig;
use crate::session_manager::SessionManager;
use std::collections::VecDeque;
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
    let records = list_ask_records(&engine, &orphan.id)
        .await
        .expect("no records read failure");
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
    let replayed = engine
        .build_parent_child_prompt_context(Some(&child.id))
        .await;
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
        blocked.blocked_reason = Some(format!(
            "{} Which endpoint?",
            AWAITING_PARENT_BLOCKED_PREFIX
        ));
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
    assert!(unanswered_context.contains(
        "[ask timeout] no answer available; proceed with best judgment and state assumptions"
    ));
}

#[tokio::test]
async fn ask_parent_enqueues_a_parent_wakeup_so_the_parent_can_answer() {
    let (_root, engine) = setup().await;
    let child = spawn_child(&engine).await;
    engine.begin_stream_cancellation("thread-parent").await;

    let result = execute_ask_parent(
        &serde_json::json!({
            "question": "Should I use plan A or plan B?",
            "options": ["plan A", "plan B"],
        }),
        &engine,
        "thread-child",
        Some(&child.id),
    )
    .await
    .expect("ask_parent succeeds");
    let parsed: serde_json::Value = serde_json::from_str(&result).expect("json result");
    let ask_id = parsed["ask_id"].as_str().expect("ask_id returned");
    assert!(!ask_id.is_empty());

    let queued = engine
        .deferred_visible_thread_continuations_for("thread-parent")
        .await;
    assert_eq!(
        queued.len(),
        1,
        "parent must get a continuation so it can call answer_child instead of waiting for timeout"
    );
    assert!(queued[0].llm_user_content.contains("answer_child"));
    assert!(queued[0].llm_user_content.contains(ask_id));
    assert!(queued[0]
        .llm_user_content
        .contains("Should I use plan A or plan B?"));
    assert_eq!(
        queued[0].task_id.as_deref(),
        child.parent_task_id.as_deref()
    );
}

#[tokio::test]
async fn answer_child_targets_one_open_ask_and_keeps_the_child_blocked_until_all_are_resolved() {
    let (_root, engine) = setup().await;
    let child = spawn_child(&engine).await;

    let first = execute_ask_parent(
        &ask_args("First?"),
        &engine,
        "thread-child",
        Some(&child.id),
    )
    .await
    .expect("first ask");
    let second = execute_ask_parent(
        &ask_args("Second?"),
        &engine,
        "thread-child",
        Some(&child.id),
    )
    .await
    .expect("second ask");
    let first_id = serde_json::from_str::<serde_json::Value>(&first).expect("json")["ask_id"]
        .as_str()
        .expect("ask_id")
        .to_string();
    let second_id = serde_json::from_str::<serde_json::Value>(&second).expect("json")["ask_id"]
        .as_str()
        .expect("ask_id")
        .to_string();

    let ambiguous = execute_answer_child(
        &serde_json::json!({ "child_task_id": child.id, "answer": "one answer for both" }),
        &engine,
        "thread-parent",
        None,
    )
    .await
    .expect_err("multiple open asks require ask_id");
    assert!(
        ambiguous.to_string().contains("ask_id"),
        "actionable ask_id guidance expected, got: {ambiguous}"
    );

    execute_answer_child(
        &serde_json::json!({
            "child_task_id": child.id,
            "ask_id": first_id,
            "answer": "answer first",
        }),
        &engine,
        "thread-parent",
        None,
    )
    .await
    .expect("first ask answered");

    let still_blocked = task_by_id_for_tool_scope(&engine, &child.id)
        .await
        .expect("child exists");
    assert_eq!(still_blocked.status, TaskStatus::Blocked);
    let open: Vec<_> = list_ask_records(&engine, &child.id)
        .await
        .expect("records")
        .into_iter()
        .filter(|(_, record)| record.state == "open")
        .collect();
    assert_eq!(open.len(), 1);
    assert_eq!(
        split_ask_key(&open[0].0).map(|(_, id)| id),
        Some(second_id.as_str())
    );

    execute_answer_child(
        &serde_json::json!({
            "child_task_id": child.id,
            "ask_id": second_id,
            "answer": "answer second",
        }),
        &engine,
        "thread-parent",
        None,
    )
    .await
    .expect("second ask answered");
    let unblocked = task_by_id_for_tool_scope(&engine, &child.id)
        .await
        .expect("child exists");
    assert_ne!(unblocked.status, TaskStatus::Blocked);
}

#[tokio::test]
async fn timeout_sweep_leaves_child_blocked_while_other_asks_are_still_open() {
    let (_root, engine) = setup().await;
    let child = spawn_child(&engine).await;
    let now = now_millis();
    let expired = AskParentRecord {
        question: "Expired?".to_string(),
        options: Vec::new(),
        asked_at: now.saturating_sub(10 * 60_000),
        timeout_minutes: 1,
        default: None,
        state: "open".to_string(),
        answer: None,
        answer_delivered: false,
    };
    let live = AskParentRecord {
        question: "Still waiting?".to_string(),
        options: Vec::new(),
        asked_at: now,
        timeout_minutes: 240,
        default: None,
        state: "open".to_string(),
        answer: None,
        answer_delivered: false,
    };
    engine
        .history
        .set_consolidation_state(
            &format!("ask_parent:{}:expired", child.id),
            &serde_json::to_string(&expired).unwrap(),
            now,
        )
        .await
        .expect("seed expired");
    engine
        .history
        .set_consolidation_state(
            &format!("ask_parent:{}:live", child.id),
            &serde_json::to_string(&live).unwrap(),
            now,
        )
        .await
        .expect("seed live");
    let mut blocked = task_by_id_for_tool_scope(&engine, &child.id)
        .await
        .expect("child exists");
    blocked.status = TaskStatus::Blocked;
    blocked.blocked_reason = Some(format!("{} Still waiting?", AWAITING_PARENT_BLOCKED_PREFIX));
    persist_task_update(&engine, &blocked, None)
        .await
        .expect("persist blocked");

    engine
        .sweep_ask_parent_timeouts()
        .await
        .expect("sweep succeeds");

    let records = list_ask_records(&engine, &child.id).await.expect("records");
    let expired_state = records
        .iter()
        .find(|(key, _)| key.ends_with(":expired"))
        .map(|(_, record)| record.state.as_str());
    let live_state = records
        .iter()
        .find(|(key, _)| key.ends_with(":live"))
        .map(|(_, record)| record.state.as_str());
    assert_eq!(expired_state, Some("timeout_unanswered"));
    assert_eq!(live_state, Some("open"));
    let still_blocked = task_by_id_for_tool_scope(&engine, &child.id)
        .await
        .expect("child exists");
    assert_eq!(still_blocked.status, TaskStatus::Blocked);
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

#[test]
fn select_open_ask_requires_ask_id_when_several_are_outstanding() {
    let record = |question: &str| AskParentRecord {
        question: question.to_string(),
        options: Vec::new(),
        asked_at: 1,
        timeout_minutes: 1,
        default: None,
        state: "open".to_string(),
        answer: None,
        answer_delivered: false,
    };
    let open = vec![
        ("ask_parent:child:one".to_string(), record("First?")),
        ("ask_parent:child:two".to_string(), record("Second?")),
    ];
    let error = select_open_ask(&open, None).expect_err("ambiguous answer");
    assert!(error.to_string().contains("ask_id"));
    let selected = select_open_ask(&open, Some("two")).expect("specific ask");
    assert_eq!(selected.0, "ask_parent:child:two");
}

#[test]
fn notes_cursor_rewinds_when_the_oldest_note_is_evicted() {
    assert_eq!(notes_cursor_after_eviction(20, 1), 19);
    assert_eq!(notes_cursor_after_eviction(0, 1), 0);
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
    assert!(!task_is_awaiting_parent(&base(Some(
        "stuck_needs_recovery"
    ))));
    assert!(!task_is_awaiting_parent(&base(Some(
        "waiting for operator approval: cargo"
    ))));
    assert!(!task_is_awaiting_parent(&base(None)));

    let mut queued = VecDeque::from(vec![base(Some("awaiting parent: Which schema?"))]);
    let changed = refresh_task_queue_state(&mut queued, 100, &[], &AgentConfig::default());
    assert!(
        changed.is_empty(),
        "queue refresh must not treat an open ask_parent as a cleared gate"
    );
    assert_eq!(queued[0].status, TaskStatus::Blocked);
    assert_eq!(
        queued[0].blocked_reason.as_deref(),
        Some("awaiting parent: Which schema?")
    );
}
