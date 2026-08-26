use super::*;
use crate::agent::types::{
    AgentTask, TaskCompletionContract, TaskCompletionRequirement, TaskPriority, TaskStatus,
};

fn awaiting_approval_task(id: &str, approval_expires_at: Option<u64>) -> AgentTask {
    AgentTask {
        id: id.to_string(),
        title: format!("Task {id}"),
        description: "Stale-approval timeout watcher test fixture".to_string(),
        status: TaskStatus::AwaitingApproval,
        priority: TaskPriority::Normal,
        progress: 35,
        created_at: 100,
        started_at: Some(150),
        completed_at: None,
        error: None,
        result: None,
        thread_id: Some(format!("thread-{id}")),
        source: "agent".to_string(),
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
        blocked_reason: Some("waiting for operator approval".to_string()),
        awaiting_approval_id: Some(format!("approval-{id}")),
        policy_fingerprint: None,
        approval_expires_at,
        containment_scope: None,
        compensation_status: None,
        compensation_summary: None,
        lane_id: None,
        last_error: None,
        logs: Vec::new(),
        completion_contract: None,
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
    }
}

#[tokio::test]
async fn completion_contract_round_trips_across_store_reload() -> Result<()> {
    let (store, _root) = make_test_store().await?;
    let mut task = awaiting_approval_task("contract-reload", None);
    task.status = TaskStatus::Blocked;
    task.awaiting_approval_id = None;
    task.completion_contract = Some(TaskCompletionContract {
        objective: "produce and verify artifact".to_string(),
        required_deliverables: vec![TaskCompletionRequirement {
            description: "artifact.json".to_string(),
            completed: true,
            evidence: Some("inventory/artifact.json".to_string()),
        }],
        completed_actions: vec!["implemented persistence".to_string()],
        outstanding_promised_actions: vec!["publish summary".to_string()],
        pending_operations: vec!["operation-42".to_string()],
        verification_requirements: vec![TaskCompletionRequirement {
            description: "restart replay".to_string(),
            completed: false,
            evidence: None,
        }],
        blocked_reason: Some("waiting for operation-42".to_string()),
        terminal_status: None,
        ..TaskCompletionContract::default()
    });

    store.upsert_agent_task(&task).await?;
    let loaded = store
        .list_agent_tasks()
        .await?
        .into_iter()
        .find(|candidate| candidate.id == task.id)
        .expect("persisted task should reload");

    assert_eq!(loaded.completion_contract, task.completion_contract);
    assert_eq!(loaded.status, TaskStatus::Blocked);
    Ok(())
}

#[tokio::test]
async fn persistence_guard_rejects_completed_status_with_open_contract() -> Result<()> {
    let (store, _root) = make_test_store().await?;
    let mut task = awaiting_approval_task("guarded-completion", None);
    task.status = TaskStatus::Completed;
    task.progress = 100;
    task.completed_at = Some(500);
    task.awaiting_approval_id = None;
    task.completion_contract = Some(TaskCompletionContract {
        objective: "wait for build".to_string(),
        pending_operations: vec!["operation-build".to_string()],
        terminal_status: Some(TaskStatus::Completed),
        ..TaskCompletionContract::default()
    });

    store.upsert_agent_task(&task).await?;
    let loaded = store
        .list_agent_tasks()
        .await?
        .into_iter()
        .find(|candidate| candidate.id == task.id)
        .expect("guarded row should reload");

    assert_eq!(loaded.status, TaskStatus::Blocked);
    assert!(loaded.progress < 100);
    assert_eq!(loaded.completed_at, None);
    assert!(loaded
        .blocked_reason
        .as_deref()
        .is_some_and(|reason| reason.contains("operation-build")));
    assert_eq!(
        loaded.completion_contract.unwrap().terminal_status,
        None,
        "rejected completion must not persist a contradictory terminal status"
    );
    Ok(())
}

