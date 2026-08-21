use super::*;
use crate::agent::types::{DeferredVisibleThreadContinuation, TaskStatus};
use serde::{Deserialize, Serialize};

/// blocked_reason prefix that marks a task as blocked on an open `ask_parent`.
/// stalled_turns classification exempts tasks whose reason starts with this.
pub(in crate::agent) const AWAITING_PARENT_BLOCKED_PREFIX: &str = "awaiting parent:";

const ASK_PARENT_STATE_PREFIX: &str = "ask_parent:";
const NOTES_STATE_PREFIX: &str = "notes_to_child:";
const NOTES_CURSOR_STATE_PREFIX: &str = "notes_to_child_cursor:";
const MAX_OPEN_ASKS_PER_CHILD: usize = 5;
const MAX_NOTES_PER_CHILD: usize = 20;
const MAX_NOTE_CHARS: usize = 2_000;
const DEFAULT_TIMEOUT_MINUTES: u64 = 240;
const LOG_PHASE: &str = "parent_child_messaging";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(crate) struct AskParentRecord {
    pub question: String,
    #[serde(default)]
    pub options: Vec<String>,
    pub asked_at: u64,
    pub timeout_minutes: u64,
    #[serde(default)]
    pub default: Option<String>,
    /// "open" | "answered" | "timeout_defaulted" | "timeout_unanswered"
    pub state: String,
    #[serde(default)]
    pub answer: Option<String>,
    #[serde(default)]
    pub answer_delivered: bool,
}

/// Pure, I/O-free timeout decision for one ask_parent record.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AskTimeoutAction {
    None,
    TimeoutDefaulted,
    TimeoutUnanswered,
}

pub(crate) fn ask_timeout_action(record: &AskParentRecord, now: u64) -> AskTimeoutAction {
    if record.state != "open" {
        return AskTimeoutAction::None;
    }
    let deadline = record
        .asked_at
        .saturating_add(record.timeout_minutes.saturating_mul(60_000));
    if now < deadline {
        return AskTimeoutAction::None;
    }
    let has_default = record
        .default
        .as_deref()
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);
    if has_default {
        AskTimeoutAction::TimeoutDefaulted
    } else {
        AskTimeoutAction::TimeoutUnanswered
    }
}

/// Whether a task is currently blocked on an open ask_parent (stalled-turn exempt).
pub(crate) fn task_is_awaiting_parent(task: &AgentTask) -> bool {
    task.blocked_reason
        .as_deref()
        .map(|reason| reason.trim_start().starts_with(AWAITING_PARENT_BLOCKED_PREFIX))
        .unwrap_or(false)
}

fn ask_state_prefix(child_task_id: &str) -> String {
    format!("{ASK_PARENT_STATE_PREFIX}{child_task_id}:")
}

/// Split an ask state key into (child_task_id, ask_id).
fn split_ask_key(key: &str) -> Option<(&str, &str)> {
    key.strip_prefix(ASK_PARENT_STATE_PREFIX)?
        .rsplit_once(':')
        .filter(|(child_id, ask_id)| !child_id.is_empty() && !ask_id.is_empty())
}

async fn list_ask_records(
    agent: &AgentEngine,
    child_task_id: &str,
) -> Result<Vec<(String, AskParentRecord)>> {
    let rows = agent
        .history
        .list_consolidation_state_by_prefix(&ask_state_prefix(child_task_id))
        .await?;
    Ok(rows
        .into_iter()
        .filter_map(|(key, value)| {
            serde_json::from_str::<AskParentRecord>(&value)
                .ok()
                .map(|record| (key, record))
        })
        .collect())
}

async fn persist_ask_record(
    agent: &AgentEngine,
    key: &str,
    record: &AskParentRecord,
) -> Result<()> {
    let value = serde_json::to_string(record)?;
    agent
        .history
        .set_consolidation_state(key, &value, now_millis())
        .await
}

async fn persist_task_update(
    agent: &AgentEngine,
    updated: &AgentTask,
    message: Option<String>,
) -> Result<()> {
    let updated_live = {
        let mut tasks = agent.tasks.lock().await;
        if let Some(task) = tasks.iter_mut().find(|task| task.id == updated.id) {
            *task = updated.clone();
            true
        } else {
            false
        }
    };
    agent.history.upsert_agent_task(updated).await?;
    if updated_live {
        agent.persist_tasks().await;
    }
    agent.emit_task_update(updated, message);
    Ok(())
}

