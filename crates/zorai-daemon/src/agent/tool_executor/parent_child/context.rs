use super::super::{
    make_task_log_entry, now_millis, task_by_id_for_tool_scope, AgentEngine, Result, TaskLogLevel,
};
use super::wakeup::wake_child_thread;
use super::{
    ask_timeout_action, list_ask_records, persist_ask_record, persist_task_update, split_ask_key,
    unblock_child_task, AskParentRecord, AskTimeoutAction, ASK_PARENT_STATE_PREFIX, LOG_PHASE,
    NOTES_CURSOR_STATE_PREFIX, NOTES_STATE_PREFIX,
};

impl AgentEngine {
    /// Build the `[parent answer]` / `[parent note]` / `[ask timeout]`
    /// injection blocks for a child's next turn and mark them delivered.
    pub(in crate::agent) async fn build_parent_child_prompt_context(
        &self,
        task_id: Option<&str>,
    ) -> Option<String> {
        let task_id = task_id.map(str::trim).filter(|value| !value.is_empty())?;
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
            let still_open = match list_ask_records(self, child_task_id).await {
                Ok(records) => records
                    .iter()
                    .any(|(_, remaining)| remaining.state == "open"),
                Err(error) => {
                    tracing::warn!(
                        %error,
                        child_task_id,
                        "failed to list remaining ask_parent records after timeout; leaving child blocked"
                    );
                    true
                }
            };
            let unblocked = !still_open && unblock_child_task(self, &mut child).await;
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