#[tokio::test]
async fn legacy_agent_task_row_loads_without_completion_contract() -> Result<()> {
    let (store, _root) = make_test_store().await?;
    let task = awaiting_approval_task("legacy-contract", None);
    store.upsert_agent_task(&task).await?;

    let loaded = store
        .list_agent_tasks()
        .await?
        .into_iter()
        .find(|candidate| candidate.id == task.id)
        .expect("legacy-compatible row should reload");
    assert!(loaded.completion_contract.is_none());
    Ok(())
}

#[tokio::test]
async fn list_tasks_past_approval_deadline_returns_only_overdue_tasks() -> Result<()> {
    let (store, _root) = make_test_store().await?;
    let now: u64 = 10_000;
    // overdue: expires_at < now
    let overdue = awaiting_approval_task("overdue", Some(5_000));
    // not yet due: expires_at > now
    let not_overdue = awaiting_approval_task("not-overdue", Some(20_000));
    // no deadline set: must not match (would otherwise be a noisy false positive)
    let no_deadline = awaiting_approval_task("no-deadline", None);
    store.upsert_agent_task(&overdue).await?;
    store.upsert_agent_task(&not_overdue).await?;
    store.upsert_agent_task(&no_deadline).await?;
    let stale = store.list_tasks_past_approval_deadline(now).await?;
    assert_eq!(
        stale.len(),
        1,
        "exactly one task should be past the deadline"
    );
    let (task_id, thread_id, approval_id, expires_at) = &stale[0];
    assert_eq!(task_id, "overdue");
    assert_eq!(thread_id.as_deref(), Some("thread-overdue"));
    assert_eq!(approval_id, "approval-overdue");
    assert_eq!(*expires_at, 5_000);
    Ok(())
}

#[tokio::test]
async fn list_tasks_past_approval_deadline_skips_non_awaiting_approval_status() -> Result<()> {
    let (store, _root) = make_test_store().await?;
    // A task that has a past-deadline but is no longer in AwaitingApproval
    // (e.g., the operator approved it and execution resumed) must not be
    // flagged. Otherwise the timeout watcher would keep firing on resolved
    // approvals forever.
    let mut resolved = awaiting_approval_task("resolved", Some(5_000));
    resolved.status = TaskStatus::InProgress;
    store.upsert_agent_task(&resolved).await?;
    let stale = store.list_tasks_past_approval_deadline(10_000).await?;
    assert!(
        stale.is_empty(),
        "only AwaitingApproval tasks should be returned"
    );
    Ok(())
}

#[tokio::test]
async fn list_tasks_past_approval_deadline_skips_tasks_without_approval_id() -> Result<()> {
    let (store, _root) = make_test_store().await?;
    // Sanity guard: AwaitingApproval status alone isn't enough — there must
    // be a concrete `awaiting_approval_id` to escalate. A blank string is
    // treated as "no id" (matches the `TRIM(...) <> ''` predicate).
    let mut blank = awaiting_approval_task("blank", Some(5_000));
    blank.awaiting_approval_id = Some(String::new());
    store.upsert_agent_task(&blank).await?;
    let stale = store.list_tasks_past_approval_deadline(10_000).await?;
    assert!(
        stale.is_empty(),
        "tasks with blank approval id should not be flagged"
    );
    Ok(())
}

#[tokio::test]
async fn list_tasks_past_approval_deadline_orders_by_deadline_ascending() -> Result<()> {
    let (store, _root) = make_test_store().await?;
    let now: u64 = 100_000;
    store
        .upsert_agent_task(&awaiting_approval_task("middle", Some(50_000)))
        .await?;
    store
        .upsert_agent_task(&awaiting_approval_task("oldest", Some(10_000)))
        .await?;
    store
        .upsert_agent_task(&awaiting_approval_task("newest", Some(90_000)))
        .await?;
    let stale = store.list_tasks_past_approval_deadline(now).await?;
    let ids: Vec<&str> = stale.iter().map(|(id, _, _, _)| id.as_str()).collect();
    // The watcher escalates oldest-overdue first; the query has to
    // pre-order rather than rely on the caller to sort.
    assert_eq!(ids, vec!["oldest", "middle", "newest"]);
    Ok(())
}