async fn resolve_caller_task(
    agent: &AgentEngine,
    thread_id: &str,
    task_id: Option<&str>,
) -> Option<AgentTask> {
    match task_id {
        Some(task_id) => task_by_id_for_tool_scope(agent, task_id).await,
        None => {
            let tasks = agent.tasks.lock().await;
            tasks
                .iter()
                .find(|task| task.thread_id.as_deref() == Some(thread_id))
                .cloned()
        }
    }
}

/// Validate that the caller (parent task or parent thread surface) may answer
/// or note the given child.
fn caller_is_parent(child: &AgentTask, caller_task: Option<&AgentTask>, thread_id: &str) -> bool {
    if let Some(parent_task_id) = child.parent_task_id.as_deref() {
        if caller_task.map(|task| task.id == parent_task_id).unwrap_or(false) {
            return true;
        }
    }
    if let Some(parent_thread_id) = child.parent_thread_id.as_deref() {
        if thread_id == parent_thread_id {
            return true;
        }
        if caller_task.and_then(|task| task.thread_id.as_deref()) == Some(parent_thread_id) {
            return true;
        }
    }
    false
}

async fn unblock_child_task(agent: &AgentEngine, child: &mut AgentTask) -> bool {
    if child.status != TaskStatus::Blocked {
        return false;
    }
    let stream_active = {
        let streams = agent.stream_cancellations.lock().await;
        match child.thread_id.as_deref().and_then(|tid| streams.get(tid)) {
            Some(entry) => !entry.token.is_cancelled(),
            None => false,
        }
    };
    // Scheduler semantics: an idle child goes back to Queued for redispatch;
    // a child with a live stream resumes InProgress in place.
    child.status = if stream_active {
        TaskStatus::InProgress
    } else {
        TaskStatus::Queued
    };
    child.blocked_reason = None;
    child.completed_at = None;
    child.error = None;
    child.last_error = None;
    child.next_retry_at = None;
    true
}

async fn wake_child_thread(agent: &AgentEngine, child: &AgentTask, llm_user_content: String) {
    let Some(child_thread_id) = child.thread_id.as_deref() else {
        return;
    };
    let agent_id = agent
        .agent_scope_id_for_turn(Some(child_thread_id), Some(child.id.as_str()))
        .await;
    agent
        .enqueue_visible_thread_continuation(
            child_thread_id,
            DeferredVisibleThreadContinuation {
                agent_id,
                task_id: Some(child.id.clone()),
                preferred_session_hint: None,
                llm_user_content,
                queued_at_ms: 0,
                force_compaction: false,
                rerun_participant_observers_after_turn: false,
                internal_delegate_sender: None,
                internal_delegate_message: None,
            },
        )
        .await;
    if let Err(error) = agent
        .flush_deferred_visible_thread_continuations(child_thread_id)
        .await
    {
        tracing::warn!(
            thread_id = %child_thread_id,
            task_id = %child.id,
            %error,
            "failed to flush child continuation after parent-child messaging resolution"
        );
    }
}

pub(crate) async fn execute_ask_parent(
    args: &serde_json::Value,
    agent: &AgentEngine,
    _thread_id: &str,
    task_id: Option<&str>,
) -> Result<String> {
    let question = args
        .get("question")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| anyhow::anyhow!("missing 'question' argument"))?
        .to_string();
    let options = args
        .get("options")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let timeout_minutes = args
        .get("timeout_minutes")
        .and_then(|value| value.as_u64())
        .map(|value| value.max(1))
        .unwrap_or(DEFAULT_TIMEOUT_MINUTES);
    let default = args
        .get("default")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);

    let caller_task_id = task_id.ok_or_else(|| {
        anyhow::anyhow!(
            "ask_parent can only be called from within a child task; this tool call has no task context"
        )
    })?;
    let task = task_by_id_for_tool_scope(agent, caller_task_id)
        .await
        .ok_or_else(|| anyhow::anyhow!("task {caller_task_id} not found"))?;
    if task.parent_task_id.is_none() && task.parent_thread_id.is_none() {
        anyhow::bail!(
            "ask_parent requires a parent: task {} has no parent_task_id or parent_thread_id. \
             Use ask_questions to reach the operator instead.",
            task.id
        );
    }

    let open_count = list_ask_records(agent, &task.id)
        .await?
        .iter()
        .filter(|(_, record)| record.state == "open")
        .count();
    if open_count >= MAX_OPEN_ASKS_PER_CHILD {
        anyhow::bail!(
            "{open_count} open ask_parent records already exist for task {}; batch your questions \
             into a single ask_parent call or wait for existing answers before asking again",
            task.id
        );
    }

    let record = AskParentRecord {
        question: question.clone(),
        options,
        asked_at: now_millis(),
        timeout_minutes,
        default,
        state: "open".to_string(),
        answer: None,
        answer_delivered: false,
    };
    let key = format!("{}{}", ask_state_prefix(&task.id), uuid::Uuid::new_v4());
    persist_ask_record(agent, &key, &record).await?;

    let mut updated = task.clone();
    updated.status = TaskStatus::Blocked;
    updated.blocked_reason = Some(format!("{AWAITING_PARENT_BLOCKED_PREFIX} {question}"));
    updated.logs.push(make_task_log_entry(
        updated.retry_count,
        TaskLogLevel::Info,
        LOG_PHASE,
        "asked parent a blocking question; task paused until answered or timed out",
        Some(question.clone()),
    ));
    persist_task_update(
        agent,
        &updated,
        Some("Child is awaiting a parent answer".into()),
    )
    .await?;

    Ok(serde_json::json!({
        "ok": true,
        "state": "open",
        "timeout_minutes": timeout_minutes,
        "message": "Task is now blocked awaiting the parent's answer. Stop working and wait to be unblocked; do not retry ask_parent."
    })
    .to_string())
}

pub(crate) async fn execute_answer_child(
    args: &serde_json::Value,
    agent: &AgentEngine,
    thread_id: &str,
    task_id: Option<&str>,
) -> Result<String> {
    let child_task_id = required_string_arg(args, "child_task_id")?;
    let answer = required_string_arg(args, "answer")?;

    let child = task_by_id_for_tool_scope(agent, &child_task_id)
        .await
        .ok_or_else(|| anyhow::anyhow!("child task {child_task_id} not found"))?;
    let caller_task = resolve_caller_task(agent, thread_id, task_id).await;
    if !caller_is_parent(&child, caller_task.as_ref(), thread_id) {
        anyhow::bail!(
            "only the child's parent (parent task {} or parent thread {}) may answer task {}; \
             call it from the parent thread or parent task context",
            child.parent_task_id.as_deref().unwrap_or("(none)"),
            child.parent_thread_id.as_deref().unwrap_or("(none)"),
            child.id
        );
    }

    let mut records = list_ask_records(agent, &child_task_id).await?;
    let open_keys: Vec<String> = records
        .iter()
        .filter(|(_, record)| record.state == "open")
        .map(|(key, _)| key.clone())
        .collect();
    if open_keys.is_empty() {
        anyhow::bail!(
            "no open ask_parent record exists for child task {child_task_id}; it may already be answered or timed out"
        );
    }
    for key in &open_keys {
        if let Some((_, record)) = records.iter_mut().find(|(k, _)| k == key) {
            record.state = "answered".to_string();
            record.answer = Some(answer.clone());
            record.answer_delivered = false;
            persist_ask_record(agent, key, record).await?;
        }
    }

    let mut updated = child.clone();
    let unblocked = unblock_child_task(agent, &mut updated).await;
    updated.logs.push(make_task_log_entry(
        updated.retry_count,
        TaskLogLevel::Info,
        LOG_PHASE,
        if unblocked {
            "parent answered; child unblocked"
        } else {
            "parent answered an open question"
        },
        Some(answer.chars().take(MAX_NOTE_CHARS).collect()),
    ));
    persist_task_update(
        agent,
        &updated,
        Some(if unblocked {
            "Parent answered; child unblocked".into()
        } else {
            "Parent answered an open question".into()
        }),
    )
    .await?;
    if unblocked {
        wake_child_thread(
            agent,
            &updated,
            format!(
                "Your parent answered your blocking question. The full answer is provided in the [parent answer] context block. Continue the assigned work."
            ),
        )
        .await;
    }

    Ok(serde_json::json!({
        "ok": true,
        "answered": open_keys.len(),
        "unblocked": unblocked,
        "child_status": format!("{:?}", updated.status).to_lowercase(),
    })
    .to_string())
}

pub(crate) async fn execute_note_to_child(
    args: &serde_json::Value,
    agent: &AgentEngine,
    thread_id: &str,
    task_id: Option<&str>,
) -> Result<String> {
    let child_task_id = required_string_arg(args, "child_task_id")?;
    let note = required_string_arg(args, "note")?;

    let child = task_by_id_for_tool_scope(agent, &child_task_id)
        .await
        .ok_or_else(|| anyhow::anyhow!("child task {child_task_id} not found"))?;
    let caller_task = resolve_caller_task(agent, thread_id, task_id).await;
    if !caller_is_parent(&child, caller_task.as_ref(), thread_id) {
        anyhow::bail!(
            "only the child's parent (parent task {} or parent thread {}) may note task {}; \
             call it from the parent thread or parent task context",
            child.parent_task_id.as_deref().unwrap_or("(none)"),
            child.parent_thread_id.as_deref().unwrap_or("(none)"),
            child.id
        );
    }

    let notes_key = format!("{NOTES_STATE_PREFIX}{child_task_id}");
    let mut notes: Vec<String> = agent
        .history
        .get_consolidation_state(&notes_key)
        .await?
        .and_then(|value| serde_json::from_str::<Vec<String>>(&value).ok())
        .unwrap_or_default();
    let truncated: String = note.chars().take(MAX_NOTE_CHARS).collect();
    notes.push(truncated);
    let evicted = notes.len() > MAX_NOTES_PER_CHILD;
    if evicted {
        notes.remove(0);
    }
    agent
        .history
        .set_consolidation_state(&notes_key, &serde_json::to_string(&notes)?, now_millis())
        .await?;

    let mut updated = child.clone();
    updated.logs.push(make_task_log_entry(
        updated.retry_count,
        TaskLogLevel::Info,
        LOG_PHASE,
        "parent attached a guidance note; delivered with the next turn",
        Some(note.chars().take(MAX_NOTE_CHARS).collect()),
    ));
    persist_task_update(agent, &updated, Some("Parent sent guidance note".into())).await?;

    Ok(serde_json::json!({
        "ok": true,
        "stored_notes": notes.len(),
        "oldest_evicted": evicted,
        "status_changed": false,
    })
    .to_string())
}

fn required_string_arg(args: &serde_json::Value, name: &str) -> Result<String> {
    args.get(name)
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| anyhow::anyhow!("missing '{name}' argument"))
}

impl AgentEngine {
    /// Build the `[parent answer]` / `[parent note]` / `[ask timeout]`
    /// injection blocks for a child's next turn and mark them delivered.
    pub(in crate::agent) async fn build_parent_child_prompt_context(
        &self,
        task_id: Option<&str>,
    ) -> Option<String> {
        let task_id = task_id
            .map(str::trim)
            .filter(|value| !value.is_empty())?;
        let mut blocks: Vec<String> = Vec::new();

        let records = match list_ask_records(self, task_id).await {
            Ok(records) => records,
            Err(error) => {
                tracing::warn!(%error, "failed to load ask_parent records for prompt context");
                Vec::new()
            }
        };
        let mut changed: Vec<(String, AskParentRecord)> = Vec::new();
        for (key, mut record) in records {
            if record.answer_delivered {
                continue;
            }
            let block = match record.state.as_str() {
                "answered" => record
                    .answer
                    .clone()
                    .map(|answer| format!("[parent answer] {answer}")),
                "timeout_defaulted" => record.default.clone().map(|default| {
                    format!("[parent answer] {default}\n(applied automatically after the ask timed out)")
                }),
                "timeout_unanswered" => Some(
                    "[ask timeout] no answer available; proceed with best judgment and state assumptions"
                        .to_string(),
                ),
                _ => None,
            };
            if let Some(block) = block {
                blocks.push(block);
                record.answer_delivered = true;
                changed.push((key, record));
            }
        }

        let notes_key = format!("{NOTES_STATE_PREFIX}{task_id}");
        let notes: Vec<String> = match self.history.get_consolidation_state(&notes_key).await {
            Ok(Some(value)) => serde_json::from_str::<Vec<String>>(&value).unwrap_or_default(),
            Ok(None) => Vec::new(),
            Err(error) => {
                tracing::warn!(%error, "failed to load notes_to_child records for prompt context");
                Vec::new()
            }
        };
        let cursor_key = format!("{NOTES_CURSOR_STATE_PREFIX}{task_id}");
        let delivered: usize = match self.history.get_consolidation_state(&cursor_key).await {
            Ok(Some(value)) => value.parse::<usize>().unwrap_or(0),
            Ok(None) => 0,
            Err(error) => {
                tracing::warn!(%error, "failed to load notes delivery cursor");
                0
            }
        };
        let delivered = delivered.min(notes.len());
        for note in &notes[delivered..] {
            blocks.push(format!("[parent note] {note}"));
        }

        if blocks.is_empty() {
            return None;
        }
        for (key, record) in changed {
            if let Err(error) = persist_ask_record(self, &key, &record).await {
                tracing::warn!(%error, "failed to mark ask_parent answer delivered");
            }
        }
        if notes.len() > delivered {
            if let Err(error) = self
                .history
                .set_consolidation_state(&cursor_key, &notes.len().to_string(), now_millis())
                .await
            {
                tracing::warn!(%error, "failed to advance notes delivery cursor");
            }
        }
        Some(blocks.join("\n\n"))
    }

    /// Timeout sweep for open ask_parent records. Piggybacked on the periodic
    /// operation-wakeup supervision pass. Never fails a child task.
    pub(in crate::agent) async fn sweep_ask_parent_timeouts(&self) -> Result<()> {
        let now = now_millis();
        let rows = self
            .history
            .list_consolidation_state_by_prefix(ASK_PARENT_STATE_PREFIX)
            .await?;
        for (key, value) in rows {
            let Ok(mut record) = serde_json::from_str::<AskParentRecord>(&value) else {
                continue;
            };
            let action = ask_timeout_action(&record, now);
            if action == AskTimeoutAction::None {
                continue;
            }
            let Some((child_task_id, _)) = split_ask_key(&key) else {
                continue;
            };
            let resolution_note = match action {
                AskTimeoutAction::TimeoutDefaulted => {
                    let default = record.default.clone().unwrap_or_default();
                    record.state = "timeout_defaulted".to_string();
                    record.answer = Some(default.clone());
                    default
                }
                AskTimeoutAction::TimeoutUnanswered => {
                    record.state = "timeout_unanswered".to_string();
                    "no answer available; proceed with best judgment and state assumptions"
                        .to_string()
                }
                AskTimeoutAction::None => continue,
            };
            record.answer_delivered = false;
            if let Err(error) = persist_ask_record(self, &key, &record).await {
                tracing::warn!(%error, "failed to persist ask_parent timeout state");
                continue;
            }
            let Some(mut child) = task_by_id_for_tool_scope(self, child_task_id).await else {
                continue;
            };
            let unblocked = unblock_child_task(self, &mut child).await;
            child.logs.push(make_task_log_entry(
                child.retry_count,
                TaskLogLevel::Warn,
                LOG_PHASE,
                if unblocked {
                    "ask_parent timed out; child unblocked to proceed without a parent answer"
                } else {
                    "ask_parent timed out"
                },
                Some(resolution_note.clone()),
            ));
            if let Err(error) =
                persist_task_update(self, &child, Some("Parent ask timed out".into())).await
            {
                tracing::warn!(%error, "failed to persist child after ask_parent timeout");
                continue;
            }
            if unblocked {
                wake_child_thread(
                    self,
                    &child,
                    "Your ask_parent timed out. See the [parent answer] / [ask timeout] context block for how to proceed.".to_string(),
                )
                .await;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
#[path = "parent_child_tests.rs"]
mod tests;
